import { isAllowed, parseRobots, type Robots } from "./robots";
import { getCandidate, type SiteCandidate } from "./site-registry";

/**
 * 案件サイトを1件ずつ調べて、「取りに行っていいか」「取りに行けるか」を判定する。
 *
 * 判定は2つに分ける。混ぜると嘘になるため。
 *  - 規約上いいか（robots.txt）
 *  - 技術的に取れるか（サイトマップ・RSS・APIがあるか、そもそも繋がるか）
 * 両方が揃って初めて「使える」。robots.txt が禁止しているものは、
 * 技術的に取れても使わない。
 */

export const PROBE_UA =
  "hustle-pipeline/1.0 (personal side-job assistant; low-rate, sitemap-driven)";

export type ProbeVerdict =
  | "usable" // 規約上OKで、機械が読める入口が実際に取れた
  | "allowed_no_feed" // 規約上OKだが、機械が読める入口が見つからない
  | "blocked" // robots.txt が禁止している
  | "ai_blocked" // AIクローラを名指しで拒否している
  | "unreachable" // 繋がらない（WAF・証明書・DNS）
  | "unknown"; // robots.txt が読めず、判断できない

export const VERDICT_LABELS: Record<ProbeVerdict, string> = {
  usable: "使える",
  allowed_no_feed: "許可されているが入口なし",
  blocked: "robots.txt が禁止",
  ai_blocked: "AIクローラを拒否",
  unreachable: "繋がらない",
  unknown: "判断できない",
};

export const VERDICT_NOTES: Record<ProbeVerdict, string> = {
  usable: "サイトマップかAPIを実際に取得できました。",
  allowed_no_feed: "禁止はされていませんが、機械が読める入口が見つかりません。1ページずつ辿るのは負荷になるのでしません。",
  blocked: "robots.txt が取得を禁止しています。使いません。",
  ai_blocked:
    "ClaudeBot / GPTBot などを名指しで拒否しています。このアプリはAIで動かす前提なので、名前を変えて回避せず、使いません。",
  unreachable:
    "プログラムからの接続を拒否されています（WAFや証明書）。ブラウザで開けても、ここからは取れません。回避はしません。",
  unknown: "robots.txt を読めなかったので、許可されているか判断できません。分からないものは叩きません。",
};

export interface ProbeResult {
  siteId: string;
  name: string;
  origin: string;
  category: string;
  verdict: ProbeVerdict;
  /** robots.txt の HTTP ステータス。取れなければ null。 */
  robotsStatus: number | null;
  /** このアプリの UA で取得が許可されているか */
  allowed: boolean;
  /** 許可・禁止の根拠になった行 */
  rule: string;
  /** robots.txt が要求している間隔（秒） */
  crawlDelaySec: number | null;
  /** robots.txt に書いてあったサイトマップ */
  sitemaps: string[];
  /** トップページから見つけた RSS / Atom */
  feeds: string[];
  /** robots.txt に載っていたサイトマップを実際に叩いた結果 */
  sitemapStatus: number | null;
  /** 案件ページらしきURLがサイトマップに何件あったか */
  detailCount: number;
  /** 公開API（登録済みのもの） */
  apiUrl: string;
  /** API を叩いてみた結果 */
  apiStatus: number | null;
  /** 名指しで AI クローラを拒否しているか。運営の意思が明確なので別に出す。 */
  aiCrawlerBlocked: boolean;
  error: string;
  note: string;
  checkedAt: string;
}

const TIMEOUT_MS = 15_000;

interface Fetched {
  status: number | null;
  body: string;
  error: string;
}

async function get(url: string, accept: string): Promise<Fetched> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": PROBE_UA, Accept: accept },
    });
    const body = res.ok ? (await res.text()).slice(0, 400_000) : "";
    return { status: res.status, body, error: "" };
  } catch (e) {
    return { status: null, body: "", error: describe(e) };
  } finally {
    clearTimeout(timer);
  }
}

