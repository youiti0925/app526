import { extractBudget, fingerprint } from "./ingest";
import type { Lead } from "./types";

/**
 * 案件の自動収集。
 *
 * ここに実装してよいのは、サイトマップやAPIで「機械が読むことを想定して」
 * 公開されている経路だけ。robots.txt で拒否されている取得、WAFで弾かれる取得、
 * 規約が自動アクセスを禁じている取得は実装しない。
 *
 * 節度について:
 * 相手のサーバーに負荷をかけないよう、1回の実行で取りに行く件数に上限を置き、
 * 前回以降に更新されたものだけを対象にし、1件ごとに間隔を空ける。
 * 詳細ページを全件舐めるようなことはしない。
 */

const UA = "hustle-pipeline/1.0 (personal side-job assistant; low-rate, sitemap-driven)";

export interface SourceDefinition {
  id: string;
  name: string;
  /** サイトマップのURL。索引なら子を辿る。 */
  sitemapUrl: string;
  /** 索引サイトマップか */
  isIndex: boolean;
  /** 案件ページのURLの形 */
  detailPattern: RegExp;
  /** 何が取れるか、規約上の注意 */
  note: string;
  /** 既定で有効にするか。規約が灰色のものは既定オフ。 */
  defaultEnabled: boolean;
  /**
   * 差分の取り方。
   * lastmod: サイトマップの更新日時で絞る（軽い）
   * seen:    更新日時が無いサイト向け。取り込み済みIDで絞る（サイトマップは毎回全部読む）
   */
  trackBy: "lastmod" | "seen";
}

export const SOURCES: SourceDefinition[] = [
  {
    id: "geechs",
    name: "ギークスジョブ",
    sitemapUrl: "https://geechs-job.com/sitemap.xml",
    isIndex: false,
    detailPattern: /\/project\/details\/\d+$/,
    trackBy: "lastmod",
    note:
      "フリーランスのIT案件が約10,100件。全件に更新日時が入っているので新着だけを拾えます。robots.txt は取得を禁止していません。本文はJSON-LDで取れます。",
    defaultEnabled: true,
  },
  {
    id: "itpropartners",
    name: "ITプロパートナーズ",
    sitemapUrl: "https://itpropartners.com/sitemap.xml",
    isIndex: false,
    detailPattern: /\/job\/detail\/\d+$/,
    trackBy: "seen",
    note:
      "週2日から入れる業務委託案件が約3,000件。エンジニア以外（マーケター・ディレクター）もあります。更新日時がサイトマップに無いので、取り込み済みかどうかで差分を取ります。",
    defaultEnabled: true,
  },
  {
    id: "coconala",
    name: "ココナラ 公開依頼",
    sitemapUrl: "https://coconala.com/sitemaps/category-requests-index.xml",
    isIndex: true,
    detailPattern: /\/requests\/\d+$/,
    trackBy: "lastmod",
    note:
      "公開依頼が約230件。実際に取り込んでみたところ、イラスト・動画編集・作曲といった「AIでは納品物を作れない」案件が大半でした。数は少ないので有効にしても負荷は小さいですが、期待はしないでください。",
    defaultEnabled: false,
  },
];

/**
 * 調べたが使えなかったサイト。同じ検証を繰り返さないために残す。
 * ここに書いてあるものは、コネクタとして実装しない。
 */
export const REJECTED_SOURCES: { name: string; why: string }[] = [
  {
    name: "レバテックフリーランス",
    why: "curl では取れるのに、プログラム（Node の fetch）からは全ページ HTTP 403。WAF がクライアントを見て弾いています。ブラウザのふりをすれば通る可能性はありますが、それは回避なのでしません。",
  },
  {
    name: "クラウドワークス",
    why: "robots.txt が ClaudeBot / GPTBot を名指しで Disallow: / にしています。このアプリはAIで動かす前提なので、名前を変えて通らず、使いません。",
  },
  {
    name: "ランサーズ",
    why: "robots.txt からして HTTP 405。AWS WAF がプログラムからのアクセスを弾いています。",
  },
  {
    name: "SKIMA / ストアカ / Green",
    why: "robots.txt で AI クローラを名指し拒否。",
  },
  {
    name: "クラウディア",
    why: "サイトマップは取れますが、中身の8,233件が出品者プロフィールで、案件ページはほぼありません。",
  },
  {
    name: "Indeed / スタンバイ / Workship / Midworks / PE-BANK / フリエン / シュフティ",
    why: "robots.txt は禁止していませんが、機械が読める入口（サイトマップ・RSS・API）が見つかりません。1ページずつ辿るのは相手の負荷になるのでしません。",
  },
];

interface SitemapEntry {
  url: string;
  lastmod: string;
}

