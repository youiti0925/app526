/**
 * 表の入出力 — CSVテキストと Record<string,string>[] の相互変換。
 * パースは csv-cleaner の実装を使い回す（引用符・区切り文字の判定を二重に持たない）。
 */
import { cleanCsv, serializeCsv, DEFAULT_CSV_CLEAN_OPTIONS } from "../csv-cleaner";

export interface Table {
  headers: string[];
  rows: Record<string, string>[];
}

/** 1行目をヘッダとして読む。整形（幅・空行・重複）は掛けず、素のまま行に割る。 */
export function parseTable(csvText: string): Table {
  const parsed = cleanCsv(csvText, { ...DEFAULT_CSV_CLEAN_OPTIONS, normalizeWidth: false, trimCells: true, removeBlankRows: true, removeDuplicates: false });
  const [headerRow, ...body] = parsed.rows;
  if (!headerRow) return { headers: [], rows: [] };
  const headers = headerRow.map((h, i) => h.trim() || `列${i + 1}`);
  const rows = body.map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
  return { headers, rows };
}

/** Record の配列をCSVテキストへ。列順は headers を渡せば固定、無ければ全行の出現順。 */
export function toCsvText(rows: Record<string, string>[], headers?: string[]): string {
  const cols = headers ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return serializeCsv([cols, ...rows.map((r) => cols.map((c) => r[c] ?? ""))]);
}