function describe(e: unknown): string {
  const raw = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
  if (/abort/i.test(raw)) return "時間内に応答がありませんでした";
  if (/certificate|CERT_|self.signed|unable to verify/i.test(raw)) {
    return `${raw}（証明書チェーンが不完全な可能性があります。ブラウザでは開けても、プログラムからは検証できません）`;
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(raw)) return "ドメインを解決できませんでした";
  if (/ECONNREFUSED|ECONNRESET/i.test(raw)) return "接続を拒否されました";
  return raw;
}

/** トップページの <link rel="alternate"> から RSS / Atom を拾う。 */
export function findFeeds(html: string, origin: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?alternate/i.test(tag)) continue;
    if (!/type\s*=\s*["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      out.add(new URL(href, origin).toString());
    } catch {
      // 相対解決できないものは捨てる
    }
  }
  return [...out];
}

/** AI クローラを名指しで拒否しているか。robots.txt の本文から判定する。 */
export function blocksAiCrawlers(robots: Robots | null): boolean {
  if (!robots) return false;
  for (const agent of ["claudebot", "gptbot", "ccbot", "anthropic-ai", "meta-externalagent"]) {
    const verdict = isAllowed(robots, "/", agent);
    if (!verdict.allowed) return true;
  }
  return false;
}

/**
 * 1サイト調べる。
 * robots.txt → （許可されていれば）トップページ → （あれば）API の順。
 * 禁止されているサイトのトップページは取りに行かない。
 */
export async function probeSite(site: SiteCandidate): Promise<ProbeResult> {
  const result: ProbeResult = {
    siteId: site.id,
    name: site.name,
    origin: site.origin,
    category: site.category,
    verdict: "unknown",
    robotsStatus: null,
    allowed: false,
    rule: "",
    crawlDelaySec: null,
    sitemaps: [],
    sitemapStatus: null,
    detailCount: 0,
    feeds: [],
    apiUrl: site.apiUrl ?? "",
    apiStatus: null,
    aiCrawlerBlocked: false,
    error: "",
    note: site.note ?? "",
    checkedAt: new Date().toISOString(),
  };

  const robotsRes = await get(`${site.origin}/robots.txt`, "text/plain, */*;q=0.8");
  result.robotsStatus = robotsRes.status;
  if (robotsRes.error) result.error = robotsRes.error;

  let robots: Robots | null = null;
  if (robotsRes.status === 200 && robotsRes.body.trim()) {
    robots = parseRobots(robotsRes.body);
    result.sitemaps = robots.sitemaps;
    result.aiCrawlerBlocked = blocksAiCrawlers(robots);
  }

  // robots.txt が 404 なら「禁止指定が無い」。届かなかった場合とは区別する。
  if (robotsRes.status === 404) {
    result.allowed = true;
    result.rule = "robots.txt がありません（禁止指定なし）";
  } else if (robots) {
    const verdict = isAllowed(robots, site.detailPattern ? "/" : "/", PROBE_UA);
    result.allowed = verdict.allowed;
    result.rule = verdict.rule;
    result.crawlDelaySec = verdict.crawlDelaySec;
  } else {
    result.rule = result.error || `robots.txt を読めませんでした（HTTP ${robotsRes.status}）`;
  }

  // 公開APIは robots.txt の対象外のことが多いので、別に確かめる
  if (site.apiUrl) {
    const api = await get(site.apiUrl, "application/xml, application/json, */*");
    result.apiStatus = api.status;
    if (api.error && !result.error) result.error = api.error;
  }

  // robots.txt にサイトマップが書いてあっても、実際に取れるとは限らない。
  // レバテックは robots.txt に載っていて curl では 200 だが、
  // プログラムからのアクセスは WAF が 403 で弾く。叩いて確かめる。
  if (result.allowed && result.sitemaps.length > 0) {
    const probe = await pickSitemap(result.sitemaps, site);
    result.sitemapStatus = probe.status;
    result.detailCount = probe.detailCount;
    if (probe.error && !result.error) result.error = probe.error;
  }

  // 許可されているときだけトップページを見に行く
  if (result.allowed) {
    const home = await get(site.origin, "text/html,*/*;q=0.8");
    if (home.status === 200) {
      result.feeds = findFeeds(home.body, site.origin);
    } else if (home.status !== null && !result.error) {
      result.error = `トップページが HTTP ${home.status}`;
    } else if (home.error && !result.error) {
      result.error = home.error;
    }
  }

  result.verdict = decide(result);
  return result;
}

