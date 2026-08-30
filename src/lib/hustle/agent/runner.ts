import { CallBudget } from "./budget";
import {
  countRunsToday,
  createRun,
  finishRun,
  hasRunningRun,
  logEvent,
  readAgentConfig,
  readEvents,
  reapStaleRuns,
} from "./db";
import { STEP_IMPL, type StepContext } from "./steps";
import { findExpiredItems } from "./maintenance";
import { decideInbox, readInbox, readLeadsByIds } from "./db";
import { todayLocal } from "../analytics";
import { STEP_LABELS, STEP_ORDER, type AgentRun, type RunResult, type RunTrigger, type StepId } from "./types";

/** 工程を回す順番。前の工程の結果を次が使うので固定。 */
const ORDER = STEP_ORDER;

export interface RunOptions {
  trigger: RunTrigger;
  /** 1日の実行上限と多重起動のチェックを飛ばす（手動実行用） */
  force?: boolean;
  /** この工程だけ回す */
  only?: StepId[];
}

export interface RunOutcome {
  ran: boolean;
  reason?: string;
  result?: RunResult;
}

/**
 * エージェントの1回分の実行。
 *
 * 設計の前提:
 * - 途中で失敗しても、そこまでの結果は残す（全部巻き戻さない）
 * - 何を見て何を判断したかを必ずイベントに残す。勝手に動くものは、
 *   後から追えなければ信用できない
 * - 生成AIが使えなくても最後まで走る（ルールベースに縮退する）
 */
export async function runAgent(options: RunOptions): Promise<RunOutcome> {
  reapStaleRuns();

  const config = readAgentConfig();

  if (!options.force) {
    if (!config.enabled) {
      return { ran: false, reason: "自律運転がオフになっています" };
    }
    if (options.trigger === "auto_open" && !config.runOnOpen) {
      return { ran: false, reason: "画面を開いたときの自動実行がオフになっています" };
    }
    if (hasRunningRun()) {
      return { ran: false, reason: "すでに実行中です" };
    }
    const today = countRunsToday();
    if (today >= config.maxRunsPerDay) {
      return { ran: false, reason: `今日はすでに ${today}回 実行しました（上限 ${config.maxRunsPerDay}回）` };
    }
  } else if (hasRunningRun()) {
    return { ran: false, reason: "すでに実行中です" };
  }

  const run = createRun(options.trigger);
  const budget = new CallBudget(config.callBudget);

  const steps = ORDER.filter((s) => (options.only ? options.only.includes(s) : config.steps[s]));

  // どの工程からのログかを自動で付けるため、実行中の工程を持ち回す
  let currentStep: StepId | "runner" = "runner";
  const log: StepContext["log"] = (level, message, data) => {
    logEvent(run.id, currentStep, level, message, data ?? {});
  };

  logEvent(run.id, "runner", "info", `実行を開始しました（${steps.map((s) => STEP_LABELS[s]).join(" → ")}）`, {
    trigger: options.trigger,
    callBudget: config.callBudget,
  });

  // 工程の前に、締切の過ぎた承認待ちを掃除する。
  // 人の承認が遅れても、もう出せない案件がキューに居座って判断を汚さないため
  // （ホテル案件・海外企業リスト案件で実際に機会を逃した再発防止）。
  try {
    const pending = readInbox("pending", 200);
    const leads = readLeadsByIds(pending.map((i) => i.leadId).filter((id): id is string => !!id));
    const expired = findExpiredItems(
      pending.map((i) => ({ id: i.id, title: i.title, leadRawText: i.leadId ? (leads.get(i.leadId)?.rawText ?? null) : null })),
      todayLocal()
    );
    for (const e of expired) {
      decideInbox(e.inboxId, "expired", `締切(${e.deadline})超過のため自動で取り下げ`);
      logEvent(run.id, "runner", "action", `締切超過の承認待ちを取り下げました: ${e.title.slice(0, 60)}（締切 ${e.deadline}）`, {
        inboxId: e.inboxId,
      });
    }
  } catch (error) {
    logEvent(run.id, "runner", "warn", `締切掃除に失敗しました（続行します）: ${error instanceof Error ? error.message : String(error)}`, {});
  }

  const totals = { ingested: 0, triaged: 0, queued: 0 };
  const summaries: string[] = [];
  let failed = false;

  for (const step of steps) {
    currentStep = step;
    const startedAt = Date.now();
    try {
      const outcome = await STEP_IMPL[step]({ runId: run.id, config, budget, log });
      totals.ingested += outcome.ingested ?? 0;
      totals.triaged += outcome.triaged ?? 0;
      totals.queued += outcome.queued ?? 0;
      summaries.push(`${STEP_LABELS[step]}: ${outcome.summary}`);
      logEvent(run.id, step, "info", `完了（${Math.round((Date.now() - startedAt) / 100) / 10}秒）: ${outcome.summary}`);
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : "不明なエラー";
      logEvent(run.id, step, "error", `失敗しました: ${message}`, { step });
      // 1つ落ちても後続は回す。取り込みが失敗しても判定は動くべきなので。
    }
  }

  currentStep = "runner";
  const summary =
    totals.queued > 0
      ? `${totals.queued}件を承認待ちに追加（判定 ${totals.triaged}件 / 取り込み ${totals.ingested}件）`
      : summaries.length > 0
        ? summaries.join(" / ")
        : "実行する工程がありませんでした";

  finishRun(run.id, failed ? "failed" : "done", summary, budget.spent);
  logEvent(run.id, "runner", "info", `実行を終了しました。${summary}`, {
    callsUsed: budget.spent,
    callBudget: config.callBudget,
  });

  const finished: AgentRun = {
    ...run,
    finishedAt: new Date().toISOString(),
    status: failed ? "failed" : "done",
    summary,
    callsUsed: budget.spent,
  };

  return {
    ran: true,
    result: { run: finished, events: readEvents(run.id), ...totals },
  };
}
