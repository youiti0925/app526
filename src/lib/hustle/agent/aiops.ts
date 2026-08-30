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
  REWRITE_PROMPT_MAX,
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

/**
 * 整文・ケバ取り・言い換え。
 * プロンプトに入る上限（8,000字）を超える原文は分割して順に処理する。
 * 以前は先頭だけ処理して後半が黙って消えていた（レビューで実証）。
 * 枠が尽きた分は原文のまま残し、未処理と明示する。
 */
export async function aiRewrite(text: string, mode: RewriteMode, budget: CallBudget): Promise<{ result: RewriteResult; meta: AiRunMeta }> {
  const pieces = chunk([...segmentByLength(text, REWRITE_PROMPT_MAX)], 1).map((p) => p[0]);
  const outputs: string[] = [];
  const reasons = new Set<string>();
  let used = 0;
  let degraded = false;
  for (const piece of pieces) {
    if (!budget.take()) {
      degraded = true;
      outputs.push(piece);
      reasons.add(exhausted("AI枠切れ。以降は原文のまま未処理"));
      continue;
    }
    used++;
    const raw = await generateJson<unknown>(buildRewritePrompt(piece, mode), { temperature: mode === "paraphrase" ? 0.7 : 0.2, maxOutputTokens: 8192 });
    const parsed = parseRewriteResponse(raw, piece, mode);
    outputs.push(parsed.text || piece);
    if (parsed.reason) reasons.add(parsed.reason);
    if (!parsed.text) reasons.add("一部の区間で応答が空だったため原文のまま残した");
  }
  if (pieces.length > 1) reasons.add(`原文が長いため${pieces.length}分割で処理した。つなぎ目を確認すること`);
  return {
    result: { text: outputs.join("\n"), needsHuman: true, reason: [...reasons].join(" / ") },
    meta: { callsUsed: used, callsBudget: budget.spent + budget.remaining, degraded },
  };
}

/** 改行をなるべく尊重して maxLen 以下の断片に切る。 */
function segmentByLength(text: string, maxLen: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen);
    const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf("。"));
    const at = cut > maxLen * 0.5 ? cut + 1 : maxLen;
    out.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  if (rest) out.push(rest);
  return out;
}
