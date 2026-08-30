/**
 * 検証 — 拾った値が「本物として通用するか」の機械判定。
 *
 * ホテル案件の発注者が怒っていたのは「電話番号が使用されていない」「運営会社が出鱈目」。
 * 原因は、抽出した値を検証せずにそのまま納品する作り。ここで機械的に弾けるものを弾き、
 * 弾き切れないものは「人が見る行」へ回す。
 */
import { phoneKey, normalizeWidth } from "./normalize";

/** 日本の電話番号として桁数・先頭が成立しているか。 */
export function isValidJpPhone(raw: string): boolean {
  return phoneKey(raw) !== null;
}

/**
 * ダミー・埋め草くさい電話番号。テンプレートの 06-0000-0000 や 03-1234-5678 など。
 * 実在サイトのフッターにこの手の番号が刺さったまま、という事故が本当にある。
 */
export function isDummyPhone(raw: string): boolean {
  const key = phoneKey(raw);
  if (!key) return true;
  const local = key.slice(-8);
  if (/^(\d)\1+$/.test(local)) return true; // 00000000, 11111111 …
  if (/(?:0000|9999)$/.test(key) && /(?:0000|9999)/.test(key.slice(0, -4).slice(-4))) return true; // 0000-0000 系
  if (/1234-?5678$/.test(raw.replace(/\s/g, "")) || key.endsWith("12345678")) return true;
  if (/^(0120|0800)(\d)\2{2,}/.test(key) && /^(\d)\1+$/.test(key.slice(4))) return true;
  return false;
}

export function isEmail(raw: string): boolean {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(normalizeWidth(raw).trim());
}

export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(normalizeWidth(raw).trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function isPostal(raw: string): boolean {
  return /^〒?\s*\d{3}-?\d{4}$/.test(normalizeWidth(raw).trim());
}

/** 価格が指定帯に入っているか。「7千〜1.6万円」のような案件条件の機械判定。 */
export function inPriceBand(jpy: number, minJpy: number, maxJpy: number): boolean {
  return Number.isFinite(jpy) && jpy >= minJpy && jpy <= maxJpy;
}

export interface RowCheck {
  ok: boolean;
  missing: string[];
  invalid: { column: string; value: string; reason: string }[];
}

export type ColumnRule =
  | { kind: "required" }
  | { kind: "phone" }
  | { kind: "email" }
  | { kind: "url" }
  | { kind: "postal" }
  | { kind: "priceBand"; minJpy: number; maxJpy: number }
  | { kind: "pattern"; pattern: RegExp; label: string };

/**
 * 1行を列ルールで検査する。募集文の「リストアップ項目」をそのままルール化して、
 * 納品前に「全項目が埋まっていて形式が正しいか」を機械で確認する。
 * 実案件9件の試作で全滅した原因が「項目を黙って飛ばす」だったので、ここは省かない。
 */
export function checkRow(row: Record<string, string>, rules: Record<string, ColumnRule[]>): RowCheck {
  const missing: string[] = [];
  const invalid: RowCheck["invalid"] = [];
  for (const [column, columnRules] of Object.entries(rules)) {
    const value = (row[column] ?? "").trim();
    for (const rule of columnRules) {
      if (rule.kind === "required" && !value) {
        missing.push(column);
        continue;
      }
      if (!value) continue;
      if (rule.kind === "phone" && !isValidJpPhone(value)) invalid.push({ column, value, reason: "電話番号の形になっていません" });
      if (rule.kind === "phone" && isValidJpPhone(value) && isDummyPhone(value)) invalid.push({ column, value, reason: "ダミー番号の疑い" });
      if (rule.kind === "email" && !isEmail(value)) invalid.push({ column, value, reason: "メールアドレスの形になっていません" });
      if (rule.kind === "url" && !isHttpUrl(value)) invalid.push({ column, value, reason: "URLの形になっていません" });
      if (rule.kind === "postal" && !isPostal(value)) invalid.push({ column, value, reason: "郵便番号の形になっていません" });
      if (rule.kind === "priceBand") {
        const jpy = parseInt(value.replace(/[^\d]/g, ""), 10);
        if (!inPriceBand(jpy, rule.minJpy, rule.maxJpy)) invalid.push({ column, value, reason: `条件の価格帯(${rule.minJpy}〜${rule.maxJpy}円)を外れています` });
      }
      if (rule.kind === "pattern" && !rule.pattern.test(value)) invalid.push({ column, value, reason: rule.label });
    }
  }
  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}
