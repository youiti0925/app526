/**
 * 仕事ラインの実行係（サーバー側）。
 *
 * 依頼が入ったら・デーモンの合図が来たら kickJobWorker() を呼ぶ。
 * 1度に1件ずつ、処理待ちが無くなるまで回す。同じプロセスで二重に回らないよう
 * フラグで止め、別プロセスとはDBの条件付き更新（claimNextJob）で取り合わない。
 */
import { pushInbox, decideInbox } from "../agent/db";
import { createCaller, QuotaPauseError, tierModel } from "./models";
import { createPageFetcher } from "./fetcher";
import { callGemini, geminiAvailable, geminiModel } from "./gemini";
import { processJob, type Job } from "./pipeline";
import { candidatesFor, compareModels } from "./compare";
import {
  claimJob, claimNextJob, getRecipe, listRecipes, patchRecipe, reapStaleJobs, readJob, recordUsage, saveRecipe, updateJob,
} from "./db";
import { parseTable, toCsvText } from "../dataops/table";

/** 1件あたりのAI呼び出しの上限。暴走して週の枠を食い潰さないため。 */
export const MAX_CALLS_PER_JOB = Math.max(10, Number(process.env.JOB_MAX_AI_CALLS ?? 400));
/** 使用上限に当たったとき、何分後にやり直すか。 */
const QUOTA_RETRY_MIN = Math.max(10, Number(process.env.JOB_QUOTA_RETRY_MIN ?? 60));

let running = false;

export function jobWorkerRunning(): boolean {
  return running;
}

export function kickJobWorker(): void {
  if (running) return;
  running = true;
  void (async () => {
    try {
      reapStaleJobs();
      for (let job = claimNextJob(); job; job = claimNextJob()) {
        await runOne(job);
      }
    } finally {
      running = false;
    }
  })();
}

/** 指定の依頼をこの場で最後まで回す（コマンドから使う。画面からは kickJobWorker）。 */
export async function runJobNow(id: string): Promise<Job | null> {
  const job = claimJob(id);
  if (!job) return readJob(id);
  await runOne(job);
  return readJob(id);
}

async function runOne(job: Job): Promise<void> {
  let recipeId: string | null = job.recipeId;
  const call = createCaller({
    dataClass: job.dataClass,
    maxCalls: MAX_CALLS_PER_JOB,
    gemini: callGemini,
    record: (u) => recordUsage({ ...u, jobId: job.id, recipeId }),
  });
  try {
    const result = await processJob(job, {
      call,
      fetchPage: createPageFetcher(),
      recipes: { list: listRecipes, get: (id) => getRecipe(id), save: saveRecipe },
      progress: (patch) => {
        if (patch.recipeId) recipeId = patch.recipeId;
        updateJob(job.id, patch);
      },
    });
    const done = updateJob(job.id, { ...result.patch, status: result.status, retryAt: null });
    if (result.status === "awaiting_approval" && done) {
      const recipe = done.recipeId ? getRecipe(done.recipeId) : null;
      if (recipe) patchRecipe(recipe.id, { stats: { ...recipe.stats, runs: recipe.stats.runs + 1, lastUsedAt: new Date().toISOString() } });
      const q = done.report?.quality;
      const item = pushInbox({
        kind: "deliverable",
        priority: done.qualityPass ? 80 : 70,
        title: `納品物の確認: ${done.title}`,
        body: [
          done.note,
          q ? `出力 ${q.rows}行 / 要確認 ${q.errorRows}行 / 注意 ${q.warnRows}行` : "",
          done.report?.systemic ? `検品AIの指摘: ${done.report.systemic}` : "",
          "承認しても送信はされません。内容を確認して、各サイトで納品してください。",
        ].filter(Boolean).join("\n"),
        actionUrl: `/hustle/jobs?id=${done.id}`,
        meta: { jobId: done.id },
      });
      updateJob(job.id, { inboxId: item.id });
    }
  } catch (error) {
    if (error instanceof QuotaPauseError) {
      updateJob(job.id, {
        status: "waiting_quota",
        retryAt: new Date(Date.now() + QUOTA_RETRY_MIN * 60_000).toISOString(),
        note: `AIの使用上限に当たったため、${QUOTA_RETRY_MIN}分後に続きから再開します（${error.message.slice(0, 120)}）`,
      });
      return;
    }
    updateJob(job.id, {
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 1000) : String(error),
      note: "想定外のエラーで止まりました",
      finishedAt: new Date().toISOString(),
    });
  }
}

/**
 * ⑦ 人の判断。承認しても送信はしない（各サイトの規約上、納品は人が行う）。
 * 承認した行は、手順書の手本（人が確かめた正解）に昇格させる。これで手本が貯まっていく。
 */
