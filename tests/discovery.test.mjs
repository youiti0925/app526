import { test } from "node:test";
import assert from "node:assert/strict";

import * as sources from "../dist-test/agent/sources.js";
import * as core from "../dist-test/agent/discovery-core.js";

const { parseSitemap, selectNew, nextSince, extractText, dropRepeatedShortLines } = sources;
const { reconcileDiscovery, parseFindings } = core;

// ---------------------------------------------------------------------------
// サイトマップの読み取り
// ---------------------------------------------------------------------------

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/requests/1</loc><lastmod>2026-08-20T10:00:00+09:00</lastmod></url>
  <url><loc>https://example.com/requests/2</loc><lastmod>2026-08-22T10:00:00+09:00</lastmod></url>
  <url><loc>https://example.com/about</loc><lastmod>2026-08-23T10:00:00+09:00</lastmod></url>
  <url><loc>https://example.com/requests/3</loc></url>
</urlset>`;

const DETAIL = /\/requests\/\d+$/;

test("サイトマップから loc と lastmod を取り出す", () => {
  const entries = parseSitemap(SITEMAP);
  assert.equal(entries.length, 4);
  assert.equal(entries[0].url, "https://example.com/requests/1");
  assert.equal(entries[0].lastmod, "2026-08-20T10:00:00+09:00");
  // lastmod が無い行も落とさない
  assert.equal(entries[3].lastmod, "");
});

test("初回は案件ページを古い順に拾う", () => {
  const { candidates } = selectNew(parseSitemap(SITEMAP), DETAIL, "");
  assert.deepEqual(candidates.map((e) => e.url), [
    "https://example.com/requests/1",
    "https://example.com/requests/2",
  ]);
});

test("更新日時が無いページは対象外にし、件数として報告する", () => {
  // 位置を進められないので、拾うと毎回そこで止まる
  const { candidates, undated } = selectNew(parseSitemap(SITEMAP), DETAIL, "");
  assert.equal(undated, 1);
  assert.ok(!candidates.some((e) => e.url.endsWith("/requests/3")));
});

test("2回目以降は前回の位置以降に更新されたものだけ拾う", () => {
  const { candidates } = selectNew(parseSitemap(SITEMAP), DETAIL, "2026-08-21T00:00:00+09:00");
  assert.deepEqual(candidates.map((e) => e.url), ["https://example.com/requests/2"]);
});

test("案件ページ以外のURLは拾わない", () => {
  const { candidates } = selectNew(parseSitemap(SITEMAP), DETAIL, "");
  assert.ok(!candidates.some((e) => e.url.endsWith("/about")));
});

test("次回の位置は、実際に見に行ったところまで（見ていないものは飛ばさない）", () => {
  const { candidates } = selectNew(parseSitemap(SITEMAP), DETAIL, "");
  // 上限1件なら、古い側の1件だけを見たことになる
  const attempted = candidates.slice(0, 1);
  assert.equal(nextSince(attempted, ""), "2026-08-20T10:00:00+09:00");
  // まだ見ていない requests/2（08-22）は飛ばされていない
  const seen = new Set(attempted.map((e) => e.url));
  const rest = selectNew(parseSitemap(SITEMAP), DETAIL, nextSince(attempted, ""), (u) =>
    seen.has(u)
  );
  assert.deepEqual(rest.candidates.map((e) => e.url), ["https://example.com/requests/2"]);
});

test("溜まった案件は、実行を重ねるたびに減っていく", () => {
  // 上限1件でも、位置が前に進むので3回で全部消化できる
  let since = "";
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const done = new Set(seen);
    const batch = selectNew(parseSitemap(SITEMAP), DETAIL, since, (u) => done.has(u))
      .candidates.slice(0, 1);
    if (batch.length === 0) break;
    seen.push(...batch.map((e) => e.url));
    since = nextSince(batch, since);
  }
  assert.deepEqual(seen, [
    "https://example.com/requests/1",
    "https://example.com/requests/2",
  ]);
});

test("同じ日付の案件を取りこぼさない（lastmod が日付までしか無いサイト向け）", () => {
  const daily = `<urlset>
    <url><loc>https://x.test/requests/1</loc><lastmod>2026-08-09</lastmod></url>
    <url><loc>https://x.test/requests/2</loc><lastmod>2026-08-09</lastmod></url>
    <url><loc>https://x.test/requests/3</loc><lastmod>2026-08-09</lastmod></url>
  </urlset>`;
  const pattern = /\/requests\/\d+$/;
  const entries = parseSitemap(daily);

  // 1回目: 上限1件。位置は 2026-08-09 に進む
  const first = selectNew(entries, pattern, "").candidates.slice(0, 1);
  assert.deepEqual(first.map((e) => e.url), ["https://x.test/requests/1"]);
  const mark = nextSince(first, "");
  assert.equal(mark, "2026-08-09");

  // 2回目: 同じ日の残り2件がちゃんと残っている（取り込み済みの1件だけ除外）
  const known = new Set(["https://x.test/requests/1"]);
  const second = selectNew(entries, pattern, mark, (u) => known.has(u));
  assert.deepEqual(second.candidates.map((e) => e.url), [
    "https://x.test/requests/2",
    "https://x.test/requests/3",
  ]);
});

test("取り込み済みのURLは、位置が同じでも二度取りに行かない", () => {
  const all = new Set([
    "https://example.com/requests/1",
    "https://example.com/requests/2",
  ]);
  const { candidates } = selectNew(parseSitemap(SITEMAP), DETAIL, "", (u) => all.has(u));
  assert.deepEqual(candidates, []);
});

test("前回の位置より古い更新しか無ければ、位置は戻らない", () => {
  const since = "2026-09-01T00:00:00+09:00";
  assert.equal(nextSince(parseSitemap(SITEMAP), since), since);
});

test("HTMLから本文を取り出すとき、script と style は落とす", () => {
  const html = `<html><head><title>案件タイトル</title><style>.a{color:red}</style></head>
    <body><script>var x = "これは本文ではない";</script><p>実際の募集内容です。</p></body></html>`;
  const text = extractText(html);
  assert.ok(text.includes("実際の募集内容です。"));
  assert.ok(!text.includes("これは本文ではない"));
  assert.ok(!text.includes("color:red"));
});

test("繰り返し出てくる短い行（メニュー）は落とす", () => {
  const nav = ["サービスを探す", "仕事を探す", "ブログを探す"];
  const lines = [...nav, ...nav, "【必須条件】", "実際の募集本文がここに入ります。"];
  const kept = dropRepeatedShortLines(lines);
  // メニューは2回出てくるので消える
  assert.deepEqual(kept, ["【必須条件】", "実際の募集本文がここに入ります。"]);
});

test("本文中の短い見出しは1回しか出てこないので残す", () => {
  assert.deepEqual(dropRepeatedShortLines(["【業務内容】", "【必須条件】"]), [
    "【業務内容】",
    "【必須条件】",
  ]);
});

test("ナビゲーションで本文が押し出されない", () => {
  // 実物と同じ形: メニューが何度も繰り返されたあとに本文が来る
  const menu = "<div>サービスを探す</div><div>仕事を探す</div><div>ブログを探す</div>";
  const html = `<html><body>${menu.repeat(20)}<div>【業務内容】</div><div>TikTokのDMを活用したスカウト代行業務をお願いいたします。</div></body></html>`;
  const text = extractText(html);
  assert.ok(text.startsWith("【業務内容】"), text.slice(0, 60));
  assert.ok(!text.includes("サービスを探す"));
});

test("CSSの断片が本文に混ざらない", () => {
  const html = `<html><body><div>*:where(:not(html)){all:unset;display:revert}</div>
    <div>実際の募集内容です。ここが読めないと判定できません。</div></body></html>`;
  const text = extractText(html);
  assert.ok(text.includes("実際の募集内容です"));
  assert.ok(!text.includes("all:unset"));
});

test("JSON-LD の description を先頭に置く。本文も捨てない（単価が本文側にあるため）", () => {
  const desc = "あ".repeat(200);
  const html = `<html><script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    description: desc,
  })}</script><body><p>月額 90,000円</p></body></html>`;
  const text = extractText(html);
  assert.ok(text.startsWith(desc), "JSON-LD が先頭に来る");
  assert.ok(text.includes("90,000円"), "本文の単価も残る");
});

// ---------------------------------------------------------------------------
// 探索結果の検算
// ---------------------------------------------------------------------------

const finding = (over = {}) => ({
  key: "k",
  channel: "listing",
  title: "t",
  url: "",
  evidence: "",
  demandSignal: "",
  supplySignal: "",
  priceJpy: { low: 30_000, high: 50_000 },
  priceUnit: "1式",
  estimatedHours: { low: 5, high: 10 },
  platformId: "direct",
  whyAiCannotKill: "",
  qualificationBarrier: "なし",
  timeToFirstYen: "",
  firstStep: "",
  confidence: "medium",
  ...over,
});

test("手数料のかからない直接取引の実効時給", () => {
  const r = reconcileDiscovery(finding(), 1121);
  // 悪い側 30,000/10h = 3,000、良い側 50,000/5h = 10,000
  assert.deepEqual(r.hourlyJpy, { low: 3000, high: 10_000 });
  assert.equal(r.meetsBar, true);
});

test("プラットフォーム手数料と振込手数料を引いてから割る", () => {
  const r = reconcileDiscovery(finding({ platformId: "coconala" }), 1121);
  // ココナラ 22% + 振込160円: 30,000 → 30,000-6,600-160 = 23,240 / 10h = 2,324
  assert.equal(r.hourlyJpy.low, 2324);
  // 50,000 → 50,000-11,000-160 = 38,840 / 5h = 7,768
  assert.equal(r.hourlyJpy.high, 7768);
});

test("上限側でも基準に届かない市場は落とす", () => {
  const r = reconcileDiscovery(
    finding({ priceJpy: { low: 3_000, high: 5_000 }, estimatedHours: { low: 5, high: 10 } }),
    1121
  );
  assert.equal(r.meetsBar, false);
  assert.match(r.note, /追わないでください/);
});

test("下限側だけ基準を割るなら、通すが条件を絞らせる", () => {
  const r = reconcileDiscovery(
    finding({ priceJpy: { low: 10_000, high: 50_000 }, estimatedHours: { low: 5, high: 10 } }),
    1121
  );
  // 悪い側 10,000/10h = 1,000 < 1,121、良い側 50,000/5h = 10,000
  assert.equal(r.meetsBar, true);
  assert.match(r.note, /安い側の条件では受けないでください/);
});

test("金額か工数が返ってこなければ、基準を満たしたことにしない", () => {
  for (const bad of [
    { priceJpy: { low: 0, high: 0 } },
    { estimatedHours: { low: 0, high: 0 } },
    { priceJpy: { low: NaN, high: NaN } },
  ]) {
    const r = reconcileDiscovery(finding(bad), 1121);
    assert.equal(r.hourlyJpy, null, JSON.stringify(bad));
    assert.equal(r.meetsBar, false, JSON.stringify(bad));
  }
});

test("工数が極端に短くても、0時間割りで無限大にならない", () => {
  const r = reconcileDiscovery(
    finding({ estimatedHours: { low: 0.01, high: 0.01 } }),
    1121
  );
  // 下限は 0.5 時間で頭打ちにする
  assert.equal(r.hourlyJpy.high, 100_000);
  assert.ok(Number.isFinite(r.hourlyJpy.low));
});

// ---------------------------------------------------------------------------
// 返ってきた JSON の受け取り
// ---------------------------------------------------------------------------

test("返答が壊れていても落ちない", () => {
  for (const bad of [null, undefined, 42, "文字列", {}, { findings: "配列ではない" }]) {
    assert.deepEqual(parseFindings(bad), []);
  }
});

test("タイトルが無い要素は捨てる", () => {
  const out = parseFindings({ findings: [{ title: "" }, { nope: 1 }, { title: "残る" }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "残る");
});

test("知らない channel や confidence は既定値に落とす", () => {
  const [f] = parseFindings({
    findings: [{ title: "t", channel: "でたらめ", confidence: "とても高い" }],
  });
  assert.equal(f.channel, "apply");
  assert.equal(f.confidence, "medium");
});

test("http以外のURLは受け取らない", () => {
  const [f] = parseFindings({
    findings: [{ title: "t", url: "javascript:alert(1)" }],
  });
  assert.equal(f.url, "");
});

test("金額が文字列で返ってきたら 0 にする（誤った時給を出さないため）", () => {
  const [f] = parseFindings({
    findings: [{ title: "t", priceJpy: { low: "3万円", high: "5万円" } }],
  });
  assert.deepEqual(f.priceJpy, { low: 0, high: 0 });
  // その結果、実効時給は計算不能として扱われる
  assert.equal(reconcileDiscovery(f, 1121).hourlyJpy, null);
});

test("key が無ければ URL、URLも無ければタイトルで代用する", () => {
  const out = parseFindings({
    findings: [
      { title: "a", url: "https://example.com/x" },
      { title: "b" },
      { title: "c", key: "明示" },
    ],
  });
  assert.deepEqual(out.map((f) => f.key), ["https://example.com/x", "b", "明示"]);
});

// ---------------------------------------------------------------------------
// 競合の読み取り
// 実データで、応募44人・6万円の案件を「実効時給26,389〜39,583円の応募候補」として
// 通してしまった。応募人数はページに書いてあったのに読んでいなかった。
// ---------------------------------------------------------------------------

const comp = await import("../dist-test/agent/competition.js");
const { readCompetition, estimateWinRate, expectedHourly } = comp;

test("応募人数と閲覧数を読む", () => {
  const c = readCompetition("応募状況\n応募人数\n44\n契約人数\n閲覧数\n1,890\n業種");
  assert.equal(c.applicants, 44);
  assert.equal(c.views, 1890);
});

test("空欄をまたいで別のラベルの数字を拾わない", () => {
  // 実データ: 応募人数と契約人数が空欄で、932 は閲覧数だった
  const c = readCompetition("応募状況\n応募人数\n契約人数\n閲覧数\n932\n業種");
  assert.equal(c.applicants, null, "応募人数は空欄なので null");
  assert.equal(c.views, 932);
});

test("全角の数字も読む", () => {
  assert.equal(readCompetition("応募人数\n１２").applicants, 12);
});

test("応募が多いほど受注確率を低く見る", () => {
  const few = estimateWinRate(4, null);
  const many = estimateWinRate(44, null);
  assert.ok(few > many, `${few} > ${many}`);
  // 実績ゼロぶんを割り引くので、単純な 1/(n+1) より低い
  assert.ok(many < 1 / 45, `${many} < ${1 / 45}`);
});

test("募集枠が複数あれば確率は上がる", () => {
  assert.ok(estimateWinRate(20, 5) > estimateWinRate(20, 1));
});

test("応募人数が読めなければ確率を出さない（推測で埋めない）", () => {
  assert.equal(estimateWinRate(null, null), null);
  assert.equal(expectedHourly(50_000, 10, 0.5, null), null);
});

test("提案文の時間を入れた期待時給を出す", () => {
  // 手取り47,500円 / 作業10時間 / 提案0.5時間 / 受注確率1%
  const e = expectedHourly(47_500, 10, 0.5, 0.01);
  // 期待収入475円 ÷ 期待時間(0.5 + 0.1)時間 ≒ 792円
  assert.equal(e, 792);
});

test("競合が少なければ期待時給は受注時の時給に近づく", () => {
  const solo = expectedHourly(47_500, 10, 0.5, 0.9);
  assert.ok(solo > 4000, String(solo));
});
