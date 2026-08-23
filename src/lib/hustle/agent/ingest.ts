import type { Lead, LeadSource } from "./types";

/**
 * 案件の取り込み。
 *
 * ここに実装していいのは「公開されていて、機械での取得が明示的に許可されている」
 * 経路だけ。主要なクラウドソーシングは robots.txt と利用規約で自動巡回を
 * 禁止しているため、スクレイピングは実装しない。代わりに、
 * 通知メール・RSS・手動貼り付けという合法な入口を広くとる。
 */

export interface ParsedLead {
  externalId: string;
  title: string;
  url: string;
  rawText: string;
  budgetJpy: number | null;
  postedAt: string;
  source: LeadSource;
}

/** 本文から報酬額を読み取る。読めなければ null。 */
export function extractBudget(text: string): number | null {
  const normalized = text.normalize("NFKC");

  // 「10,000円」「1万円」「時給1200円」など。範囲表記は下限を採用する。
  const patterns: { re: RegExp; scale: number }[] = [
    { re: /(?:報酬|予算|単価|価格|金額)[^0-9]{0,12}([0-9,]+)\s*万\s*円/, scale: 10000 },
    { re: /(?:報酬|予算|単価|価格|金額)[^0-9]{0,12}([0-9,]+)\s*円/, scale: 1 },
    { re: /([0-9,]+)\s*万\s*円/, scale: 10000 },
    { re: /([0-9,]+)\s*円/, scale: 1 },
  ];

  for (const { re, scale } of patterns) {
    const m = normalized.match(re);
    if (!m) continue;
    const value = Number(m[1].replace(/,/g, "")) * scale;
    if (Number.isFinite(value) && value > 0 && value < 100_000_000) return value;
  }
  return null;
}

/** タイトルらしき行を拾う。 */
function guessTitle(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const bracketed = lines.find((l) => /^[【\[]/.test(l));
  return (bracketed ?? lines[0] ?? "").slice(0, 120);
}

/** 本文中の最初のURL。 */
function guessUrl(text: string): string {
  const m = text.match(/https?:\/\/[^\s<>"'）)]+/);
  return m ? m[0] : "";
}

/**
 * 内容から安定した識別子を作る。
 * 同じ案件を何度貼っても二重に積まれないようにするため。
 */
export function fingerprint(text: string): string {
  const normalized = text.normalize("NFKC").replace(/\s+/g, "").slice(0, 400);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}`;
}

/** 区切り線でまとめて貼り付けられたテキストを、案件ごとに割る。 */
export function splitPasted(raw: string): string[] {
  return raw
    .split(/^\s*-{3,}\s*$/m)
    .map((c) => c.trim())
    .filter((c) => c.length >= 20);
}

export function parsePasted(raw: string, source: LeadSource = "paste"): ParsedLead[] {
  return splitPasted(raw).map((chunk) => ({
    externalId: fingerprint(chunk),
    title: guessTitle(chunk),
    url: guessUrl(chunk),
    rawText: chunk,
    budgetJpy: extractBudget(chunk),
    postedAt: new Date().toISOString(),
    source,
  }));
}

// --- RSS / Atom -------------------------------------------------------------

const decodeEntities = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const stripTags = (s: string): string => decodeEntities(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const pick = (block: string, tag: string): string => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeEntities(m[1]).trim() : "";
};

/**
 * RSS 2.0 / Atom の最小パーサ。
 * 依存を増やさないために自前で書いている。壊れたXMLでも例外にしない。
 */
export function parseFeed(xml: string): ParsedLead[] {
  const items = [
    ...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi),
  ].map((m) => m[0]);

  const out: ParsedLead[] = [];
  for (const block of items) {
    const title = stripTags(pick(block, "title"));
    const description = stripTags(pick(block, "description") || pick(block, "summary") || pick(block, "content"));

    let url = pick(block, "link");
    if (!url) {
      const href = block.match(/<link[^>]*href=["']([^"']+)["']/i);
      url = href ? decodeEntities(href[1]) : "";
    }
    url = stripTags(url);

    const guid = stripTags(pick(block, "guid") || pick(block, "id")) || url;
    const posted = stripTags(pick(block, "pubDate") || pick(block, "updated") || pick(block, "published"));

    const rawText = [title, description].filter(Boolean).join("\n\n");
    if (rawText.length < 20) continue;

    const postedAt = posted ? new Date(posted) : new Date();
    out.push({
      externalId: guid || fingerprint(rawText),
      title: title.slice(0, 120),
      url,
      rawText,
      budgetJpy: extractBudget(rawText),
      postedAt: Number.isFinite(postedAt.getTime()) ? postedAt.toISOString() : new Date().toISOString(),
      source: "rss",
    });
  }
  return out;
}

/**
 * フィードを取得する。
 * 相手のサーバーに迷惑をかけないよう、タイムアウトを短くし、
 * User-Agent で身元を明示する。
 */
export async function fetchFeed(url: string, timeoutMs = 10_000): Promise<ParsedLead[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "hustle-pipeline/1.0 (personal side-job assistant; contact via app owner)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return parseFeed(await res.text());
  } finally {
    clearTimeout(timer);
  }
}

/** メールの引用記号や署名を落として、本文だけにする。 */
export function cleanEmail(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter((line) => !/^>+/.test(line))
    .filter((line) => !/^(?:--\s*$|配信停止|このメールは送信専用)/.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const leadFromParsed = (p: ParsedLead): Partial<Lead> & { rawText: string } => ({
  source: p.source,
  externalId: p.externalId,
  url: p.url,
  title: p.title,
  rawText: p.rawText,
  budgetJpy: p.budgetJpy,
  postedAt: p.postedAt,
});