async function get(url: string, timeoutMs = 20_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "application/xml, text/xml, text/html;q=0.9, */*;q=0.8" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export function parseSitemap(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const m of xml.matchAll(/<(?:url|sitemap)>([\s\S]*?)<\/(?:url|sitemap)>/g)) {
    const loc = m[1].match(/<loc>\s*([\s\S]*?)\s*<\/loc>/)?.[1]?.trim();
    if (!loc) continue;
    const lastmod = m[1].match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/)?.[1]?.trim() ?? "";
    out.push({ url: loc, lastmod });
  }
  return out;
}

/**
 * 前回の位置より後に更新された案件ページだけを、**古い順**で返す。
 *
 * 古い順なのが肝心。新しい順にすると、溜まった分より新着のほうが常に先に来るので、
 * 1回の上限を超えている限り毎回同じものを取りに行って、溜まった分が永久に減らない。
 * 実際そうなった（新着233件 / 上限2件で、2回目も同じ2件を取りに行った）。
 * 古い順に消化すれば、実行するたびに前回の位置が前に進み、いつか追いつく。
 *
 * 比較は「前回の位置**以降**」。「後」にすると、同じ日付のものを取りこぼす。
 * 実際、ココナラの lastmod は日付までしか無く、位置が 2026-08-09 に進んだ時点で
 * 同じ日の残り3件が黙って消えた。同日ぶんを拾い直すぶんは、取り込み済み判定で弾く。
 *
 * lastmod の無いページは対象外にする。更新日時が無いと位置を進められず、
 * 毎回そこで止まってしまうため。件数は undated として返し、黙って捨てない。
 */
export function selectNew(
  entries: SitemapEntry[],
  detailPattern: RegExp,
  since: string,
  isKnown: (url: string) => boolean = () => false,
  allowUndated = false
): { candidates: SitemapEntry[]; undated: number } {
  const details = entries.filter((e) => detailPattern.test(e.url));
  const usable = allowUndated ? details : details.filter((e) => Boolean(e.lastmod));
  return {
    candidates: usable
      .filter((e) => !since || (Boolean(e.lastmod) && e.lastmod >= since))
      .filter((e) => !isKnown(e.url))
      .sort((a, b) => a.lastmod.localeCompare(b.lastmod)),
    undated: allowUndated ? 0 : details.length - usable.length,
  };
}

/**
 * 次回の位置。
 * 「実際に見に行ったところまで」であって、「サイトマップで見えた一番新しいもの」ではない。
 * 見ていないものを飛ばすと、その案件は二度と拾われない。
 */
export function nextSince(attempted: SitemapEntry[], since: string): string {
  let mark = since;
  for (const e of attempted) {
    if (e.lastmod && e.lastmod > mark) mark = e.lastmod;
  }
  return mark;
}

/**
 * HTML から本文らしきところを取り出す。
 *
 * 素朴にタグを剥がすだけだと、先頭が全部ナビゲーションメニューになる。
 * 実際、ココナラの依頼ページは冒頭6,000文字がほぼメニューで、そのまま渡すと
 * 判定エンジンが「サービスを探す」「ブログを探す」を募集文だと思って読む。
 * そこで、CSSの断片と、何度も出てくる短い行（＝メニュー項目）を落としてから返す。
 */
export function extractText(html: string, maxChars = 6000): string {
  // JSON-LD の description が一番きれい。ただし単価や期間は本文側にしか無いことが
  // あるので、これだけで返さず、剥がした本文の前に置く。
  let jsonLd = "";
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        const desc = node?.description;
        if (typeof desc === "string" && desc.length > 80) {
          jsonLd = desc;
          break;
        }
      }
    } catch {
      // 次へ
    }
  }

  let stripped = html;
  for (const tag of ["script", "style", "svg", "noscript", "template", "nav", "header", "footer"]) {
    stripped = stripped.replace(new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, "gi"), " ");
  }

  const lines = stripped
    .replace(/<[^>]+>/g, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    // 閉じ忘れたスタイルブロックの残骸
    .filter((l) => !/[{};]\s*[\w-]+\s*:/.test(l));

  const body = cutAfterBody(dropRepeatedShortLines(lines)).join("\n").replace(/\n{3,}/g, "\n\n");
  return (jsonLd ? `${jsonLd}\n\n${body}` : body).slice(0, maxChars);
}

/**
 * 募集内容の後ろに付く、質問欄・関連案件・おすすめを切り落とす。
 *
 * ここを残すと、質問した人のハンドル名まで募集文として読まれる。
 * 実際、「採用サービスのアンケート担当者募集」が、質問欄にいた
 * 「nachuho_イラスト・動画・広報」というユーザー名のせいで
 * 「イラスト制作の案件」と誤判定された。
 */
const BODY_END_MARKERS = [
  /^募集内容についての質問/,
  /^(この|関連する)(募集|依頼|案件|サービス)/,
  /^(おすすめ|似た|その他)の(募集|依頼|案件|サービス|出品)/,
  /^(コメント|質問)(一覧|する)?$/,
  /^(よくある質問|FAQ)$/,
];

