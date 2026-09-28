/**
 * 手順書づくり・改修のプロンプト（純関数）。
 *
 * 新しい型の仕事が来たとき、上位モデルに次の2つを同時に作らせる:
 * 1. 手順書（決められた操作だけを組み合わせたJSON）
 * 2. 手本（入力の先頭数行を、上位モデル自身が依頼どおりに作業した正解）
 * 手順書を軽いモデルで手本の行に掛け、手本と一致すれば採用する。
 * 「最初の1回はClaudeが自分でやり、そのやり方を手順書に落とす」を形にしたもの。
 */
import { OP_CATALOG, type Recipe } from "./recipe";
import { toCsvText } from "../dataops/table";
import type { Row } from "./ops";
import type { TestComparison } from "./checks";

export const AUTHOR_SAMPLE_ROWS = 3;

export const AUTHOR_SCHEMA = {
  type: "object",
  properties: {
    feasible: { type: "boolean" },
    reason: { type: "string" },
    recipe: { type: "object" },
    expected: { type: "array", items: { type: "object" } },
  },
  required: ["feasible", "reason", "recipe", "expected"],
};

export interface AuthorJob {
  title: string;
  instructions: string;
  headers: string[];
  rows: Row[];
  lists: Record<string, string[]>;
}

const catalogText = () =>
  Object.entries(OP_CATALOG)
    .map(([op, c]) => `- ${op}${c.ai ? "（AI）" : ""}: ${c.summary}\n  例: ${c.shape}`)
    .join("\n");

const RULES = [
  "## 手順書の決まり",
  "- 使えるのは上の操作だけ。操作の中身（プログラム）は書けない",
  "- 各操作が参照できる列は、入力の列か、それより前の工程で作った列だけ",
  "- `_` で始まる列は内部用（ページ本文など）。納品物には出さない",
  "- 機械でできること（extract / normalize / dedupe / exclude）を先に使い、AI操作は必要な所だけにする",
  "- AI操作の tier は原則 \"light\"。軽いモデルでは無理な判断を含む操作だけ \"standard\"",
  "- output.columns に、依頼が指定する納品列を指定どおりの順で並べる",
  "- output.rules に、必須（required）や形式（phone / url / email / postal / priceBand / pattern / oneOf）を書く",
  "- match.keywords に、同じ型の依頼を見分けるための語を5〜15個（例: 施設名, 公式サイト, 電話番号, 照合）",
  "- 除外リストを使うときは exclude の listRef に、添付リストの名前をそのまま書く",
  "- Webで値（電話番号・住所など）を調べるときは、ai_lookup では公式ページのURLだけを探させ、値そのものは",
  "  fetch_page でページ本文を取ってから ai_extract で抜く。ai_lookup の中のページ読み取りは要約を経由するため、",
  "  値の取り違えが起きる（実際に確認済み）。ai_lookup で値まで取るのは、他に手が無いときだけ",
  "",
  "## 実現できない依頼",
  "次のどれかに当たるなら feasible を false にし、reason に理由を書く（recipe は {}、expected は []）:",
  "- 画像・スキャンPDFの読み取り、Excelの見た目（色・結合・関数）の再現が必要",
  "- ログインが必要なサイト・スクレイピング禁止のサイトからの取得が必要",
  "- 資格や責任を伴う判断（法律・税務・医療・安全区分の判定など）が必要",
  "- 個人の連絡先を集める作業",
  "- 上の操作の組み合わせでは、依頼の要件を満たせない",
].join("\n");