/**
 * サイトマップを1本だけ開いて、案件ページが入っているかを見る。
 * 索引だったら子を1本だけ辿る。全部は開かない（相手の負荷になるため）。
 */
async function pickSitemap(
  sitemaps: string[],
  site: SiteCandidate
): Promise<{ status: number | null; detailCount: number; error: string }> {
  const pattern = site.detailPattern ? new RegExp(site.detailPattern) : null;
  // 案件ページが入っていそうな名前のサイトマップを優先する
  const ordered = [...sitemaps].sort(
    (a, b) => score(b) - score(a)
  );

  const first = await get(ordered[0], "application/xml, text/xml, */*");
  if (first.status !== 200) {
    return { status: first.status, detailCount: 0, error: first.error };
  }

  const locs = [...first.body.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/g)].map((m) => m[1].trim());
  const isIndex = /<sitemapindex/i.test(first.body);

  if (isIndex && locs.length > 0) {
    const child = await get(locs[0], "application/xml, text/xml, */*");
    if (child.status !== 200) return { status: 200, detailCount: 0, error: child.error };
    const childLocs = [...child.body.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/g)].map((m) =>
      m[1].trim()
    );
    return { status: 200, detailCount: count(childLocs, pattern), error: "" };
  }

  return { status: 200, detailCount: count(locs, pattern), error: "" };
}

const score = (url: string): number =>
  /job|work|project|request|offer|案件|求人/i.test(url) ? 1 : 0;

const count = (locs: string[], pattern: RegExp | null): number =>
  pattern ? locs.filter((u) => pattern.test(u)).length : locs.length;

export function decide(
  r: Pick<
    ProbeResult,
    | "allowed"
    | "robotsStatus"
    | "sitemaps"
    | "sitemapStatus"
    | "feeds"
    | "apiUrl"
    | "apiStatus"
    | "aiCrawlerBlocked"
  >
): ProbeVerdict {
  // 公開APIは robots.txt の外にあることが多いので先に見る
  if (r.apiUrl && r.apiStatus === 200) return "usable";

  // AIクローラを名指しで拒否しているサイトは、UAが違っても使わない。
  // このアプリはAIで動かす前提で、名前を変えて通るのは回避にあたる。
  if (r.aiCrawlerBlocked) return "ai_blocked";

  if (r.robotsStatus === null) return "unreachable";
  if (!r.allowed) return r.robotsStatus === 200 ? "blocked" : "unknown";

  // 「サイトマップが載っている」と「実際に取れる」は別物
  if (r.sitemapStatus === 200) return "usable";
  if (r.sitemaps.length > 0 && r.sitemapStatus !== null) return "unreachable";
  if (r.feeds.length > 0) return "usable";
  return "allowed_no_feed";
}

/**
 * まとめて調べる。
 * 相手のサーバーに連続でぶつけないよう、1件ごとに間隔を空ける。
 * 別ドメインなので並列でもいいが、順番に流したほうが失敗が読みやすい。
 */
export async function probeAll(
  sites: SiteCandidate[],
  options: { delayMs?: number; onResult?: (r: ProbeResult) => void } = {}
): Promise<ProbeResult[]> {
  const delayMs = options.delayMs ?? 800;
  const out: ProbeResult[] = [];
  for (const site of sites) {
    const result = await probeSite(site);
    out.push(result);
    options.onResult?.(result);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return out;
}

export const probeById = async (id: string): Promise<ProbeResult | null> => {
  const site = getCandidate(id);
  return site ? probeSite(site) : null;
};
