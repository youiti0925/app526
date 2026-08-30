/**
 * AI併用エンジンの純ロジック部 — プロンプト組み立てと応答の検品。
 *
 * 設計はカスケード: ①決定的処理で確定 → ②残った曖昧分だけAI → ③それでも不明なら人。
 * AIのコストは「曖昧行の件数」にしか比例しない。全行にAIを掛けない。
 *
 * ここはネットワークを触らない（テスト可能）。実際の呼び出しは agent/aiops.ts。
 * AIの答えは信用しない前提で、応答は必ずここの検品を通す:
 * - 根拠の引用（quote）が元テキストに実在しない → 幻覚扱いで人へ
 * - 形式が決定的検証（validate.ts）を通らない → 人へ
 * - 範囲外・欠落・不正な値 → 人へ
 */
import { isValidJpPhone, isDummyPhone, isHttpUrl, isEmail } from "./validate";

/** バッチ分割。1回の呼び出しに詰める件数でコストが決まる。 */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 何回のAI呼び出しになるかの事前見積り。画面で実行前に見せる。 */
export function estimateCalls(itemCount: number, batchSize: number): number {
  return Math.ceil(Math.max(0, itemCount) / Math.max(1, batchSize));
}

// --- ① 表記ゆれの同一判定（カナ⇔英字など機械で無理だった残り）----------------

export const MATCH_BATCH = 25;

export interface MatchPair {
  a: string;
  b: string;
}

export interface MatchVerdict {
  index: number;
  verdict: "same" | "different" | "unsure";
  reason: string;
  needsHuman: boolean;
}

export function buildMatchPrompt(pairs: MatchPair[]): string {
  const lines = pairs.map((p, i) => `${i}: 「${p.a}」 と 「${p.b}」`);
  return [
    "あなたは日本の企業名・施設名の名寄せ担当です。",
    "次の各ペアが同一の組織・施設を指すか判定してください。",
    "カナ表記と英字表記（例: ソラーレ・ホテルズ ⇔ Solare Hotels）、法人格の違い、略称を考慮します。",
    "確信が持てないものは必ず unsure にしてください。推測で same にしないこと。",
    "",
    ...lines,
    "",
    'JSONのみで回答: {"items":[{"index":0,"verdict":"same|different|unsure","reason":"20字以内"}]}',
  ].join("\n");
}

/** 応答の検品。欠落・不正は unsure（=人へ）に倒す。 */
export function parseMatchResponse(raw: unknown, pairCount: number): MatchVerdict[] {
  const items = (raw as { items?: unknown })?.items;
  const byIndex = new Map<number, { verdict?: unknown; reason?: unknown }>();
  if (Array.isArray(items)) {
    for (const it of items) {
      const idx = (it as { index?: unknown })?.index;
      if (typeof idx === "number" && idx >= 0 && idx < pairCount) byIndex.set(idx, it as { verdict?: unknown; reason?: unknown });
    }
  }
  const out: MatchVerdict[] = [];
  for (let i = 0; i < pairCount; i++) {
    const it = byIndex.get(i);
    const v = it?.verdict;
    const verdict = v === "same" || v === "different" || v === "unsure" ? v : "unsure";
    out.push({
      index: i,
      verdict,
      reason: typeof it?.reason === "string" ? it.reason.slice(0, 80) : "応答なし",
      needsHuman: verdict === "unsure",
    });
  }
  return out;
}

// --- ② 自由記述の分類（アンケート集計のAI強化）--------------------------------

export const CLASSIFY_BATCH = 30;

export interface Classified {
  index: number;
  category: string;
  quote: string;
  needsHuman: boolean;
  reason: string;
}

export function buildClassifyPrompt(texts: string[], categories: string[]): string {
  const lines = texts.map((t, i) => `${i}: ${t.replace(/\s+/g, " ").slice(0, 200)}`);
  return [
    "あなたはアンケートの自由記述を分類する担当です。",
    `カテゴリ: ${categories.join(" / ")}`,
    "各回答を最も近い1カテゴリに分類し、判断根拠として回答内の語句をそのまま1つ引用してください。",
    "どれにも当てはまらない・判断できない場合は category を「分類不能」にしてください。",
    "",
    ...lines,
    "",
    'JSONのみで回答: {"items":[{"index":0,"category":"...","quote":"回答内の語句そのまま"}]}',
  ].join("\n");
}

export function parseClassifyResponse(raw: unknown, texts: string[], categories: string[]): Classified[] {
  const items = (raw as { items?: unknown })?.items;
  const byIndex = new Map<number, { category?: unknown; quote?: unknown }>();
  if (Array.isArray(items)) {
    for (const it of items) {
      const idx = (it as { index?: unknown })?.index;
      if (typeof idx === "number" && idx >= 0 && idx < texts.length) byIndex.set(idx, it as { category?: unknown; quote?: unknown });
    }
  }
  return texts.map((text, i) => {
    const it = byIndex.get(i);
    const category = typeof it?.category === "string" ? it.category : "分類不能";
    const quote = typeof it?.quote === "string" ? it.quote : "";
    if (!categories.includes(category)) {
      return { index: i, category: "分類不能", quote, needsHuman: true, reason: "カテゴリ一覧に無い分類が返った" };
    }
    // 幻覚ガード: 引用が元テキストに実在するか
    if (!quote || !text.includes(quote)) {
      return { index: i, category, quote, needsHuman: true, reason: "根拠の引用が回答本文に見つからない" };
    }
    return { index: i, category, quote, needsHuman: false, reason: "" };
  });
}

