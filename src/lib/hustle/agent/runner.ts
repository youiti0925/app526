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
import { STEP_LABELS, type AgentRun, type RunResult, type RunTrigger, type StepId } from "./types";

/** 工程を回す順番。前の工程の結果を次が使うので固定。 */
const ORDER: StepId[] = ["ingest", "triage", "listing", "draft", "plan", "review", "learn"];

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
