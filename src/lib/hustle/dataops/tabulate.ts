/**
 * 集計 — アンケート集計・実績集計・相場表づくり。
 *
 * 「回答CSVを渡すので集計して」という案件の中身は、
 * 度数分布・複数回答の分解・クロス集計・数値要約でほぼ尽きる。全部決定的処理。
 */
import { normalizeText } from "./normalize";

export interface ValueCount {
  value: string;
  count: number;
  /** 全行に対する割合（0-100、小数1桁） */
  percent: number;
}

/**
 * 度数分布。splitMulti を渡すと「読書、映画、音楽」のような複数回答を分解して数える。
 * 空欄は「(無回答)」として数える。黙って落とすと合計が合わなくなる。
 */
export function valueCounts(
  rows: Record<string, string>[],
  column: string,
  options: { splitMulti?: RegExp } = {}
): ValueCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = normalizeText(row[column] ?? "");
    const values = raw
      ? options.splitMulti
        ? raw.split(options.splitMulti).map((v) => v.trim()).filter(Boolean)
        : [raw]
      : ["(無回答)"];
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const total = rows.length || 1;
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count, percent: Math.round((count / total) * 1000) / 10 }))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1));
}

export interface CrossTab {
  rowValues: string[];
  colValues: string[];
  cells: number[][];
  rowTotals: number[];
  colTotals: number[];
  total: number;
}

/** クロス集計（例: 年代×満足度）。 */
export function crossTab(rows: Record<string, string>[], rowColumn: string, colColumn: string): CrossTab {
  const rv: string[] = [];
  const cv: string[] = [];
  const index = (list: string[], v: string) => {
    const i = list.indexOf(v);
    if (i >= 0) return i;
    list.push(v);
    return list.length - 1;
  };
  const pairs: [number, number][] = [];
  for (const row of rows) {
    const r = normalizeText(row[rowColumn] ?? "") || "(無回答)";
    const c = normalizeText(row[colColumn] ?? "") || "(無回答)";
    pairs.push([index(rv, r), index(cv, c)]);
  }
  const cells = rv.map(() => cv.map(() => 0));
  for (const [r, c] of pairs) cells[r][c]++;
  return {
    rowValues: rv,
    colValues: cv,
    cells,
    rowTotals: cells.map((line) => line.reduce((a, b) => a + b, 0)),
    colTotals: cv.map((_, c) => cells.reduce((a, line) => a + line[c], 0)),
    total: rows.length,
  };
}

export interface NumericSummary {
  count: number;
  invalid: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  sum: number;
}

/** 数値列の要約。数値にならないセルは invalid に数えて、黙って0扱いしない。 */
export function numericSummary(rows: Record<string, string>[], column: string): NumericSummary {
  const nums: number[] = [];
  let invalid = 0;
  for (const row of rows) {
    const raw = normalizeText(row[column] ?? "").replace(/[,円¥￥]/g, "");
    if (!raw) { invalid++; continue; }
    const n = Number(raw);
    if (Number.isFinite(n)) nums.push(n);
    else invalid++;
  }
  nums.sort((a, b) => a - b);
  const sum = nums.reduce((a, b) => a + b, 0);
  const mid = Math.floor(nums.length / 2);
  return {
    count: nums.length,
    invalid,
    min: nums[0] ?? 0,
    max: nums[nums.length - 1] ?? 0,
    mean: nums.length ? Math.round((sum / nums.length) * 100) / 100 : 0,
    median: nums.length ? (nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2) : 0,
    sum,
  };
}