// --- ③ 非定型テキストからの項目抽出（正規表現で拾えないレイアウト）--------------

export interface FieldSpec {
  name: string;
  /** phone/url/email なら決定的検証も掛ける */
  kind: "phone" | "url" | "email" | "text";
}

export interface ExtractedField {
  name: string;
  value: string;
  quote: string;
  needsHuman: boolean;
  reason: string;
}

export function buildFieldExtractPrompt(text: string, fields: FieldSpec[]): string {
  return [
    "あなたはデータ入力担当です。次のテキストから指定項目を抜き出してください。",
    "値はテキスト内の記載をそのまま使い、推測で補完しないこと。",
    "見つからない項目は value を空文字にすること。",
    "各項目に、根拠となるテキスト内の語句を quote としてそのまま付けること。",
    `項目: ${fields.map((f) => f.name).join(" / ")}`,
    "",
    "--- テキスト ---",
    text.slice(0, 6000),
    "--- ここまで ---",
    "",
    'JSONのみで回答: {"fields":[{"name":"...","value":"...","quote":"..."}]}',
  ].join("\n");
}

export function parseFieldExtractResponse(raw: unknown, text: string, fields: FieldSpec[]): ExtractedField[] {
  const items = (raw as { fields?: unknown })?.fields;
  const byName = new Map<string, { value?: unknown; quote?: unknown }>();
  if (Array.isArray(items)) {
    for (const it of items) {
      const name = (it as { name?: unknown })?.name;
      if (typeof name === "string") byName.set(name, it as { value?: unknown; quote?: unknown });
    }
  }
  return fields.map((spec) => {
    const it = byName.get(spec.name);
    const value = typeof it?.value === "string" ? it.value.trim() : "";
    const quote = typeof it?.quote === "string" ? it.quote : "";
    if (!value) return { name: spec.name, value: "", quote, needsHuman: true, reason: "テキスト中に見つからなかった" };
    if (!quote || !text.includes(quote)) {
      return { name: spec.name, value, quote, needsHuman: true, reason: "根拠の引用が元テキストに無い（幻覚の疑い）" };
    }
    if (spec.kind === "phone" && (!isValidJpPhone(value) || isDummyPhone(value))) {
      return { name: spec.name, value, quote, needsHuman: true, reason: "電話番号の決定的検証を通らない" };
    }
    if (spec.kind === "url" && !isHttpUrl(value)) {
      return { name: spec.name, value, quote, needsHuman: true, reason: "URLの決定的検証を通らない" };
    }
    if (spec.kind === "email" && !isEmail(value)) {
      return { name: spec.name, value, quote, needsHuman: true, reason: "メールアドレスの決定的検証を通らない" };
    }
    return { name: spec.name, value, quote, needsHuman: false, reason: "" };
  });
}

// --- ④ 整文・ケバ取り（文字起こし・議事録のAI強化）----------------------------

export type RewriteMode = "kebatori" | "seibun" | "paraphrase";

export function buildRewritePrompt(text: string, mode: RewriteMode): string {
  const instruction =
    mode === "kebatori"
      ? "「えー」「あのー」等のフィラーと言い直しだけを取り除いてください。言葉の追加・要約・言い換えは禁止です。"
      : mode === "seibun"
        ? "意味を変えずに書き言葉へ整えてください。内容の追加・省略は禁止です。"
        : "内容を保ったまま、別の言い回しに書き換えてください（転載回避のため）。事実の追加・削除は禁止です。";
  return [
    "あなたは文字起こしの整形担当です。",
    instruction,
    "",
    "--- 原文 ---",
    text.slice(0, 8000),
    "--- ここまで ---",
    "",
    'JSONのみで回答: {"text":"整形後の全文"}',
  ].join("\n");
}

export interface RewriteResult {
  text: string;
  needsHuman: boolean;
  reason: string;
}

/**
 * 整文の検品。長さの激変（大幅な省略・水増し）は機械で検知できるので弾く。
 * 意味が保たれているかは機械では確認できない — 整文は常に「人が読む」前提で返す。
 */
export function parseRewriteResponse(raw: unknown, original: string, mode: RewriteMode): RewriteResult {
  const text = typeof (raw as { text?: unknown })?.text === "string" ? ((raw as { text: string }).text ?? "").trim() : "";
  if (!text) return { text: "", needsHuman: true, reason: "応答が空" };
  const ratio = text.length / Math.max(1, original.length);
  const [lo, hi] = mode === "kebatori" ? [0.5, 1.1] : mode === "seibun" ? [0.5, 1.5] : [0.5, 2.0];
  if (ratio < lo || ratio > hi) {
    return { text, needsHuman: true, reason: `長さが原文の${Math.round(ratio * 100)}%になっており、省略か水増しの疑い` };
  }
  return { text, needsHuman: true, reason: "整文は意味の保存を機械で確認できないため、必ず読んでから納品してください" };
}
