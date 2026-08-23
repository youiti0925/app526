import { scoreScam } from "../scam-rules";
import { computePayout, PLATFORM_FEES } from "../payout";
import { computeStats, projectGoal, summarizeTasks, todayLocal, shiftDays, DEFAULT_MIN_WAGE_JPY } from "../analytics";
import { readEntries, readPaths, readProfile, readTasks } from "../db";
import { upsertTask } from "../repo";
import { getTemplate } from "../templates";
import { generateJson, hasApiKey, describeAiError } from "../ai";
import { detectScopeRisks, estimateHours, type WorkEstimate } from "./estimate";
import { needsEscalation } from "./escalation";
import { fetchFeed, leadFromParsed } from "./ingest";
import {
  insertLead,
  logEvent,
  pushInbox,
  readInbox,
  readLeads,
  updateLead,
  writeLearned,
} from "./db";
import type { AgentConfig, InboxItem, Lead, LearnedParams, StepId } from "./types";
import type { CallBudget } from "./budget";

export interface StepContext {
  runId: string;
  config: AgentConfig;
  budget: CallBudget;
  log: (level: "info" | "action" | "decision" | "warn" | "error", message: string, data?: Record<string, unknown>) => void;
}

export interface StepOutcome {
  /** 人が読む1行 */
  summary: string;
  ingested?: number;
  triaged?: number;
  queued?: number;
}

// ---------------------------------------------------------------------------
// 1. 取り込み
// ---------------------------------------------------------------------------

