/**
 * 検品（AIの部分）— 機械の検品で拾えない「依頼の意図とずれていないか」を見る。
 *
 * 作業したモデルとは別の呼び出しで、既定は中くらいのモデル。
 * 同じ文脈で自分の作業を採点させると甘くなる（試作→採点で実際にそうだった）。
 * 1ジョブにつき1回、抜粋だけを見せるので、使用量は小さい。
 */
import type { Recipe } from "./recipe";
import { SRC, srcOf, type Row, type RowIssue } from "./ops";

export const REVIEW_SAMPLE = 12;

export const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    problems: {
      type: "array",
      items: {
        type: "object",
        properties: { src: { type: "integer" }, column: { type: "string" }, problem: { type: "string" } },
        required: ["src", "column", "problem"],
      },
    },
    systemic: { type: "string" },
  },
  required: ["problems", "systemic"],
};

/** 機械の検品で引っかからなかった行を優先して抜く（そこをAIに見てほしい）。 */
export function pickReviewSample(rows: Row[], issues: RowIssue[], n = REVIEW_SAMPLE): Row[] {
  const flagged = new Set(issues.filter((i) => i.severity === "error").map((i) => i.src));
  const clean = rows.filter((r) => !flagged.has(srcOf(r)));
  const dirty = rows.filter((r) => flagged.has(srcOf(r)));
  const step = Math.max(1, Math.floor(clean.length / Math.max(1, n - 2)));
  const picked = clean.filter((_, i) => i % step === 0).slice(0, n - Math.min(2, dirty.length));
  return [...picked, ...dirty.slice(0, n - picked.length)];
}

export function buildReviewPrompt(
  job: { instructions: string },
  recipe: Pick<Recipe, "name" | "summary" | "output">,
  sample: Row[],
  total: number,
  issueCount: number
): string {
  const cols = recipe.output.columns;
  const hidden = [...new Set(sample.flatMap((r) => Object.keys(r)))].filter((k) => k.startsWith("_") && k !== SRC).slice(0, 2);
  return [
    "あなたは、納品前の検品担当です。依頼内容と、作業結果の抜粋を見て、問題を指摘してください。",
    "- 依頼の条件（納品列・形式・除外条件・表記）を満たしているか",
    "- 明らかにおかしい値（別の対象の情報、ダミー、不自然な重複、原文と食い違う値）",
    "行ごとの問題は problems に（src は行番号）、手順そのものの誤りで全体に及ぶ問題は systemic に書いてください。",
    "問題がなければ problems は空配列、systemic は空文字。細かい好みの問題は書かないでください。",
    "",
    "## 依頼",
    job.instructions.slice(0, 4000),
    "",
    `## 手順書: ${recipe.name}`,
    recipe.summary.slice(0, 500),
    "",
    `## 作業結果（全${total}行から${sample.length}行を抜粋。機械の検品で既に${issueCount}件の要確認あり）`,
    ...sample.map((r) =>
      [
        `### src=${srcOf(r)}`,
        ...cols.map((c) => `${c}: ${(r[c] ?? "").slice(0, 200)}`),
        ...hidden.map((h) => `（材料 ${h}: ${(r[h] ?? "").replace(/\s+/g, " ").slice(0, 300)}）`),
      ].join("\n")
    ),
  ].join("\n");
}

export interface ReviewResult {
  issues: RowIssue[];
  systemic: string;
}

export function parseReviewResponse(raw: unknown, sample: Row[]): ReviewResult {
  const r = (raw ?? {}) as { problems?: unknown; systemic?: unknown };
  const valid = new Set(sample.map(srcOf));
  const issues: RowIssue[] = [];
  if (Array.isArray(r.problems)) {
    for (const p of r.problems.slice(0, 50)) {
      const src = (p as { src?: unknown })?.src;
      const column = (p as { column?: unknown })?.column;
      const problem = (p as { problem?: unknown })?.problem;
      if (typeof src !== "number" || !valid.has(src) || typeof problem !== "string" || !problem.trim()) continue;
      issues.push({ src, column: typeof column === "string" ? column.slice(0, 60) : "", reason: `検品AI: ${problem.slice(0, 200)}`, severity: "error", fromAi: true });
    }
  }
  return { issues, systemic: typeof r.systemic === "string" ? r.systemic.trim().slice(0, 500) : "" };
}
