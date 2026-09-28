/**
 * 検品（機械の部分）と、手本との照合。
 *
 * 合格の基準をここに1か所で持つ。「何割が要確認なら作り直すか」を
 * あちこちに書くと、どこかで甘くなる。
 */
import { checkRow } from "../dataops/validate";
import { normalizeText, phoneKey, urlKey } from "../dataops/normalize";
import type { Recipe } from "./recipe";
import { SRC, srcOf, toColumnRule, type Row, type RowIssue } from "./ops";

/** AIが原因の要確認（error）の行がこの割合を超えたら「不合格」として、上位モデルでのやり直しに回す。 */
export const MAX_ERROR_ROW_RATE = 0.2;
/**
 * 機械の規則（形式・ダミー番号など）で引っかかった行の許容割合。
 * 元データそのものの問題（依頼者の表にダミー番号が入っている等）は、手順書を直しても消えないので
 * 少しなら不合格にしない（人が要確認として見る）。ただし半分を超えるなら手順の誤りを疑う
 * （例: 違う列から電話番号を抜いている）。
 */
export const MAX_RULE_ERROR_ROW_RATE = 0.5;
/** 手本との一致率がこれ未満なら、その手順書は使わない。 */
export const MIN_TEST_ACCURACY = 0.8;
/** 比較試験で「安いモデルでも足りる」とみなす一致率。 */
export const MIN_SWITCH_ACCURACY = 0.95;

export function checkOutput(recipe: Pick<Recipe, "output">, rows: Row[]): RowIssue[] {
  const issues: RowIssue[] = [];
  const rules: Record<string, ReturnType<typeof toColumnRule>[]> = {};
  for (const [col, specs] of Object.entries(recipe.output.rules)) rules[col] = specs.map(toColumnRule);
  const clean = Object.fromEntries(
    Object.entries(rules).map(([c, list]) => [c, list.filter((r): r is NonNullable<typeof r> => !!r)])
  );
  for (const row of rows) {
    const r = checkRow(row, clean);
    for (const m of r.missing) issues.push({ src: srcOf(row), column: m, reason: "必須の項目が空です", severity: "error", fromAi: false });
    for (const v of r.invalid) issues.push({ src: srcOf(row), column: v.column, reason: v.reason, severity: "error", fromAi: false });
  }
  return issues;
}

/** 同じ行・同じ列・同じ理由の重複をまとめる。 */
export function dedupeIssues(issues: RowIssue[]): RowIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.src}\u0000${i.column}\u0000${i.reason}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface QualitySummary {
  rows: number;
  errorRows: number;
  warnRows: number;
  /** 要確認の行の割合（表示用。原因を問わない）。 */
  errorRate: number;
  /** AIが原因の要確認の行の割合。 */
  aiErrorRate: number;
  /** 機械の規則だけで引っかかった行の割合。 */
  ruleErrorRate: number;
  aiErrorRows: number[];
  pass: boolean;
  /** 手順書を直せば良くなる見込みがあるか（元データの問題だけなら、直しても消えない）。 */
  fixable: boolean;
}

export function summarize(rows: Row[], issues: RowIssue[], extraFailure = false): QualitySummary {
  const present = new Set(rows.map(srcOf));
  const errs = issues.filter((i) => i.severity === "error" && present.has(i.src));
  const errorRows = new Set(errs.map((i) => i.src));
  const warnRows = new Set(issues.filter((i) => i.severity === "warn" && present.has(i.src) && !errorRows.has(i.src)).map((i) => i.src));
  const aiErrorRows = [...new Set(errs.filter((i) => i.fromAi).map((i) => i.src))];
  const ruleRows = new Set(errs.filter((i) => !i.fromAi).map((i) => i.src));
  const n = rows.length;
  const rate = (k: number) => (n === 0 ? 0 : k / n);
  const aiErrorRate = rate(aiErrorRows.length);
  const ruleErrorRate = rate(ruleRows.size);
  const fixable = extraFailure || aiErrorRate > MAX_ERROR_ROW_RATE || ruleErrorRate > MAX_RULE_ERROR_ROW_RATE;
  return {
    rows: n,
    errorRows: errorRows.size,
    warnRows: warnRows.size,
    errorRate: rate(errorRows.size),
    aiErrorRate,
    ruleErrorRate,
    aiErrorRows,
    pass: n > 0 && !fixable,
    fixable,
  };
}

/** 出力列だけを並べ直す（内部用の `_` 列は落とす）。 */
export function project(rows: Row[], columns: string[]): Row[] {
  return rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? ""])));
}

/** 照合用に値をそろえる。電話・URLは正規化キーで、それ以外は表記ゆれを畳んで比べる。 */
export function cellKey(value: string): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  const p = phoneKey(v);
  if (p && /^[\d\s()+\-－ー‐]+$/.test(v)) return `tel:${p}`;
  if (/^https?:\/\//i.test(v)) return `url:${urlKey(v) ?? v.toLowerCase()}`;
  return normalizeText(v).toLowerCase().replace(/\s+/g, "");
}

export interface TestComparison {
  accuracy: number;
  cells: number;
  matched: number;
  mismatches: { index: number; column: string; expected: string; actual: string }[];
}

/**
 * 手本との照合。行は `_src`（手本の何行目か）で突き合わせる。
 * 手順が行を落としてしまった場合、その行の全セルを不一致として数える。
 */
export function compareToExpected(actual: Row[], expected: Row[], columns: string[]): TestComparison {
  const cols = columns.length > 0 ? columns : [...new Set(expected.flatMap((r) => Object.keys(r)))].filter((c) => c !== SRC);
  const bySrc = new Map(actual.map((r) => [srcOf(r), r]));
  const mismatches: TestComparison["mismatches"] = [];
  let cells = 0;
  let matched = 0;
  expected.forEach((exp, index) => {
    const act = bySrc.get(index);
    for (const c of cols) {
      cells++;
      const e = exp[c] ?? "";
      const a = act?.[c] ?? "";
      if (cellKey(e) === cellKey(a)) matched++;
      else mismatches.push({ index, column: c, expected: e, actual: act ? a : "（行が出力されていない）" });
    }
  });
  return { accuracy: cells === 0 ? 0 : matched / cells, cells, matched, mismatches };
}
