/**
 * AI併用エンジンの実行部（サーバー側）。
 *
 * aiops-core が組んだプロンプトを Gemini に投げ、応答を core の検品に通す。
 * CallBudget で呼び出し回数に上限を掛け、使い切ったら残りは
 * 「AI枠切れ・人へ」に縮退する（例外で止めない）。
 */
import { generateJson } from "../ai";
import { CallBudget } from "./budget";
import {
  chunk,
  MATCH_BATCH, type MatchPair, type MatchVerdict, buildMatchPrompt, parseMatchResponse,
  CLASSIFY_BATCH, type Classified, buildClassifyPrompt, parseClassifyResponse,
  type FieldSpec, type ExtractedField, buildFieldExtractPrompt, parseFieldExtractResponse,
  type RewriteMode, type RewriteResult, buildRewritePrompt, parseRewriteResponse,
} from "../dataops/aiops-core";

export interface AiRunMeta {
  callsUsed: number;
  callsBudget: number;
  degraded: boolean;
}

const exhausted = (reason: string) => reason;

/** 表記ゆれの同一判定。budget が尽きた分は unsure で返す。 */
export async function aiMatchPairs(pairs: MatchPair[], budget: CallBudget): Promise<{ verdicts: MatchVerdict[]; meta: AiRunMeta }> {
  const verdicts: MatchVerdict[] = [];
  let used = 0;
  let degraded = false;
  let offset = 0;
  for (const batch of chunk(pairs, MATCH_BATCH)) {
    if (!budget.take()) {
      degraded = true;
      verdicts.push(...batch.map((_, i) => ({
        index: offset + i,
        verdict: "unsure" as const,
        reason: exhausted("AI枠切れ"),
        needsHuman: true,
      })));
      offset += batch.length;
      continue;
    }
    used++;
    const raw = await generateJson<unknown>(buildMatchPrompt(batch), { temperature: 0, maxOutputTokens: 2048 });
    const parsed = parseMatchResponse(raw, batch.length);
    verdicts.push(...parsed.map((v) => ({ ...v, index: v.index + offset })));
    offset += batch.length;
  }
  return { verdicts, meta: { callsUsed: used, callsBudget: budget.spent + budget.remaining, degraded } };
}

/** 自由記述の分類。 */
export async function aiClassify(texts: string[], categories: string[], budget: CallBudget): Promise<{ items: Classified[]; meta: AiRunMeta }> {
  const items: Classified[] = [];
  let used = 0;
  let degraded = false;
  let offset = 0;
  for (const batch of chunk(texts, CLASSIFY_BATCH)) {
    if (!budget.take()) {
      degraded = true;
      items.push(...batch.map((_, i) => ({
        index: offset + i,
        category: "分類不能",
        quote: "",
        needsHuman: true,
        reason: exhausted("AI枠切れ"),
      })));
      offset += batch.length;
      continue;
    }
    used++;
    const raw = await generateJson<unknown>(buildClassifyPrompt(batch, categories), { temperature: 0, maxOutputTokens: 3072 });
    const parsed = parseClassifyResponse(raw, batch, categories);
    items.push(...parsed.map((c) => ({ ...c, index: c.index + offset })));
    offset += batch.length;
  }
  return { items, meta: { callsUsed: used, callsBudget: budget.spent + budget.remaining, degraded } };
}

/** 非定型テキストからの項目抽出（1テキスト=1呼び出し）。 */
export async function aiExtractFields(text: string, fields: FieldSpec[], budget: CallBudget): Promise<{ fields: ExtractedField[]; meta: AiRunMeta }> {
  if (!budget.take()) {
    return {
      fields: fields.map((f) => ({ name: f.name, value: "", quote: "", needsHuman: true, reason: exhausted("AI枠切れ") })),
      meta: { callsUsed: 0, callsBudget: budget.spent + budget.remaining, degraded: true },
    };
  }
  const raw = await generateJson<unknown>(buildFieldExtractPrompt(text, fields), { temperature: 0, maxOutputTokens: 2048 });
  return { fields: parseFieldExtractResponse(raw, text, fields), meta: { callsUsed: 1, callsBudget: budget.spent + budget.remaining, degraded: false } };
}

/** 整文・ケバ取り・言い換え（1テキスト=1呼び出し）。 */
export async function aiRewrite(text: string, mode: RewriteMode, budget: CallBudget): Promise<{ result: RewriteResult; meta: AiRunMeta }> {
  if (!budget.take()) {
    return {
      result: { text: "", needsHuman: true, reason: exhausted("AI枠切れ") },
      meta: { callsUsed: 0, callsBudget: budget.spent + budget.remaining, degraded: true },
    };
  }
  const raw = await generateJson<unknown>(buildRewritePrompt(text, mode), { temperature: mode === "paraphrase" ? 0.7 : 0.2, maxOutputTokens: 8192 });
  return { result: parseRewriteResponse(raw, text, mode), meta: { callsUsed: 1, callsBudget: budget.spent + budget.remaining, degraded: false } };
}
