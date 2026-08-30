/**
 * 差し込み — 書類作成の自動処理の骨格。
 *
 * 「テンプレート + データ行 → 行ごとの文書」。案内文の宛名差し、見積書、
 * report の定型文まで全部この形。埋まらなかった穴は必ず報告する
 * （実案件の試作で全滅した原因が「穴を黙って飛ばして納品」だったため）。
 */

export interface MergeDoc {
  text: string;
  missing: string[];
}

/** {{列名}} を row の値で埋める。無い列は空で埋めず missing に報告して穴を残す。 */
export function fillTemplate(template: string, row: Record<string, string>): MergeDoc {
  const missing = new Set<string>();
  const text = template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, name: string) => {
    const key = name.trim();
    const value = (row[key] ?? "").trim();
    if (!value) {
      missing.add(key);
      return `{{${key}}}`;
    }
    return value;
  });
  return { text, missing: [...missing] };
}

export interface MailMergeResult {
  docs: MergeDoc[];
  complete: number;
  incomplete: number;
  /** テンプレートに1度も出てこない列（渡したのに使われていないデータ）。 */
  unusedColumns: string[];
}

/** 全行に差し込む。完成数と穴あき数を数え、使われなかった列も報告する。 */
export function mailMerge(template: string, rows: Record<string, string>[]): MailMergeResult {
  const docs = rows.map((row) => fillTemplate(template, row));
  const used = new Set([...template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => m[1].trim()));
  const allColumns = new Set(rows.flatMap((r) => Object.keys(r)));
  return {
    docs,
    complete: docs.filter((d) => d.missing.length === 0).length,
    incomplete: docs.filter((d) => d.missing.length > 0).length,
    unusedColumns: [...allColumns].filter((c) => !used.has(c)),
  };
}