export async function stepIngest(ctx: StepContext): Promise<StepOutcome> {
  const feeds = ctx.config.feeds.filter((f) => /^https?:\/\//.test(f));
  if (feeds.length === 0) {
    ctx.log("info", "取り込み元のフィードが登録されていないので、手動で貼り付けた案件だけを扱います");
    return { summary: "取り込み元なし", ingested: 0 };
  }

  let ingested = 0;
  for (const feed of feeds) {
    try {
      const parsed = await fetchFeed(feed);
      let added = 0;
      for (const p of parsed) {
        const { created } = insertLead(leadFromParsed(p));
        if (created) added++;
      }
      ingested += added;
      ctx.log("action", `${feed} から ${added}件 取り込みました（重複 ${parsed.length - added}件）`, {
        feed,
        found: parsed.length,
        added,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "不明なエラー";
      ctx.log("warn", `${feed} の取得に失敗しました: ${message}`, { feed });
    }
    // 相手のサーバーに連続でぶつけない
    await new Promise((r) => setTimeout(r, 1500));
  }

  return { summary: `${ingested}件 取り込み`, ingested };
}

// ---------------------------------------------------------------------------
// 2. 判定
// ---------------------------------------------------------------------------

interface AiEstimate {
  estimatedHours?: { low: number; high: number };
  offeredJpy?: number | null;
  fitNotes?: string;
}

const TRIAGE_PROMPT = (text: string, background: string) => `あなたは日本の受託で長く食べているフリーランスです。
次の案件について、実際にかかる時間と提示報酬だけを推定してください。楽観的に見積もらないでください。
やりとり・修正対応・検収待ちの手戻りを必ず含めてください。

次のJSONだけを返してください:
{ "estimatedHours": { "low": 数値, "high": 数値 }, "offeredJpy": 数値 または null, "fitNotes": "依頼を受ける人の経歴で対応できるか。1〜2文。" }

=== 案件 ===
${text.slice(0, 4000)}

=== 受ける人の経歴 ===
${background.slice(0, 1500) || "（未入力）"}`;

export async function stepTriage(ctx: StepContext): Promise<StepOutcome> {
  const pending = readLeads("new", 50);
  if (pending.length === 0) return { summary: "判定する案件なし", triaged: 0 };

  const profile = readProfile();
  const background = profile?.background ?? "";
  const minHourly = ctx.config.learned.minHourlyJpy;
  const platform = PLATFORM_FEES.find((f) => f.id === "crowdworks")!;

  // AI は上位（報酬が読み取れているもの）から順に使う。枠を無駄にしないため。
  const aiQuota = hasApiKey() ? ctx.budget.allocate(0.5) : 0;
  let aiUsed = 0;
  let triaged = 0;
  let rejected = 0;
  let queued = 0;
  let escalated = 0;

  const sorted = [...pending].sort((a, b) => (b.budgetJpy ?? 0) - (a.budgetJpy ?? 0));

  for (const lead of sorted) {
    const scam = scoreScam(lead.rawText);
    const risks = detectScopeRisks(lead.rawText);

    let estimate: WorkEstimate | null = estimateHours(lead.rawText);
    let offered = lead.budgetJpy;
    let fitNotes = "";
    let estimatedBy: "rule" | "ai" = "rule";

    // 詐欺判定で落ちるものに AI を使わない（枠の無駄）
    if (scam.verdict !== "danger" && aiUsed < aiQuota && ctx.budget.take()) {
      try {
        const ai = await generateJson<AiEstimate>(TRIAGE_PROMPT(lead.rawText, background), {
          temperature: 0.2,
          maxOutputTokens: 1024,
        });
        aiUsed++;
        if (ai?.estimatedHours && Number.isFinite(ai.estimatedHours.low) && Number.isFinite(ai.estimatedHours.high)) {
          estimate = {
            lowHours: Math.max(0.5, ai.estimatedHours.low),
            highHours: Math.max(0.5, ai.estimatedHours.high),
            basis: "AIが募集文から推定（やりとり・修正込み）",
            confidence: "medium",
          };
          estimatedBy = "ai";
        }
        if (Number.isFinite(ai?.offeredJpy)) offered = ai!.offeredJpy as number;
        fitNotes = ai?.fitNotes ?? "";
      } catch (error) {
        ctx.log("warn", `AIでの見積もりに失敗しました: ${describeAiError(error).message}`);
      }
    }

    // 手数料を引いた実効時給で判定する
    let hourly: { low: number; high: number } | null = null;
    if (offered && offered > 0 && estimate) {
      const payout = computePayout(offered, platform, estimate.highHours);
      hourly = {
        low: Math.round(payout.netJpy / estimate.highHours),
        high: Math.round(payout.netJpy / Math.max(0.5, estimate.lowHours)),
      };
    }

    let verdict: Lead["verdict"];
    let reason: string;

    if (scam.verdict === "danger") {
      verdict = "reject";
      reason = `詐欺・搾取のシグナルが強い（スコア ${scam.score}）`;
    } else if (hourly && hourly.high < minHourly) {
      verdict = "reject";
      reason = `手数料を引いた実効時給が ${hourly.low.toLocaleString()}〜${hourly.high.toLocaleString()}円で、基準の ${minHourly.toLocaleString()}円 を下回る`;
    } else if (!hourly) {
      verdict = "verify_first";
      reason = offered
        ? "作業量を読み取れないため、実効時給を判定できていない"
        : "報酬額が書かれていないため、実効時給を判定できていない";
    } else if (scam.verdict === "caution" || risks.length > 0 || hourly.low < minHourly) {
      verdict = "verify_first";
      reason =
        risks.length > 0
          ? `条件を詰める必要がある箇所が ${risks.length}件`
          : "実効時給の下限が基準を割るため、条件次第";
    } else {
      verdict = "proceed";
      reason = `実効時給 ${hourly.low.toLocaleString()}〜${hourly.high.toLocaleString()}円 の見込み`;
    }

    // スコア: 実効時給を基準に、詐欺スコアと地雷の数で減点
    const rateScore = hourly ? Math.min(100, (hourly.low / Math.max(1, minHourly)) * 60) : 25;
    const score = Math.max(0, Math.round(rateScore - scam.score * 0.6 - risks.length * 4));

    const triageData = {
      scamScore: scam.score,
      scamVerdict: scam.verdict,
      scamSignals: scam.signals.map((s) => ({ label: s.label, weight: s.weight })),
      estimate,
      estimatedBy,
      hourly,
      risks,
      fitNotes,
      reason,
      minHourlyJpy: minHourly,
    };

    // ルールでも無料枠のAIでも判定しきれなかったものは、上位モデルに回す。
    // 詐欺で確実に落とせるものは回さない（回す価値がないため）。
    const escalationReasons = verdict === "reject" && scam.verdict === "danger" ? [] : needsEscalation(triageData);

    updateLead(lead.id, {
      status: verdict === "reject" && escalationReasons.length === 0 ? "rejected" : "triaged",
      score,
      verdict,
      budgetJpy: offered,
      triage: { ...triageData, escalationReasons },
    });

    if (escalationReasons.length > 0) escalated++;

    triaged++;
    if (verdict === "reject") rejected++;

    ctx.log("decision", `「${lead.title.slice(0, 40)}」→ ${labelVerdict(verdict)}: ${reason}`, {
      leadId: lead.id,
      verdict,
      score,
      hourly,
      scamScore: scam.score,
    });

    // 危険なものは、落としたことを人にも見せる（黙って消さない）
    if (scam.verdict === "danger") {
      pushInbox({
        runId: ctx.runId,
        kind: "warning",
        priority: 95,
        title: `危険な案件を除外しました: ${lead.title.slice(0, 50)}`,
        body: [
          `詐欺スコア ${scam.score}/100`,
          "",
          scam.signals
            .sort((a, b) => b.weight - a.weight)
            .map((s) => `・[${s.weight}] ${s.label}`)
            .join("\n"),
          "",
          scam.advice,
        ].join("\n"),
        leadId: lead.id,
        meta: { scamScore: scam.score },
      });
      queued++;
    }
  }

  ctx.log("info", `${triaged}件を判定し、${rejected}件を除外しました（AI使用 ${aiUsed}回）`);
  if (escalated > 0) {
    ctx.log(
      "warn",
      `${escalated}件は手元のルールでは判定できませんでした。上位モデルに回してください（npm run claude-batch）`,
      { escalated }
    );
  }
  return {
    summary: `${triaged}件判定・${rejected}件除外${escalated > 0 ? `・${escalated}件は判定保留` : ""}`,
    triaged,
    queued,
  };
}

const labelVerdict = (v: Lead["verdict"]): string =>
  ({ reject: "見送り", verify_first: "要確認", proceed: "応募候補", unknown: "判定不能" })[v];

// ---------------------------------------------------------------------------
// 3. 下書き
// ---------------------------------------------------------------------------

interface ProposalOut {
  variants?: { angle: string; subject: string; body: string }[];
}

export async function stepDraft(ctx: StepContext): Promise<StepOutcome> {
  const candidates = readLeads("triaged", 50)
    .filter((l) => {
      const t = l.triage as { escalationReasons?: unknown[] };
      // 上位モデルの判定待ちのものは、ここで雑な下書きを作らない
      return (t.escalationReasons?.length ?? 0) === 0;
    })
    .filter((l) => l.verdict === "proceed" || l.verdict === "verify_first")
    .sort((a, b) => b.score - a.score)
    .slice(0, ctx.config.maxDraftsPerRun);

  if (candidates.length === 0) return { summary: "下書きする案件なし", queued: 0 };

  const profile = readProfile();
  const background = profile?.background ?? "";
  const learned = ctx.config.learned;
  const template = getTemplate("proposal")!;
  let queued = 0;

  for (const lead of candidates) {
    const triage = lead.triage as {
      hourly?: { low: number; high: number } | null;
      risks?: string[];
      reason?: string;
      estimate?: WorkEstimate | null;
    };

    let body = "";
    let angle = "雛形";
    let usedAi = false;

    if (hasApiKey() && ctx.budget.take()) {
      try {
        const result = await generateJson<ProposalOut>(
          buildProposalPrompt(lead, background, learned),
          { temperature: 0.8, maxOutputTokens: 4096 }
        );
        const best = result?.variants?.find((v) => v?.body?.trim());
        if (best) {
          body = best.body;
          angle = best.angle || "AI生成";
          usedAi = true;
        }
      } catch (error) {
        ctx.log("warn", `提案文の生成に失敗しました: ${describeAiError(error).message}`, { leadId: lead.id });
      }
    }

    if (!body) {
      body = template.fallback({ jobText: lead.rawText, myBackground: background });
      angle = "雛形（AI未使用）";
    }

    const header = [
      `【この案件の判定】${triage.reason ?? ""}`,
      triage.hourly
        ? `【実効時給の見込み】${triage.hourly.low.toLocaleString()}〜${triage.hourly.high.toLocaleString()}円（手数料控除後）`
        : "【実効時給】判定できていません。送る前に手取り計算を通してください。",
      triage.estimate ? `【想定作業時間】${triage.estimate.lowHours}〜${triage.estimate.highHours}時間 — ${triage.estimate.basis}` : "",
      (triage.risks ?? []).length > 0 ? `\n【送る前に詰めること】\n${(triage.risks ?? []).map((r) => `・${r}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    pushInbox({
      runId: ctx.runId,
      kind: "proposal",
      priority: Math.min(90, 40 + lead.score / 2),
      title: lead.title.slice(0, 80) || "提案文",
      body: `${header}\n\n---\n\n${body}`,
      actionUrl: lead.url,
      leadId: lead.id,
      meta: { angle, usedAi, score: lead.score, verdict: lead.verdict },
    });

    updateLead(lead.id, { status: "drafted" });
    queued++;
    ctx.log("action", `「${lead.title.slice(0, 40)}」の提案文を承認待ちに積みました（${angle}）`, {
      leadId: lead.id,
      usedAi,
    });
  }

  return { summary: `${queued}件の提案文を用意`, queued };
}

function buildProposalPrompt(lead: Lead, background: string, learned: LearnedParams): string {
  const angles = learned.preferredAngles.length
    ? `\n過去に反応が良かった切り口: ${learned.preferredAngles.join(" / ")}。これを優先してください。`
    : "";
  const avoid = learned.avoidNotes.length
    ? `\n過去に却下された理由: ${learned.avoidNotes.join(" / ")}。同じことを繰り返さないでください。`
    : "";

  return `あなたは日本のクラウドソーシングで高い提案通過率を出しているフリーランスです。
次の募集に対する提案文を1案だけ、完成度の高い形で書いてください。

出力ルール:
- 日本語。ビジネス文書として自然な敬体。
- ${learned.targetProposalChars}文字前後。長文は読まれない。
- 誇張・成果保証を書かない。
- 事実として確認できないこと（実績数値、資格、経歴）を創作しない。埋める箇所は 【要確認: 何を書くか】 の形で残す。
- 冒頭2行で「この募集を読んだ上で書いている」ことが伝わること。
- 相手が一番不安なこと（納期、途中で消えないか、指示が通じるか）を先回りして潰す。
- 質問は最後に1〜2個だけ。${angles}${avoid}

次のJSONだけを返してください:
{ "variants": [ { "angle": "この案の切り口", "subject": "件名", "body": "提案文の本文" } ] }

=== 募集文 ===
${lead.rawText.slice(0, 5000)}

=== 自分の経歴 ===
${background || "（未入力。経歴に触れる箇所は【要確認】で残すこと）"}`;
}

// ---------------------------------------------------------------------------
// 4. 計画の組み直し
// ---------------------------------------------------------------------------

export async function stepPlan(ctx: StepContext): Promise<StepOutcome> {
  const today = todayLocal();
  const tasks = readTasks();
  const open = tasks.filter((t) => t.status === "todo" || t.status === "doing");
  const overdue = open.filter((t) => t.dueDate !== "" && t.dueDate < today);

  // 期限切れを今日に寄せる。溜まったまま見えなくなるのを防ぐ。
  let rolled = 0;
  for (const task of overdue) {
    upsertTask({ ...task, dueDate: today });
    rolled++;
  }
  if (rolled > 0) {
    ctx.log("action", `期限切れのタスク ${rolled}件 を今日に繰り越しました`);
  }

  // 今日のタスクのうち、下書きが要るものを先に作っておく
  const summary = summarizeTasks(readTasks());
  const draftable = summary.nextUp.filter((t) => t.template && getTemplate(t.template));

  let queued = 0;
  const alreadyQueued = new Set(
    readInbox("pending")
      .map((i) => String(i.meta.taskId ?? ""))
      .filter(Boolean)
  );

  for (const task of draftable) {
    if (alreadyQueued.has(task.id)) continue;
    const template = getTemplate(task.template)!;

    pushInbox({
      runId: ctx.runId,
      kind: template.assetKind === "outreach_mail" ? "outreach" : template.assetKind === "listing" ? "listing" : "deliverable",
      priority: 60,
      title: `${task.title}（${template.name}）`,
      body: [
        `このタスクの下書きです。手作業なら約${template.manualMinutes}分かかります。`,
        template.caution ? `\n【注意】${template.caution}` : "",
        "",
        "---",
        "",
        template.fallback({}),
        "",
        "※ 入力が必要なため、雛形のみ用意しています。「コンテンツ量産」で埋めると本文が生成されます。",
      ]
        .filter(Boolean)
        .join("\n"),
      actionUrl: `/hustle/factory?template=${template.id}`,
      meta: { taskId: task.id, templateId: template.id },
    });
    queued++;
  }

  if (queued > 0) ctx.log("action", `今日のタスクぶんの下書きを ${queued}件 用意しました`);

  return { summary: `繰り越し${rolled}件・下書き${queued}件`, queued };
}

// ---------------------------------------------------------------------------
// 5. 収支レビュー
// ---------------------------------------------------------------------------

export async function stepReview(ctx: StepContext): Promise<StepOutcome> {
  const entries = readEntries();
  const paths = readPaths();
  const profile = readProfile();
  const stats = computeStats(entries, paths);

  let queued = 0;

  // 撤退すべきチャネルは、黙って続けさせない
  for (const channel of stats.channels) {
    if (channel.verdict !== "consider_quitting") continue;
    const key = `quit:${channel.pathId}`;
    const already = readInbox("pending").some((i) => i.meta.key === key);
    if (already) continue;

    pushInbox({
      runId: ctx.runId,
      kind: "question",
      priority: 85,
      title: `「${channel.name}」から撤退しますか`,
      body: [
        channel.verdictReason,
        "",
        `入金 ${channel.settledJpy.toLocaleString()}円 / 経費 ${channel.expenseJpy.toLocaleString()}円 / 投入 ${Math.round(channel.minutes / 60)}時間`,
        channel.hourlyJpy !== null ? `実効時給 ${channel.hourlyJpy.toLocaleString()}円（最低賃金 ${DEFAULT_MIN_WAGE_JPY.toLocaleString()}円）` : "",
        "",
        "承認すると、このチャネルを「撤退」にして残りのタスクを止めます。却下すると、あと30日は再提案しません。",
      ]
        .filter(Boolean)
        .join("\n"),
      meta: { key, pathId: channel.pathId, action: "kill_path" },
    });
    queued++;
    ctx.log("decision", `「${channel.name}」は撤退を検討すべき水準です`, {
      hourly: channel.hourlyJpy,
      minutes: channel.minutes,
    });
  }

  // 週次のふりかえり（月曜だけ）
  const isMonday = new Date().getDay() === 1;
  const weekKey = `weekly:${todayLocal()}`;
  const hasWeekly = readInbox().some((i) => i.meta.key === weekKey);

  if (isMonday && !hasWeekly) {
    const since = shiftDays(todayLocal(), -7);
    const week = entries.filter((e) => e.date >= since);
    const income = week.filter((e) => e.kind === "income" && e.settled).reduce((s, e) => s + e.amountJpy, 0);
    const minutes = week.filter((e) => e.kind === "time").reduce((s, e) => s + e.minutes, 0);
    const goal = projectGoal(stats, profile?.goalJpy ?? 0, profile?.deadline ?? "");

    pushInbox({
      runId: ctx.runId,
      kind: "report",
      priority: 70,
      title: `先週のふりかえり（入金 ${income.toLocaleString()}円 / ${Math.round(minutes / 60)}時間）`,
      body: [
        `入金: ${income.toLocaleString()}円`,
        `投入時間: ${Math.round(minutes / 60)}時間`,
        minutes > 0 ? `実効時給: ${Math.round((income / minutes) * 60).toLocaleString()}円` : "実効時給: 記録なし",
        "",
        goal.message,
        "",
        stats.firstYenReached
          ? `累計の入金は ${stats.settledJpy.toLocaleString()}円 です。`
          : "まだ最初の1円が入っていません。金額の大小ではなく、入金される経験を1回作ることを目標にしてください。",
      ].join("\n"),
      meta: { key: weekKey },
    });
    queued++;
  }

  return { summary: `レビュー完了（${queued}件を報告）`, queued };
}

// ---------------------------------------------------------------------------
// 6. 自己調整
// ---------------------------------------------------------------------------

export async function stepLearn(ctx: StepContext): Promise<StepOutcome> {
  // 提案に限らず、送るもの全般の判断を学習に使う。
  // 提案だけだと立ち上げ期に件数がたまらず、いつまでも調整が始まらない。
  const SENDABLE = ["proposal", "outreach", "listing", "deliverable"];
  const decided = readInbox(undefined, 200).filter(
    (i) => i.status !== "pending" && SENDABLE.includes(i.kind)
  );
  if (decided.length < 3) {
    ctx.log(
      "info",
      `判断の履歴が ${decided.length}件 しかないので、まだ調整しません（3件から。承認でも却下でも1件と数えます）`
    );
    return { summary: "調整なし（履歴不足）" };
  }

  const approved = decided.filter((i) => i.status === "approved");
  const rejected = decided.filter((i) => i.status === "rejected");
  const prev = ctx.config.learned;
  const next: LearnedParams = { ...prev, revision: prev.revision + 1, updatedAt: new Date().toISOString() };
  const changes: string[] = [];

  // 通った提案の切り口を優先する
  const angles = approved
    .map((i) => String(i.meta.angle ?? ""))
    .filter((a) => a && !a.includes("雛形"));
  const topAngles = [...new Set(angles)].slice(0, 3);
  if (topAngles.length && topAngles.join() !== prev.preferredAngles.join()) {
    next.preferredAngles = topAngles;
    changes.push(`通りやすい切り口を「${topAngles.join(" / ")}」に更新`);
  }

  // 却下理由を次の生成で避ける
  const notes = rejected
    .map((i) => i.decisionNote.trim())
    .filter(Boolean)
    .slice(-5);
  if (notes.length && notes.join() !== prev.avoidNotes.join()) {
    next.avoidNotes = notes;
    changes.push(`避けるべき点を ${notes.length}件 反映`);
  }

  // 承認した提案の実際の文量に寄せる
  const lengths = approved.map((i) => i.body.split("---").pop()?.length ?? 0).filter((n) => n > 100);
  if (lengths.length >= 2) {
    const avg = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length / 50) * 50;
    if (Math.abs(avg - prev.targetProposalChars) >= 100) {
      next.targetProposalChars = Math.max(300, Math.min(1200, avg));
      changes.push(`提案文の狙う文字数を ${prev.targetProposalChars} → ${next.targetProposalChars} に変更`);
    }
  }

  // 実績の時給から、案件を切る基準を調整する
  const stats = computeStats(readEntries(), readPaths());
  if (stats.hourlyJpy !== null && stats.minutes >= 600) {
    // 実績の8割を下限にする。ただし最低賃金は下回らせない。
    const target = Math.max(DEFAULT_MIN_WAGE_JPY, Math.round((stats.hourlyJpy * 0.8) / 50) * 50);
    if (Math.abs(target - prev.minHourlyJpy) >= 100) {
      next.minHourlyJpy = target;
      changes.push(
        `案件を切る実効時給の基準を ${prev.minHourlyJpy.toLocaleString()} → ${target.toLocaleString()}円 に変更（実績の時給 ${stats.hourlyJpy.toLocaleString()}円 の8割）`
      );
    }
  }

  if (changes.length === 0) {
    ctx.log("info", "調整すべき差はありませんでした");
    return { summary: "調整なし" };
  }

  writeLearned(next);
  for (const c of changes) ctx.log("decision", `自己調整: ${c}`);
  return { summary: `${changes.length}件を自己調整` };
}

// ---------------------------------------------------------------------------

export const STEP_IMPL: Record<StepId, (ctx: StepContext) => Promise<StepOutcome>> = {
  ingest: stepIngest,
  triage: stepTriage,
  draft: stepDraft,
  plan: stepPlan,
  review: stepReview,
  learn: stepLearn,
};

export type { InboxItem };