export function cutAfterBody(lines: string[]): string[] {
  const at = lines.findIndex((l) => BODY_END_MARKERS.some((m) => m.test(l)));
  // 先頭近くで当たったら、それは本文ではなくページの飾り。切らない。
  return at > 5 ? lines.slice(0, at) : lines;
}

/**
 * 短い行が何度も出てきたら、それはメニューかパンくずなので落とす。
 * 本文中の短い1行（「【必須条件】」など）は1回しか出てこないので残る。
 */
export function dropRepeatedShortLines(lines: string[], shortLen = 30): string[] {
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1);
  return lines.filter((l) => l.length >= shortLen || (counts.get(l) ?? 0) === 1);
}

function guessTitle(html: string, text: string): string {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  if (t) return t.replace(/\s+/g, " ").slice(0, 120);
  return text.split("\n")[0]?.slice(0, 120) ?? "";
}

export interface FetchOptions {
  /** この日時より後に更新されたものだけを対象にする */
  since: string;
  /** 1回の実行で詳細まで取りに行く上限 */
  maxDetails: number;
  /** 1件ごとに空ける間隔（ミリ秒） */
  delayMs: number;
  /** すでに取り込んだURLか。同じものを二度取りに行かないため。 */
  isKnown?: (url: string) => boolean;
}

export interface SourceResult {
  sourceId: string;
  /** サイトマップで見つかった新着の数 */
  found: number;
  /** 実際に詳細まで取れた数 */
  fetched: number;
  /** 上限を超えて今回は見送った数。次回に持ち越す。 */
  remaining: number;
  /** 更新日時が無くて対象外にした数 */
  undated: number;
  leads: (Partial<Lead> & { rawText: string })[];
  error: string | null;
  /** 次回の since に使う値 */
  newestLastmod: string;
}

/**
 * 1ソースぶん取り込む。
 * サイトマップで新着を絞ってから、上限まで詳細を取りに行く。
 */
export async function fetchSource(source: SourceDefinition, options: FetchOptions): Promise<SourceResult> {
  const result: SourceResult = {
    sourceId: source.id,
    found: 0,
    fetched: 0,
    remaining: 0,
    undated: 0,
    leads: [],
    error: null,
    newestLastmod: options.since,
  };

  try {
    let entries: SitemapEntry[] = [];

    if (source.isIndex) {
      const index = parseSitemap(await get(source.sitemapUrl));
      // 索引の lastmod が古い子は開かない。無駄な取得をしないため。
      const fresh = index.filter((c) => !options.since || c.lastmod >= options.since.slice(0, 10));
      for (const child of fresh.slice(0, 20)) {
        try {
          entries.push(...parseSitemap(await get(child.url)));
        } catch {
          // 子サイトマップ1本が落ちても続ける
        }
        await new Promise((r) => setTimeout(r, options.delayMs));
      }
    } else {
      entries = parseSitemap(await get(source.sitemapUrl));
    }

    // 更新日時が無いサイトは、位置ではなく「取り込み済みか」だけで差分を取る
    const since = source.trackBy === "seen" ? "" : options.since;
    const { candidates, undated } = selectNew(
      entries,
      source.detailPattern,
      since,
      options.isKnown,
      source.trackBy === "seen"
    );
    result.found = candidates.length;
    result.undated = undated;
    const attempted = candidates.slice(0, options.maxDetails);
    result.remaining = Math.max(0, candidates.length - attempted.length);

    for (const entry of attempted) {
      try {
        const html = await get(entry.url);
        const text = extractText(html);
        if (text.length < 80) continue;

        result.leads.push({
          source: "site",
          externalId: `${source.id}:${entry.url}`,
          url: entry.url,
          title: guessTitle(html, text),
          rawText: text,
          budgetJpy: extractBudget(text),
          postedAt: entry.lastmod || new Date().toISOString(),
        });
        result.fetched++;
      } catch {
        // 1件落ちても続ける
      }
      await new Promise((r) => setTimeout(r, options.delayMs));
    }

    // 見に行ったところまで位置を進める。取れなかった1件があっても進めてよい
    // （何度も同じもので詰まらないため）。
    result.newestLastmod = nextSince(attempted, options.since);
  } catch (error) {
    result.error = error instanceof Error ? error.message : "不明なエラー";
    // 証明書まわりは原因が分かりにくいので、そのまま流さず言い換える
    if (/certificate|CERT_|self.signed|unable to verify/i.test(result.error)) {
      result.error = `${result.error}（相手サーバーの証明書チェーンが不完全な可能性があります。ブラウザでは開けても、プログラムからは検証できません）`;
    }
  }

  return result;
}

export const getSource = (id: string): SourceDefinition | undefined => SOURCES.find((s) => s.id === id);

export { fingerprint };