export function decideJob(
  id: string,
  decision: "approved" | "rejected" | "redo",
  note: string,
  opts: { kick?: boolean } = {}
): Job | null {
  const job = readJob(id);
  if (!job) return null;
  if (job.status !== "awaiting_approval" && !(decision === "redo" && (job.status === "rejected" || job.status === "needs_human"))) {
    return job;
  }
  const recipe = job.recipeId ? getRecipe(job.recipeId) : null;

  if (decision === "redo") {
    if (job.inboxId) decideInbox(job.inboxId, "rejected", `作り直し: ${note}`);
    if (recipe && job.status === "awaiting_approval") {
      patchRecipe(recipe.id, { stats: { ...recipe.stats, rejected: recipe.stats.rejected + 1 } });
    }
    const updated = updateJob(id, {
      status: "queued", feedback: note, note: "差し戻しの理由を反映して作り直します", inboxId: null, finishedAt: null,
      // 手順書が作れなかった依頼を作り直すときは、振り分けからやり直す
      ...(job.status === "needs_human" ? { recipeId: null, recipeVersion: null, route: null } : {}),
    });
    if (opts.kick !== false) kickJobWorker();
    return updated;
  }

  if (job.inboxId) decideInbox(job.inboxId, decision, note);
  if (recipe) {
    const stats = {
      ...recipe.stats,
      approved: recipe.stats.approved + (decision === "approved" ? 1 : 0),
      rejected: recipe.stats.rejected + (decision === "rejected" ? 1 : 0),
    };
    const testSet = decision === "approved" ? promoteTestSet(job, recipe) : recipe.testSet;
    patchRecipe(recipe.id, { stats, testSet });
  }
  return updateJob(id, { status: decision, note: decision === "approved" ? "承認済み。各サイトで納品してください" : `差し戻し: ${note}` });
}

/** 承認された出力のうち、要確認の付いていない行（最大5行）を人が確かめた手本にする。 */
function promoteTestSet(job: Job, recipe: NonNullable<ReturnType<typeof getRecipe>>) {
  const input = parseTable(job.inputCsv).rows;
  const output = parseTable(job.outputCsv).rows;
  const flagged = new Set(job.issues.map((i) => i.src));
  const picks: { input: Record<string, string>; expected: Record<string, string> }[] = [];
  job.outputSrc.forEach((src, i) => {
    if (picks.length >= 5 || flagged.has(src) || !input[src] || !output[i]) return;
    picks.push({ input: input[src], expected: output[i] });
  });
  if (picks.length === 0) return recipe.testSet;
  return {
    input: picks.map((p) => p.input),
    expected: picks.map((p) => p.expected),
    compareColumns: recipe.output.columns,
    source: "human" as const,
    dataClass: job.dataClass,
  };
}

/** 手順書の手本で、安いモデルでも足りるかを試す（⑥の「並行」）。 */
export async function runModelComparison(recipeId: string): Promise<{ summary: string; trials: number } | null> {
  const recipe = getRecipe(recipeId);
  if (!recipe) return null;
  const call = createCaller({
    dataClass: recipe.testSet?.dataClass ?? "confidential",
    maxCalls: 60,
    gemini: callGemini,
    record: (u) => recordUsage({ ...u, jobId: null, recipeId, purpose: "compare" }),
  });
  const candidates = candidatesFor(recipe, {
    geminiAvailable: geminiAvailable(),
    geminiModel: geminiModel(),
    lightModel: tierModel("light"),
    standardModel: tierModel("standard"),
  });
  const result = await compareModels(recipe, { call, fetchPage: createPageFetcher() }, candidates);
  patchRecipe(recipe.id, { trials: [...recipe.trials, ...result.trials].slice(-20), preferred: result.preferred ?? recipe.preferred });
  return { summary: result.summary, trials: result.trials.length };
}

/** 画面のダウンロード用。要確認の理由を末尾の列に付けたCSV。 */
export function outputWithIssuesCsv(job: Job): string {
  const table = parseTable(job.outputCsv);
  const bySrc = new Map<number, string[]>();
  for (const i of job.issues) {
    const list = bySrc.get(i.src) ?? [];
    list.push(`${i.severity === "error" ? "要確認" : "注意"}:${i.column ? `${i.column} ` : ""}${i.reason}`);
    bySrc.set(i.src, list);
  }
  const rows = table.rows.map((r, idx) => ({ ...r, "確認メモ": (bySrc.get(job.outputSrc[idx]) ?? []).join(" / ") }));
  return toCsvText(rows, [...table.headers, "確認メモ"]);
}
