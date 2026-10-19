/**
 * ランサーズ巡回（scripts/lancers-patrol.mjs）の、通信しない部分。
 *
 * 画面の形は 2026-10-19 にPCでログインなしで見て確かめたもの:
 *   一覧  https://www.lancers.jp/work/search?keyword=…&sort=started（新着順。2ページ目以降は &page=N）
 *         1件 = div.p-search-job-media。題名 a.p-search-job-media__title、報酬 .p-search-job-media__price、
 *         残り .p-search-job-media__time-remaining、提案数 .p-search-job-media__proposals、
 *         依頼者 .c-avatar__subnote（「発注 N」「評価 4.9」）、本人確認 i.p-search-job-media__avatar-badge.is-verified
 *         .p-search-job__latest-* は検索語と無関係の新着枠、tech-agent.lancers.jp は広告なので除く
 *   詳細  /work/detail/<id>?purpose=lancer（ログインなしで依頼者の欄まで見える）
 *         依頼者 div.p-work-detail-client-box: 確認済みの項目、評価の良い/悪い数、発注率（発注数/募集数）
 */

export const BASE = "https://www.lancers.jp";
/**
 * 見て回る検索語。Excel に限らず、Claude が作業して納品物を作れる仕事を全部入れる
 * （書く・訳す・まとめる・調べる・入力する・作る）。体や本人の声・顔が要る仕事は判定（judge）で落ちる。
 * 1回の巡回で全部は見られない（20ページまで）ので、KEYWORDS_PER_RUN 語ずつ順番に回す。
 */
export const DEFAULT_KEYWORDS = [
  "エクセル", "記事作成", "文字起こし", "翻訳", "データ入力", "リサーチ", "資料作成", "Python",
  "GAS", "ホームページ制作", "マクロ", "ライティング", "議事録", "英語", "リスト作成", "パワーポイント",
  "WordPress", "スクレイピング", "校正", "要約", "スプレッドシート", "VBA", "LP制作", "マニュアル作成",
];
export const KEYWORDS_PER_RUN = 10;

/** 前回の続きから n 語を選ぶ。戻り値の next を次回の cursor にする。 */
export function rotateKeywords(all, cursor = 0, n = KEYWORDS_PER_RUN) {
  if (!all.length) return { words: [], next: 0 };
  const start = ((cursor % all.length) + all.length) % all.length;
  const words = [];
  for (let i = 0; i < Math.min(n, all.length); i++) words.push(all[(start + i) % all.length]);
  return { words, next: (start + words.length) % all.length };
}
export const MAX_PAGES = 20;
export const MAX_DETAILS = 8;

export const searchUrl = (keyword, page = 1) =>
  `${BASE}/work/search?keyword=${encodeURIComponent(keyword)}&sort=started${page > 1 ? `&page=${page}` : ""}`;

