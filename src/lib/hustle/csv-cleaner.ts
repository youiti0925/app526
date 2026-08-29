export interface CsvCleanOptions {
  normalizeWidth: boolean;
  trimCells: boolean;
  removeBlankRows: boolean;
  removeDuplicates: boolean;
}

export interface CsvCleanStats {
  inputRows: number;
  outputRows: number;
  columns: number;
  blankRowsRemoved: number;
  duplicatesRemoved: number;
  cellsChanged: number;
  irregularRows: number;
}

export interface CsvCleanResult {
  delimiter: "," | "\t" | ";";
  rows: string[][];
  csv: string;
  stats: CsvCleanStats;
  warnings: string[];
}

export const DEFAULT_CSV_CLEAN_OPTIONS: CsvCleanOptions = {
  normalizeWidth: true,
  trimCells: true,
  removeBlankRows: true,
  removeDuplicates: true,
};

type Delimiter = CsvCleanResult["delimiter"];

function parseDelimited(text: string, delimiter: Delimiter): { rows: string[][]; unterminatedQuote: boolean } {
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return { rows, unterminatedQuote: quoted };
}

function delimiterScore(rows: string[][]): number {
  const sample = rows.slice(0, 50).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (sample.length === 0) return 0;

  const counts = new Map<number, number>();
  for (const row of sample) counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
  const [columns, matches] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (columns <= 1) return 0;
  return matches * 100 + columns;
}

export function detectDelimiter(text: string): Delimiter {
  const candidates: Delimiter[] = [",", "\t", ";"];
  return candidates
    .map((delimiter) => ({ delimiter, score: delimiterScore(parseDelimited(text, delimiter).rows) }))
    .sort((a, b) => b.score - a.score)[0].delimiter;
}

function cleanCell(value: string, options: CsvCleanOptions): string {
  let out = value.replace(/\r\n?/g, "\n");
  if (options.normalizeWidth) out = out.normalize("NFKC");
  if (options.trimCells) out = out.trim();
  return out;
}

function serializeCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function serializeCsv(rows: string[][]): string {
  // BOM を付けると、日本語CSVをWindows版Excelで開いても文字化けしにくい。
  return `\uFEFF${rows.map((row) => row.map(serializeCell).join(",")).join("\r\n")}`;
}

export function cleanCsv(text: string, options: CsvCleanOptions = DEFAULT_CSV_CLEAN_OPTIONS): CsvCleanResult {
  const delimiter = detectDelimiter(text);
  const parsed = parseDelimited(text, delimiter);
  const inputRows = parsed.rows.length;
  const nonEmptyWidths = parsed.rows.filter((row) => row.some((cell) => cell.trim() !== "")).map((row) => row.length);
  const widthCounts = new Map<number, number>();
  for (const width of nonEmptyWidths) widthCounts.set(width, (widthCounts.get(width) ?? 0) + 1);
  const expectedColumns = [...widthCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const irregularRows = nonEmptyWidths.filter((width) => width !== expectedColumns).length;

  let blankRowsRemoved = 0;
  let duplicatesRemoved = 0;
  let cellsChanged = 0;
  const seen = new Set<string>();
  const rows: string[][] = [];

  for (const original of parsed.rows) {
    const cleaned = original.map((cell) => {
      const next = cleanCell(cell, options);
      if (next !== cell) cellsChanged++;
      return next;
    });

    if (options.removeBlankRows && cleaned.every((cell) => cell === "")) {
      blankRowsRemoved++;
      continue;
    }

    const key = JSON.stringify(cleaned);
    if (options.removeDuplicates && seen.has(key)) {
      duplicatesRemoved++;
      continue;
    }
    seen.add(key);
    rows.push(cleaned);
  }

  const warnings: string[] = [];
  if (parsed.unterminatedQuote) warnings.push("閉じていないダブルクォートがあります。元ファイルの末尾を確認してください。");
  if (irregularRows > 0) warnings.push(`列数が他の行と異なる行が ${irregularRows} 行あります。納品前に目視確認してください。`);
  if (expectedColumns <= 1) warnings.push("区切り文字を判定できませんでした。CSVまたはTSV形式か確認してください。");

  return {
    delimiter,
    rows,
    csv: serializeCsv(rows),
    stats: {
      inputRows,
      outputRows: rows.length,
      columns: expectedColumns,
      blankRowsRemoved,
      duplicatesRemoved,
      cellsChanged,
      irregularRows,
    },
    warnings,
  };
}
