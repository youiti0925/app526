/**
 * robots.txt の解析。
 *
 * なぜ自前で書くか:
 * 「取りに行っていいか」をこのアプリが自分で判断できないと、サイトを増やすたびに
 * 人が1件ずつ規約を読む必要があり、結局2〜3サイトで止まる。逆に、雑に解析して
 * 「禁止されていない」と誤判定すると、禁止されているサイトを叩くことになる。
 * だから、迷ったら禁止側に倒す。
 *
 * 実装している範囲:
 * - User-agent グループ（連続する User-agent 行はひとつのグループを共有する）
 * - Allow / Disallow、`*` と `$`、最長一致優先・同着なら Allow 優先
 * - Sitemap、Crawl-delay
 */

export interface RobotsGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
  crawlDelaySec: number | null;
}

export interface Robots {
  groups: RobotsGroup[];
  sitemaps: string[];
  /** robots.txt が取れなかった場合は null。取れなかったこと自体は許可を意味しない。 */
  raw: string | null;
}

export function parseRobots(text: string): Robots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  // 直前の行も User-agent なら、同じグループに複数のエージェントが並んでいる
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [], crawlDelaySec: null };
        groups.push(current);
      }
      // 空の値（"User-agent:" だけの行）は無視する。
      // ua.includes("") は常に true なので、放置すると全UAに一致して
      // `*` グループを乗っ取り、禁止されているものを許可と判定する。
      if (value) current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }

    lastWasAgent = false;
    if (!current) continue;

    if (field === "allow" && value) current.allow.push(value);
    else if (field === "disallow") current.disallow.push(value);
    else if (field === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelaySec = n;
    }
  }

  return { groups, sitemaps, raw: text };
}

/**
 * 自分に当てはまるグループを選ぶ。
 * 名指しのグループがあればそれだけを見る（`*` は無視する。これが仕様）。
 */
export function groupFor(robots: Robots, userAgent: string): RobotsGroup | null {
  const ua = userAgent.toLowerCase();

  // 同じ User-agent を名指しするグループが複数あるときは、全部を1つにまとめる
  // （RFC 9309 が求めている挙動）。最初の1つだけを見ていたせいで、
  // 後ろのグループにある Disallow を読み落とし、禁止されているものを
  // 許可と判定していた。google.com/robots.txt が実際にこの形をしている。
  let bestLen = -1;
  const matched: RobotsGroup[] = [];

  for (const group of robots.groups) {
    for (const agent of group.agents) {
      if (agent === "*") continue;
      if (!ua.includes(agent)) continue;
      if (agent.length > bestLen) {
        bestLen = agent.length;
        matched.length = 0;
        matched.push(group);
      } else if (agent.length === bestLen) {
        matched.push(group);
      }
      break;
    }
  }

  const groups = matched.length > 0 ? matched : robots.groups.filter((g) => g.agents.includes("*"));
  if (groups.length === 0) return null;
  if (groups.length === 1) return groups[0];

  return {
    agents: [...new Set(groups.flatMap((g) => g.agents))],
    allow: groups.flatMap((g) => g.allow),
    disallow: groups.flatMap((g) => g.disallow),
    // 間隔は一番長いものに合わせる（相手に優しい側）
    crawlDelaySec: groups.reduce<number | null>(
      (max, g) => (g.crawlDelaySec === null ? max : Math.max(max ?? 0, g.crawlDelaySec)),
      null
    ),
  };
}

/** robots.txt のパターンを正規表現にする。`*` は任意、`$` は終端。 */
function toRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}${anchored ? "$" : ""}`);
}

/** パターンが当たるなら、その長さ（最長一致の判定に使う）。当たらなければ -1。 */
function matchLength(pattern: string, path: string): number {
  if (pattern === "") return -1; // 空の Disallow は「何も禁止しない」
  try {
    return toRegExp(pattern).test(path) ? pattern.length : -1;
  } catch {
    return -1;
  }
}

export interface RobotsVerdict {
  allowed: boolean;
  /** 判断の根拠になった行。人に見せる。 */
  rule: string;
  crawlDelaySec: number | null;
}

/**
 * このパスを取りに行っていいか。
 *
 * robots.txt が取れなかったとき（robots === null）は allowed=false を返す。
 * 慣習上は「robots.txt が無ければ全部許可」だが、取得に失敗しただけなのか
 * 本当に無いのかをこちらから区別できない。分からないものは叩かない。
 */
export function isAllowed(
  robots: Robots | null,
  path: string,
  userAgent: string
): RobotsVerdict {
  if (!robots) {
    return { allowed: false, rule: "robots.txt を確認できませんでした", crawlDelaySec: null };
  }

  const group = groupFor(robots, userAgent);
  if (!group) {
    return { allowed: true, rule: "自分に当てはまる指定なし", crawlDelaySec: null };
  }

  let bestDisallow = -1;
  let disallowRule = "";
  for (const p of group.disallow) {
    const len = matchLength(p, path);
    if (len > bestDisallow) {
      bestDisallow = len;
      disallowRule = p;
    }
  }

  let bestAllow = -1;
  let allowRule = "";
  for (const p of group.allow) {
    const len = matchLength(p, path);
    if (len > bestAllow) {
      bestAllow = len;
      allowRule = p;
    }
  }

  const who = group.agents.includes("*") ? "*" : group.agents.join(", ");

  if (bestDisallow === -1) {
    return { allowed: true, rule: `${who} に禁止指定なし`, crawlDelaySec: group.crawlDelaySec };
  }
  // 同じ長さで当たったら Allow を優先する（仕様）
  if (bestAllow >= bestDisallow) {
    return {
      allowed: true,
      rule: `${who}: Allow: ${allowRule}`,
      crawlDelaySec: group.crawlDelaySec,
    };
  }
  return {
    allowed: false,
    rule: `${who}: Disallow: ${disallowRule}`,
    crawlDelaySec: group.crawlDelaySec,
  };
}
