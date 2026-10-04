/**
 * 案件判定と提案文 — 募集文を1件渡すと、判定・提案文・確認事項まで出す（専用会話から使う）。
 *
 * 中身は自律運転と同じ工程（stepTriage → stepDraft）を、この1件だけに回すもの。
 * 詐欺・関門（機密・資格が要る仕事・個人情報集め）・納期・実効時給はルールで決め、
 * AIは「作業量の見積り」と「提案文」だけに使う。ルールで落ちた案件はAIが何と言っても通さない。
 * ルールで判定しきれない案件（報酬や作業量が読めない等）だけ、Claude に判定させる
 * （その答えも applyVerdicts で金額と時間から検算される）。
 *
 * AIは HUSTLE_AI_PROVIDER=claude のとき、サブスクの Claude（既定は中くらいのモデル）。
 */
import { createHash } from "crypto";
import { insertLead, readInbox, readLeadsByIds, updateLead } from "../agent/db";
import { runAgent } from "../agent/runner";
import { applyVerdicts, buildBrief, collectEscalations, type EscalationVerdict } from "../agent/escalation";
import type { InboxItem, Lead } from "../agent/types";
import { callClaudeCli, QuotaPauseError } from "./models";
import { listRecipes, recordUsage } from "./db";
import { scoreRecipes } from "./router";
import { readBudgetFromText, titleFromText } from "./judge-core";

export { readBudgetFromText, titleFromText };

const RANGE = { type: "object", properties: { low: { type: "number" }, high: { type: "number" } }, required: ["low", "high"] };

/** 判定しきれない案件を Claude に判定させるときの答えの形（scripts/claude-batch.mjs と同じ）。 */
export const ESCALATION_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          leadId: { type: "string" },
          estimatedHours: RANGE,
          basis: { type: "string" },
          offeredJpy: { type: ["number", "null"] },
          verdict: { type: "string", enum: ["reject", "verify_first", "proceed"] },
          reason: { type: "string" },
          risks: { type: "array", items: { type: "string" } },
          proposal: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["leadId", "estimatedHours", "basis", "verdict", "reason", "proposal", "confidence"],
      },
    },
  },
  required: ["verdicts"],
};

export interface JudgeInput {
  text: string;
  title?: string;
  url?: string;
  budgetJpy?: number | null;
}

export interface JudgeResult {
  lead: Lead;
  /** 仕事ラインに、この型を処理できる手順書があるか（キーワードの一致から）。 */
  automation: { name: string; score: number; hits: string[] } | null;
  /** この案件について承認キューに出たもの（提案文・交渉文・応募前の確認・危険通知）。 */
  items: InboxItem[];
  /** ルールで判定しきれず、Claude に判定させたか。 */
  escalated: boolean;
  note: string;
}

export interface EscalationOutcome {
  /** Claude に判定を頼んだ件数。 */
  requested: number;
  applied: number;
  note: string;
}

/**
 * ルールで判定しきれなかった案件（報酬や作業量が読めない等）を、まとめて Claude に判定させる。
 * 答えは applyVerdicts が金額と時間から検算してから反映する。leadIds を渡すと、その案件だけを対象にする。
 * 使用上限に当たったら QuotaPauseError を投げる（黙って判定保留にしない）。
 */
export async function resolveEscalations(leadIds?: string[], limit = 5): Promise<EscalationOutcome> {
  const want = leadIds ? new Set(leadIds) : null;
  const pending = collectEscalations(100).filter((e) => !want || want.has(e.leadId)).slice(0, limit);
  if (pending.length === 0) return { requested: 0, applied: 0, note: "" };
  const res = await callClaudeCli({ purpose: "judge", tier: "standard", prompt: buildBrief(pending), schema: ESCALATION_SCHEMA });
  recordUsage({ ...res.usage, jobId: null, recipeId: null });
  if (res.quota) throw new QuotaPauseError(res.error ?? "使用上限に達しました");
  const asked = new Set(pending.map((p) => p.leadId));
  const all = ((res.data as { verdicts?: unknown })?.verdicts ?? []) as EscalationVerdict[];
  const mine = Array.isArray(all) ? all.filter((v) => v && asked.has(v.leadId)) : [];
  if (!res.ok || mine.length === 0) {
    return {
      requested: pending.length,
      applied: 0,
      note: `ルールで判定しきれず、Claudeの判定も得られませんでした（${res.error ?? "答えが空"}）。募集文を読んで人が判断してください`,
    };
  }
  const applied = applyVerdicts(mine, "judge");
  return {
    requested: pending.length,
    applied: applied.applied,
    note: applied.skipped.length ? `Claudeの判定を反映できませんでした: ${applied.skipped.map((s) => s.why).join(" / ")}` : "",
  };
}

export async function judgeLead(input: JudgeInput): Promise<JudgeResult> {
  const text = input.text.trim();
  if (text.length < 20) throw new Error("募集文が短すぎます（20文字以上）");
  const started = new Date().toISOString();
  // 同じ募集文をもう一度貼ったら、同じ案件として判定し直す（重複登録しない）
  const externalId = `judge:${createHash("sha1").update(text).digest("hex").slice(0, 16)}`;
  const { lead, created } = insertLead({
    source: "manual",
    externalId,
    url: input.url ?? "",
    title: input.title?.trim() || titleFromText(text),
    rawText: text,
    budgetJpy: input.budgetJpy ?? readBudgetFromText(text),
  });
  if (!created) {
    updateLead(lead.id, {
      status: "new", verdict: "unknown", triage: {},
      title: input.title?.trim() || titleFromText(text),
      budgetJpy: input.budgetJpy ?? readBudgetFromText(text),
    });
  }

  const outcome = await runAgent({ trigger: "manual", force: true, only: ["triage", "draft"] });
  if (!outcome.ran) throw new Error(`判定を実行できませんでした: ${outcome.reason ?? ""}`);

  const resolved = await resolveEscalations([lead.id]);
  const escalated = resolved.requested > 0;
  const note = resolved.note;

  const current = readLeadsByIds([lead.id]).get(lead.id) ?? lead;
  // 今回の判定で出たものだけ（同じ募集文を前に判定したときの分は含めない）
  const items = readInbox(undefined, 300).filter((i) => i.leadId === lead.id && i.createdAt >= started);
  const [top] = scoreRecipes({ instructions: text, headers: [] }, listRecipes());
  const automation = top && top.keywordHits.length >= 2 ? { name: top.name, score: top.score, hits: top.keywordHits } : null;
  return { lead: current, automation, items, escalated, note };
}

/** 承認キューの本文から、提案文の本体だけを取り出す（前後の判定メモとチェックリストを外す）。 */
export function proposalBody(item: InboxItem): string {
  const parts = item.body.split("\n\n---\n\n");
  return (parts.length >= 2 ? parts[1] : item.body).trim();
}
