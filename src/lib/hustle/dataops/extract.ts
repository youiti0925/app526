/**
 * 抽出 — 生テキスト（HTML剥がし後・コピペ・PDFテキスト）から定型項目を拾う。
 *
 * 正規表現だけで動く。AIは使わない。
 * 拾い漏れより「拾ったものが本物か」が問題になるので、判定は validate / crosscheck に分離。
 */
import { normalizeWidth } from "./normalize";

/** HTMLからタグ・script・styleを落として素のテキストにする。 */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 日本の電話番号らしき並びを重複なしで全部拾う。 */
export function extractPhones(text: string): string[] {
  const t = normalizeWidth(text);
  const found = t.match(/(?:\+81[-\s]?)?0\d{1,3}[-(]?\d{1,4}[-)]?\d{3,4}/g) ?? [];
  return [...new Set(found.map((s) => s.trim()))];
}

export function extractEmails(text: string): string[] {
  const found = normalizeWidth(text).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  return [...new Set(found.map((s) => s.toLowerCase()))];
}

export function extractUrls(text: string): string[] {
  const found = normalizeWidth(text).match(/https?:\/\/[^\s<>"'）)、。]+/g) ?? [];
  return [...new Set(found.map((s) => s.replace(/[.,)]+$/, "")))];
}

export function extractPostals(text: string): string[] {
  const found = normalizeWidth(text).match(/〒\s*\d{3}-?\d{4}/g) ?? [];
  return [...new Set(found.map((s) => s.replace(/〒\s*/, "").replace(/^(\d{3})(\d{4})$/, "$1-$2")))];
}

/**
 * 金額を円建てで拾う。「1件200円」「¥45,000」「2万円」「1.5万円」に対応。
 * 返り値は数値（円）と元表記のペア。相場表作成・価格調査の頻出処理。
 */
export function extractPricesJpy(text: string): { jpy: number; raw: string }[] {
  const t = normalizeWidth(text);
  const out: { jpy: number; raw: string }[] = [];
  const seen = new Set<string>();
  // 万円表記（小数対応）
  for (const m of t.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*万\s*円/g)) {
    const jpy = Math.round(parseFloat(m[1]) * 10_000);
    if (!seen.has(m[0])) { seen.add(m[0]); out.push({ jpy, raw: m[0] }); }
  }
  // 円表記・¥表記
  for (const m of t.matchAll(/(?:¥|￥)\s*([0-9][0-9,]*)|([0-9][0-9,]*)\s*円/g)) {
    if (/万\s*円$/.test(m[0])) continue;
    const digits = (m[1] ?? m[2]).replace(/,/g, "");
    const jpy = parseInt(digits, 10);
    if (Number.isFinite(jpy) && !seen.has(m[0])) { seen.add(m[0]); out.push({ jpy, raw: m[0].trim() }); }
  }
  return out;
}

/** 法人名らしき並びを拾う。前株・後株・主要な法人格に対応。 */
export function extractCorpNames(text: string): string[] {
  const t = normalizeWidth(text).replace(/\s+/g, " ");
  const KAKU = "株式会社|有限会社|合同会社|一般社団法人|一般財団法人|特定非営利活動法人|医療法人|学校法人|社会福祉法人";
  const NAME = "[A-Za-z0-9ぁ-んァ-ヶー一-龠々&'・．.\\-]{2,25}";
  // 後株は直前の助詞（「運営は○○株式会社」の「は」）を巻き込みやすいので、
  // ひらがなを含めない。ひらがな社名の後株は拾えないが、誤抽出よりましと判断。
  const NAME_BACK = "[A-Za-z0-9ァ-ヶー一-龠々&'・．.\\-]{2,25}";
  const found: string[] = [];
  // 前株は直後の助詞・語尾（「株式会社○○です」の「です」）を巻き込みやすいので、
  // 末尾のひらがな3文字までは落とす。「ゆうちょ銀行」のように途中のひらがなは残る。
  for (const m of t.matchAll(new RegExp(`(?:${KAKU})\\s?${NAME}`, "g")))
    found.push(m[0].replace(/\s/g, "").replace(/[ぁ-ん]{1,3}$/, ""));
  for (const m of t.matchAll(new RegExp(`${NAME_BACK}\\s?(?:${KAKU})`, "g"))) found.push(m[0].replace(/\s/g, ""));
  return [...new Set(found)];
}

/** 日付（YYYY年M月D日 / YYYY/MM/DD / YYYY-MM-DD）を ISO 形式で拾う。 */
export function extractDates(text: string): string[] {
  const t = normalizeWidth(text);
  const out = new Set<string>();
  for (const m of t.matchAll(/(20\d{2})[年/\-.](\d{1,2})[月/\-.](\d{1,2})日?/g)) {
    const [y, mo, d] = [m[1], m[2].padStart(2, "0"), m[3].padStart(2, "0")];
    if (+m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) out.add(`${y}-${mo}-${d}`);
  }
  return [...out];
}

export interface ExtractedFields {
  phones: string[];
  emails: string[];
  urls: string[];
  postals: string[];
  prices: { jpy: number; raw: string }[];
  corpNames: string[];
  dates: string[];
}

/** 1テキストから全項目をまとめて抽出する。リスト作成案件の1行分の材料になる。 */
export function extractAll(text: string): ExtractedFields {
  const plain = /<[a-z!/]/i.test(text) ? stripHtml(text) : text;
  return {
    phones: extractPhones(plain),
    emails: extractEmails(plain),
    urls: extractUrls(plain),
    postals: extractPostals(plain),
    prices: extractPricesJpy(plain),
    corpNames: extractCorpNames(plain),
    dates: extractDates(plain),
  };
}