export function jobIdFromUrl(url) {
  try {
    const u = new URL(url, BASE);
    if (u.hostname !== "www.lancers.jp") return null;
    return u.pathname.match(/^\/work\/detail\/(\d+)\/?$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export const detailUrl = (id) => `${BASE}/work/detail/${id}?purpose=lancer`;
export const publicUrl = (id) => `${BASE}/work/detail/${id}`;

const num = (s) => {
  const m = `${s ?? ""}`.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

/** 一覧の依頼者欄（「発注 12」「評価 4.9」など）から、発注数と評価を読む。 */
export function parseSubnote(text) {
  const t = `${text ?? ""}`.replace(/\s+/g, " ");
  return {
    orders: num(t.match(/発注\s*([\d,]+)/)?.[1]),
    rating: num(t.match(/評価\s*([\d.]+)/)?.[1]),
  };
}

/** 一覧から集めた1件を整える。広告・ほかのサイト・検索語と無関係の新着枠は null。 */
export function normalizeListItem(raw) {
  if (raw.inLatest) return null;
  const id = jobIdFromUrl(raw.href ?? "");
  if (!id) return null;
  const { orders, rating } = parseSubnote(raw.subnote);
  return {
    id,
    title: `${raw.title ?? ""}`.replace(/\s+/g, " ").trim(),
    price: `${raw.price ?? ""}`.replace(/\s+/g, " ").trim(),
    remaining: `${raw.remaining ?? ""}`.replace(/\s+/g, " ").trim(),
    // プロジェクトの欄は「当選者数/募集人数」なので、提案数と書いてあるときだけ読む
    proposals: /提案数/.test(raw.proposals ?? "") ? num(raw.proposals) : null,
    orders,
    rating,
    verified: !!raw.verified,
    closed: !!raw.closed || isClosedText(raw.remaining),
    client: clientIdFromUrl(raw.clientHref ?? ""),
  };
}

/** 一覧の依頼者リンク（/client/<名前>）から依頼者を見分ける名前を取る。 */
export function clientIdFromUrl(url) {
  try {
    const u = new URL(url, BASE);
    if (u.hostname !== "www.lancers.jp") return null;
    return u.pathname.match(/^\/client\/([^/]+)\/?$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * 並んだ順のまま、依頼者1人につき1件までに絞る。
 * 依頼者が分からないものは、題名の先頭20文字が同じものを同じ依頼とみなす。
 */
export function onePerClient(items, limit = Infinity) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (out.length >= limit) break;
    const key = it.client ? `c:${it.client}` : `t:${`${it.title ?? ""}`.replace(/\s+/g, "").slice(0, 20)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

export const isClosedText = (s) => /募集終了|終了しました|キャンセル/.test(`${s ?? ""}`);

/**
 * 依頼者の点数。何度も発注している（リピートの多い）依頼者を上にする。
 * 発注数を一番重く、次に評価の良さ・発注率・本人確認。提案が多すぎる募集は少し下げる。
 */
export function clientScore(j) {
  const orders = j.awarded ?? j.orders ?? 0;
  let s = Math.log2(1 + orders) * 10;
  if (j.good != null || j.bad != null) {
    const g = j.good ?? 0;
    const b = j.bad ?? 0;
    if (g + b > 0) s += (g / (g + b)) * 10 - Math.min(b, 5) * 2;
  } else if (j.rating != null) s += (j.rating / 5) * 10;
  if (j.awardRate != null) s += j.awardRate / 10;
  if (j.verified) s += 5;
  if (j.proposals != null && j.proposals > 30) s -= 5;
  return Math.round(s * 10) / 10;
}

/** 詳細ページから集めた生の値を整える。 */
export function normalizeDetail(raw) {
  const checks = Object.fromEntries((raw.checks ?? []).map((c) => [c.label.trim(), !!c.done]));
  const awarded = num(raw.awarded);
  const posted = num(raw.posted);
  const budget = `${raw.budget ?? ""}`.replace(/\s+/g, " ").replace(/ 円/g, "円").trim();
  return {
    budget: /^[\d,]+$/.test(budget) ? `${budget}円` : budget,
    remaining: `${raw.remaining ?? ""}`.replace(/\s+/g, " ").trim(),
    proposals: num(raw.worksNum),
    schedule: (raw.schedule ?? []).map((s) => `${s.title}${s.text}`.replace(/\s+/g, " ").trim()).filter(Boolean),
    tags: (raw.tags ?? []).map((t) => t.trim()).filter(Boolean),
    good: num(raw.good),
    bad: num(raw.bad),
    awardRate: num(raw.percent),
    awarded,
    posted,
    verified: checks["本人確認"] ?? null,
    checks,
    closed: isClosedText(raw.remaining) || (raw.tags ?? []).some((t) => /^(終了|キャンセル)$/.test(t.trim())) || !!raw.completedNote,
    text: `${raw.text ?? ""}`,
  };
}

/** ブラウザの中で動かす: 一覧ページの募集を集める（引数なし・外の変数を使わない）。 */
export function extractListInPage() {
  return [...document.querySelectorAll("div.p-search-job-media")].map((el) => {
    const a = el.querySelector("a.p-search-job-media__title");
    // 題名の中の札（NEW・当選保証・提案非公開など）は除く
    const t = a?.cloneNode(true);
    t?.querySelectorAll("ul, .p-search-job-media__tags").forEach((n) => n.remove());
    return {
      href: a?.href ?? "",
      title: t?.textContent ?? "",
      price: el.querySelector(".p-search-job-media__price")?.textContent ?? "",
      remaining:
        el.querySelector(".p-search-job-media__time-remaining")?.textContent ||
        el.querySelector(".p-search-job-media__time-text")?.textContent ||
        "",
      // 新着順でも終わった募集が混じる（「募集終了」は .p-search-job-media__time--end）
      closed: !!el.querySelector(".p-search-job-media__time--end"),
      proposals: el.querySelector(".p-search-job-media__proposals")?.textContent ?? "",
      subnote: [...el.querySelectorAll(".c-avatar__subnote")].map((n) => n.textContent).join(" "),
      verified: !!el.querySelector("i.p-search-job-media__avatar-badge.is-verified"),
      clientHref: el.querySelector(".p-search-job-media__avatar a[href*='/client/']")?.href ?? "",
      inLatest: !!el.closest("[class*='p-search-job__latest']"),
    };
  });
}

/** ブラウザの中で動かす: 詳細ページ（?purpose=lancer）の値を集める。 */
export function extractDetailInPage() {
  const q = (s) => document.querySelector(s)?.textContent ?? "";
  const box = document.querySelector("div.p-work-detail-client-box");
  const checks = [];
  if (box) {
    for (const dl of box.querySelectorAll("dl.p-work-detail-client-box-work-status__content-list")) {
      const dts = dl.querySelectorAll("dt");
      const dds = dl.querySelectorAll("dd");
      dts.forEach((dt, i) => checks.push({ label: dds[i]?.textContent ?? "", done: !!dt.querySelector("i.c-icon--circle-check") }));
    }
  }
  return {
    // 「~ 5,000 円」「50,000 円 ~ 100,000 円」を丸ごと（.price-number だけだと最初の数字か「~」しか取れない）
    budget: q(".tableSummary__col--compensation .c-text") || q(".tableSummary__col--compensation .price-block"),
    remaining: q(".tableSummary__col--time .c-heading") || q(".tableSummary__col--time"),
    worksNum: q("[class*='tableSummary__col--worksNum']"),
    schedule: [...document.querySelectorAll(".p-work-detail-schedule__item")].map((it) => ({
      title: it.querySelector(".p-work-detail-schedule__item__title")?.textContent ?? "",
      text: it.querySelector(".p-work-detail-schedule__text")?.textContent ?? "",
    })),
    tags: [...document.querySelectorAll("li.c-tag")].map((t) => t.textContent ?? ""),
    good: box?.querySelector(".p-work-detail-client-box-feedback-info__number-good")?.textContent ?? "",
    bad: box?.querySelector(".p-work-detail-client-box-feedback-info__number-bad")?.textContent ?? "",
    percent: box?.querySelector(".p-work-detail-client-box-feedback-info__percent")?.textContent ?? "",
    awarded: box?.querySelector("span.result_summary_awarded")?.textContent ?? "",
    posted: box?.querySelector("span.result_summary_posted")?.textContent ?? "",
    checks,
    completedNote: !!document.querySelector(".p-work-detail-client__is-completed"),
    // 判定に渡すのは募集の部分だけ。ページ全体だと、依頼者の欄の「本人確認」「電話確認」や
    // 下の「新着の仕事」まで入り、どの募集も「本人であることが要る・現地作業・電話」で落ちる
    text:
      [
        "h1",
        ".c-2016-tableSummary",
        ".p-work-detail-schedule",
        ".p-work-detail-lancer__postscript",
      ]
        .map((s) => document.querySelector(s)?.innerText?.trim() ?? "")
        .concat([...document.querySelectorAll("li.c-tag")].map((t) => t.innerText?.trim() ?? "").join(" "))
        .filter(Boolean)
        .join("\n\n") || (document.body?.innerText ?? ""),
  };
}

const VERDICT_ORDER = { 応募してよい: 0, 確認してから応募: 1, 判定なし: 2, 判定できず: 2, 見送り: 3 };

/** 応募候補の一覧（Markdown）。応募してよいもの → 依頼者の点数の高い順。 */
export function formatList(items, { when = new Date() } = {}) {
  const sorted = [...items].sort(
    (a, b) => (VERDICT_ORDER[a.verdict] ?? 2) - (VERDICT_ORDER[b.verdict] ?? 2) || b.score - a.score
  );
  const stamp = when.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const lines = [
    `# ランサーズ 応募候補（${stamp}）`,
    "",
    "見るだけで集めました。応募はしていません。送るときは「応募画面」を開き、提案文を貼って送ってください。",
    "依頼者の点数は、発注数（リピートの多さ）・評価・発注率・本人確認から出しています。",
    "",
    "| # | 判定 | 依頼者の点数 | 題名 | 報酬 | 残り | 提案数 | 依頼者 |",
    "|---|---|---|---|---|---|---|---|",
  ];
  sorted.forEach((j, i) => {
    const who = [
      j.awarded != null ? `発注${j.awarded}${j.posted != null ? `/${j.posted}` : ""}` : j.orders != null ? `発注${j.orders}` : "",
      j.good != null ? `良${j.good}・悪${j.bad ?? 0}` : j.rating != null ? `評価${j.rating}` : "",
      j.verified ? "本人確認済" : "本人確認なし",
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(
      `| ${i + 1} | ${j.verdict} | ${j.score} | [${j.title.replace(/\|/g, "／")}](${publicUrl(j.id)}) | ${j.budget || j.price || "—"} | ${j.remaining || "—"} | ${j.proposals ?? "—"} | ${who} |`
    );
  });
  sorted.forEach((j, i) => {
    lines.push("", `## ${i + 1}. ${j.title}`, "", `- 判定: ${j.verdict}`, `- 応募画面: ${detailUrl(j.id)}`);
    if (j.schedule?.length) lines.push(`- 日程: ${j.schedule.join(" ／ ")}`);
    if (j.detail) lines.push("", "```", j.detail.trim(), "```");
  });
  return lines.join("\n") + "\n";
}

/** 「50,000円 ~ 100,000円」「〜5,000円」「1件40円」などから、下限と上限（円）を読む。時給・単価は kind で分ける。 */
export function parseBudget(text) {
  const t = `${text ?? ""}`.replace(/\s+/g, "");
  const nums = [...t.matchAll(/([\d,]+)円/g)].map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => n > 0);
  const kind = /時給|\/時間|時間あたり/.test(t) ? "hourly" : /1件|件あたり|\/件|1商品|1記事|文字単価|1文字/.test(t) ? "unit" : "fixed";
  if (!nums.length) return { kind, low: null, high: null };
  return { kind, low: Math.min(...nums), high: Math.max(...nums) };
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * 記録した募集（{id, keyword, price, at}）を検索語ごとにまとめる。同じ募集は1回だけ数える。
 * 「月に何件・いくらの仕事があるか」を、推測ではなく見た数で出すため。
 */
export function summarizeMarket(records, { days = 7, now = new Date() } = {}) {
  const since = now.getTime() - days * 86_400_000;
  const byId = new Map();
  for (const r of records) if (Date.parse(r.at) >= since && !byId.has(r.id)) byId.set(r.id, r);
  const groups = new Map();
  for (const r of byId.values()) {
    const g = groups.get(r.keyword) ?? { keyword: r.keyword, count: 0, fixed: [], unit: 0, hourly: 0 };
    g.count++;
    const b = parseBudget(r.price);
    if (b.kind === "fixed" && b.low != null) g.fixed.push(b.high);
    else if (b.kind === "unit") g.unit++;
    else if (b.kind === "hourly") g.hourly++;
    groups.set(r.keyword, g);
  }
  return [...groups.values()]
    .map((g) => ({ keyword: g.keyword, count: g.count, perMonth: Math.round((g.count / days) * 30), medianFixed: median(g.fixed), fixedCount: g.fixed.length, unit: g.unit, hourly: g.hourly }))
    .sort((a, b) => b.count - a.count);
}

export function formatMarket(rows, days) {
  const lines = [
    `# ランサーズ 仕事の種類ごとの募集数と予算（直近${days}日に巡回で見た分）`,
    "",
    "| 検索語 | 見た募集 | 月あたり（換算） | 固定報酬の上限の中央値 | 単価制 | 時給制 |",
    "|---|---|---|---|---|---|",
  ];
  for (const r of rows)
    lines.push(`| ${r.keyword} | ${r.count} | ${r.perMonth} | ${r.medianFixed != null ? `${r.medianFixed.toLocaleString()}円（${r.fixedCount}件）` : "—"} | ${r.unit} | ${r.hourly} |`);
  lines.push("", "※ 1回の巡回で見るのは各検索語の新着1ページ（約30件）なので、実際の募集数はこれより多い。");
  return lines.join("\n") + "\n";
}