export function buildAuthorPrompt(job: AuthorJob, base: Recipe | null): string {
  const sample = job.rows.slice(0, AUTHOR_SAMPLE_ROWS);
  return [
    "あなたは、受託データ作業の「手順書」を書く担当です。",
    "次の依頼を、決められた操作だけを組み合わせた手順書（JSON）にしてください。",
    "この手順書は、このあと軽いモデルと機械が、あなた抜きで何度も実行します。",
    "",
    "## 依頼",
    `件名: ${job.title}`,
    job.instructions.slice(0, 6000),
    "",
    `## 入力の列: ${job.headers.join(" / ")}（全${job.rows.length}行）`,
    "## 入力の先頭行",
    toCsvText(job.rows.slice(0, 5), job.headers).replace(/^﻿/, ""),
    "",
    "## 添付リスト",
    Object.keys(job.lists).length === 0
      ? "なし"
      : Object.entries(job.lists).map(([name, items]) => `- ${name}（${items.length}件。例: ${items.slice(0, 3).join("、")}）`).join("\n"),
    "",
    base
      ? [
          "## 土台にする既存の手順書",
          "似た型の手順書です。これを土台に、この依頼に合わせて直してください（id は新しく付け直す）。",
          JSON.stringify(stripForPrompt(base)),
          "",
        ].join("\n")
      : "",
    "## 使える操作（これ以外は使えない）",
    catalogText(),
    "",
    RULES,
    "",
    "## 手本（expected）",
    `入力の先頭${sample.length}行について、あなた自身が依頼どおりに作業した結果を、納品列（output.columns）だけのオブジェクトで expected に${sample.length}個、同じ順で入れてください。`,
    "Webで調べる必要がある項目は、実際に検索してページを開き、確かめた値だけを書いてください。確かめられなければ空文字。",
    "この手本と、手順書を軽いモデルで実行した結果を突き合わせて、手順書を採用するか決めます。",
    "",
    "## recipe の形",
    '{"name":"…","summary":"…","match":{"keywords":[…],"description":"…"},"input":{"columns":[…]},"steps":[…],"output":{"columns":[…],"rules":{"列名":[{"kind":"required"}]}},"tier":"light"}',
  ].join("\n");
}

export interface FixContext {
  validationErrors?: string[];
  test?: TestComparison;
  quality?: { errorRate: number; topIssues: { column: string; reason: string; count: number }[]; systemic: string };
}

export const FIX_SCHEMA = {
  type: "object",
  properties: {
    feasible: { type: "boolean" },
    reason: { type: "string" },
    recipe: { type: "object" },
    expectedCorrections: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, column: { type: "string" }, value: { type: "string" }, reason: { type: "string" } },
        required: ["index", "column", "value", "reason"],
      },
    },
  },
  required: ["feasible", "reason", "recipe", "expectedCorrections"],
};

/**
 * recipe は検証済みの手順書でも、形の壊れた下書き（AIの返答そのまま）でもよい。
 * 形の誤りを直させるときは、壊れた下書きを見せないと何を直せばいいか伝わらない。
 */
export function buildFixPrompt(job: AuthorJob, recipe: Recipe | Record<string, unknown>, ctx: FixContext): string {
  const lines = [
    "あなたは、受託データ作業の「手順書」を直す担当です。",
    "次の手順書で作業したところ、問題が出ました。原因を考えて、手順書を直してください。",
    "",
    "## 依頼",
    job.instructions.slice(0, 4000),
    `## 入力の列: ${job.headers.join(" / ")}`,
    "",
    "## 今の手順書",
    JSON.stringify(isRecipe(recipe) ? stripForPrompt(recipe) : recipe).slice(0, 20000),
    "",
    "## 出た問題",
  ];
  if (ctx.validationErrors?.length) lines.push("手順書の形の誤り:", ...ctx.validationErrors.slice(0, 30).map((e) => `- ${e}`));
  if (ctx.test) {
    lines.push(
      `手本との一致率: ${Math.round(ctx.test.accuracy * 100)}%（${ctx.test.matched}/${ctx.test.cells}セル）`,
      "食い違い（手本 → 手順書の結果）:",
      ...ctx.test.mismatches.slice(0, 30).map((m) => `- ${m.index}行目 ${m.column}: 「${m.expected}」→「${m.actual}」`)
    );
  }
  if (ctx.quality) {
    lines.push(
      `要確認の行の割合: ${Math.round(ctx.quality.errorRate * 100)}%`,
      ...ctx.quality.topIssues.slice(0, 15).map((i) => `- ${i.column}: ${i.reason}（${i.count}行）`)
    );
    if (ctx.quality.systemic) lines.push(`検品担当の指摘: ${ctx.quality.systemic}`);
  }
  lines.push(
    "",
    "## 使える操作（これ以外は使えない）",
    catalogText(),
    "",
    RULES,
    "",
    "## 手本の訂正",
    "手本（正解）そのものが間違っていたと判断した場合だけ、expectedCorrections に訂正を書いてください。",
    "訂正は人が必ず確認します。手順書に合わせて手本を曲げることはしないでください。訂正が無ければ空配列。"
  );
  return lines.join("\n");
}

const isRecipe = (r: Recipe | Record<string, unknown>): r is Recipe =>
  typeof (r as Recipe).version === "number" && Array.isArray((r as Recipe).steps) && typeof (r as Recipe).stats === "object";

/** プロンプトに載せる手順書から、振り分けや統計など作業に関係ない部分を落とす。 */
function stripForPrompt(r: Recipe) {
  return { name: r.name, summary: r.summary, match: r.match, input: r.input, steps: r.steps, output: r.output, tier: r.tier };
}
