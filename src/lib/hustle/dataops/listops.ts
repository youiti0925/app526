/**
 * リスト操作 — 名寄せ・重複統合・NGリスト除外・差分。
 *
 * ホテル案件の実要件そのまま:
 * 「NGリスト138社と既存300件に重複しないこと」「同一運営会社は表記ゆれ含めて除外」。
 * この種の条件は企業リスト・店舗リスト案件のほぼ全部に付いてくる。
 */
import { corpKey, phoneKey, urlKey, normalizeText } from "./normalize";

export type KeyKind = "corp" | "phone" | "url" | "text";

export function makeKey(kind: KeyKind, value: string): string | null {
  if (kind === "corp") return corpKey(value) || null;
  if (kind === "phone") return phoneKey(value);
  if (kind === "url") return urlKey(value);
  return normalizeText(value).toLowerCase() || null;
}

export interface DedupeResult {
  kept: Record<string, string>[];
  removed: { row: Record<string, string>; duplicateOf: number; key: string }[];
}

/**
 * 名寄せ。指定列の正規化キーが一致した行を重複として畳む（先勝ち）。
 * キーが作れない行（空欄等）は重複判定できないので残す。
 */
export function dedupeRows(
  rows: Record<string, string>[],
  keys: { column: string; kind: KeyKind }[]
): DedupeResult {
  const seen = new Map<string, number>();
  const kept: Record<string, string>[] = [];
  const removed: DedupeResult["removed"] = [];
  for (const row of rows) {
    let dupIndex: number | null = null;
    let dupKey = "";
    const rowKeys: string[] = [];
    for (const { column, kind } of keys) {
      const k = makeKey(kind, row[column] ?? "");
      if (!k) continue;
      const composite = `${column}:${k}`;
      rowKeys.push(composite);
      const at = seen.get(composite);
      if (at !== undefined && dupIndex === null) {
        dupIndex = at;
        dupKey = composite;
      }
    }
    if (dupIndex !== null) {
      removed.push({ row, duplicateOf: dupIndex, key: dupKey });
      continue;
    }
    const index = kept.push(row) - 1;
    for (const k of rowKeys) seen.set(k, index);
  }
  return { kept, removed };
}

export interface NgFilterResult {
  kept: Record<string, string>[];
  excluded: { row: Record<string, string>; matchedNg: string; how: "exact" | "contains" }[];
  /** 機械では白黒つけられず、人が見るべき行（カナ⇔英字の表記違いの可能性など）。 */
  review: { row: Record<string, string>; reason: string }[];
}

/**
 * NGリスト除外。法人名は正規化キーで完全一致と包含（「ソラーレ」⊂「ソラーレホテルズ」）を見る。
 * カナ表記と英字表記の同一性（ソラーレ ⇔ Solare）は機械では判定できないため、
 * 英字だけの行・カナだけのNG名は review に出して人に回す。黙って通さない。
 */
export function excludeByNgList(
  rows: Record<string, string>[],
  column: string,
  ngNames: string[]
): NgFilterResult {
  const ngKeys = ngNames.map((n) => ({ raw: n, key: corpKey(n) })).filter((n) => n.key);
  const kept: Record<string, string>[] = [];
  const excluded: NgFilterResult["excluded"] = [];
  const review: NgFilterResult["review"] = [];
  for (const row of rows) {
    const value = row[column] ?? "";
    const key = corpKey(value);
    if (!key) {
      review.push({ row, reason: `${column} が空か、名寄せキーを作れません` });
      continue;
    }
    const hit = ngKeys.find((n) => n.key === key) ?? ngKeys.find((n) => key.includes(n.key) || n.key.includes(key));
    if (hit) {
      excluded.push({ row, matchedNg: hit.raw, how: hit.key === key ? "exact" : "contains" });
      continue;
    }
    // 英字のみの名前は、カナ表記のNGリストと機械照合できない
    const isLatinOnly = /^[a-z0-9]+$/.test(key);
    const ngHasKana = ngKeys.some((n) => /[ぁ-んァ-ヶ]/.test(n.key));
    if (isLatinOnly && ngHasKana) {
      review.push({ row, reason: "英字表記のため、カナ表記のNGリストと機械照合できません（例: Solare ⇔ ソラーレ）。目視確認へ" });
    }
    kept.push(row);
  }
  return { kept, excluded, review };
}

/** 既存リストとの差分。既存に無い行だけ返す（重複納品の防止）。 */
export function diffAgainstExisting(
  rows: Record<string, string>[],
  existing: Record<string, string>[],
  keys: { column: string; kind: KeyKind }[]
): { fresh: Record<string, string>[]; alreadyListed: Record<string, string>[] } {
  const existingKeys = new Set<string>();
  for (const row of existing) {
    for (const { column, kind } of keys) {
      const k = makeKey(kind, row[column] ?? "");
      if (k) existingKeys.add(`${column}:${k}`);
    }
  }
  const fresh: Record<string, string>[] = [];
  const alreadyListed: Record<string, string>[] = [];
  for (const row of rows) {
    const isDup = keys.some(({ column, kind }) => {
      const k = makeKey(kind, row[column] ?? "");
      return k !== null && existingKeys.has(`${column}:${k}`);
    });
    (isDup ? alreadyListed : fresh).push(row);
  }
  return { fresh, alreadyListed };
}
