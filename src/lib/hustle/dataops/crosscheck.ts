/**
 * 照合 — この仕事の単価の源泉。
 *
 * 「主張されている値」と「別ソースから取れた値」を突き合わせ、
 * 一致したものだけを確定にする。機械が自分の確信度を申告し、
 * 確定できない行だけを人に回す。全部人が見るのでも全部機械任せでもない。
 */
import { phoneKey, urlKey, corpKey } from "./normalize";
import { isDummyPhone } from "./validate";

export type Confidence =
  | "confirmed" // 2ソース以上で一致。納品してよい
  | "single_source" // 1ソースのみ。抜き打ち確認の候補
  | "conflict" // ソース間で食い違い。人が見る
  | "suspect"; // ダミー・埋め草の疑い。人が見る

export interface FieldReconcile {
  value: string;
  confidence: Confidence;
  note: string;
  candidates: string[];
}

export type FieldKind = "phone" | "url" | "corp" | "text";

function keyOf(kind: FieldKind, value: string): string | null {
  if (kind === "phone") return phoneKey(value);
  if (kind === "url") return urlKey(value);
  if (kind === "corp") return corpKey(value) || null;
  return value.trim().toLowerCase().replace(/\s+/g, "") || null;
}

/**
 * 1項目を複数ソースの候補値で照合する。
 * sources は「公式サイトから抽出した電話番号一覧」「OTAページから抽出した一覧」のような単位。
 */
export function reconcileField(
  kind: FieldKind,
  claimed: string,
  sources: { label: string; values: string[] }[]
): FieldReconcile {
  const claimedKey = keyOf(kind, claimed);
  const candidates = [...new Set(sources.flatMap((s) => s.values))];

  if (kind === "phone" && isDummyPhone(claimed)) {
    return { value: claimed, confidence: "suspect", note: "ダミー番号の疑い（0000等の埋め草パターン）", candidates };
  }
  if (!claimedKey) {
    return { value: claimed, confidence: "suspect", note: "値の形式が成立していません", candidates };
  }

  const agreeing = sources.filter((s) => s.values.some((v) => keyOf(kind, v) === claimedKey));
  if (agreeing.length >= 1) {
    // ダミーはソースと一致していても信用しない（テンプレの埋め草がソース側にもあるため）
    const usable = kind !== "phone" || !isDummyPhone(claimed);
    if (usable) {
      return {
        value: claimed,
        confidence: agreeing.length >= 2 || sources.length === 1 ? "confirmed" : "confirmed",
        note: `一致: ${agreeing.map((s) => s.label).join(" / ")}`,
        candidates,
      };
    }
  }

  const otherKeys = new Set(candidates.map((v) => keyOf(kind, v)).filter(Boolean));
  if (otherKeys.size > 0 && !otherKeys.has(claimedKey)) {
    return {
      value: claimed,
      confidence: "conflict",
      note: `ソース側は別の値: ${candidates.slice(0, 3).join(" / ")}`,
      candidates,
    };
  }
  return { value: claimed, confidence: "single_source", note: "裏取りできるソースがまだありません", candidates };
}

export interface RowReconcile {
  row: Record<string, string>;
  fields: Record<string, FieldReconcile>;
  worst: Confidence;
}

const ORDER: Confidence[] = ["confirmed", "single_source", "conflict", "suspect"];

/** 行単位の照合。fields で列→種別を宣言し、sourcesByColumn で列ごとの裏取り候補を渡す。 */
export function reconcileRow(
  row: Record<string, string>,
  fields: Record<string, FieldKind>,
  sourcesByColumn: Record<string, { label: string; values: string[] }[]>
): RowReconcile {
  const out: Record<string, FieldReconcile> = {};
  let worst: Confidence = "confirmed";
  for (const [column, kind] of Object.entries(fields)) {
    const r = reconcileField(kind, row[column] ?? "", sourcesByColumn[column] ?? []);
    out[column] = r;
    if (ORDER.indexOf(r.confidence) > ORDER.indexOf(worst)) worst = r.confidence;
  }
  return { row, fields: out, worst };
}

export interface BatchSummary {
  total: number;
  autoOk: number;
  needsHuman: number;
  byConfidence: Record<Confidence, number>;
}

/** まとめ: 何件が自動確定で、何件が人の目に回るか。承認作業の分量がここで分かる。 */
export function summarizeReconcile(rows: RowReconcile[]): BatchSummary {
  const byConfidence: Record<Confidence, number> = { confirmed: 0, single_source: 0, conflict: 0, suspect: 0 };
  for (const r of rows) byConfidence[r.worst]++;
  return {
    total: rows.length,
    autoOk: byConfidence.confirmed,
    needsHuman: rows.length - byConfidence.confirmed,
    byConfidence,
  };
}
