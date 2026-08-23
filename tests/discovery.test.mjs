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

// ---------------------------------------------------------------------------
// 契約の形（月額 vs 請負）と稼働キャパ
// 実データで、月額150万円・想定稼働80時間/月 の案件を「1案件の報酬150万円」
// として割り、実効時給57,119〜85,679円 という数字を出していた。
// ---------------------------------------------------------------------------

const eng = await import("../dist-test/agent/engagement.js");
const { readEngagement, checkCapacity, monthlyHourly, readMonthlyRate } = eng;

test("ラベルと数字が離れていても月額を読む", () => {
  // 実データのギークスジョブはこの並び
  const text = "単価税抜\n95\n〜\n115\n万円/月\nポジション\n精算時間\n140時間〜180時間";
  const e = readEngagement(text);
  assert.equal(e.kind, "monthly");
  assert.equal(e.monthlyJpy, 950_000, "範囲なら安いほうを取る");
  assert.equal(e.monthlyHours, 140, "精算時間から月稼働を読む");
  assert.equal(monthlyHourly(e), 6786);
});

test("月額契約を1案件の報酬として割らない", () => {
  const e = readEngagement("月額 1,500,000円\n月80時間〜100時間の稼働");
  assert.equal(e.kind, "monthly");
  assert.equal(monthlyHourly(e), 18_750, "150万 ÷ 80時間");
});

test("稼働時間が書かれていなければ時給を出さない", () => {
  // 月額4万円を140時間で割ると「時給286円」になるが、実際は1投稿5,000円の出来高
  const e = readEngagement("■報酬\n月額40,000円（税込）前後を想定\n・1投稿納品：5,000円");
  assert.equal(e.kind, "monthly");
  assert.equal(e.monthlyJpy, 40_000);
  assert.equal(e.monthlyHours, null);
  assert.equal(monthlyHourly(e), null, "推測で時給を作らない");
});

test("時給表記があればそれを使う", () => {
  const e = readEngagement("時給 2,000円 でお願いします。");
  assert.equal(e.kind, "hourly");
  assert.equal(e.hourlyJpy, 2000);
});

test("金額の単位が無いものは請負として扱う", () => {
  assert.equal(readEngagement("記事を10本お願いします。予算は3万円です。").kind, "fixed");
});

test("常駐・一部出社・リモートを読み分ける", () => {
  assert.equal(readEngagement("基本常駐での参画をお願いします").onsite, "required");
  assert.equal(readEngagement("週1回出社以外は基本リモート勤務").onsite, "partial");
  assert.equal(readEngagement("フルリモートで参画可能です").onsite, "remote");
});

test("週に出せる時間を超える稼働は、時給がいくら高くても落とす", () => {
  const e = readEngagement("単価税抜\n95\n万円/月\n精算時間\n140時間");
  const c = checkCapacity(e, 10); // 週10時間 = 月43時間
  assert.equal(c.fits, false);
  assert.equal(c.requiredHours, 140);
  assert.match(c.reason, /引き受けられません/);
});

test("週の時間に収まるなら通す", () => {
  const e = readEngagement("月額 200,000円\n稼働 40時間/月");
  assert.equal(checkCapacity(e, 10).fits, true);
});

test("稼働時間が不明な月額契約は、落とさずに確認させる", () => {
  const e = readEngagement("月額40,000円前後を想定");
  const c = checkCapacity(e, 10);
  assert.equal(c.fits, true);
  assert.match(c.reason, /応募前に必ず確認/);
});

test("「〜1,500,000円/月」のような他案件の単価表記も金額として読める", () => {
  // 読めること自体は正しい。混入は本文の切り出し側（cutAfterBody）で防ぐ。
  assert.equal(readMonthlyRate("〜1,500,000円/月"), null, "円表記はラベルが要る");
  assert.equal(readMonthlyRate("115万円/月"), 1_150_000);
});

// ---------------------------------------------------------------------------
// 工程分解による工数見積り
// 文字数だけで見ていたので、市場調査で「実効時給が高い」と分かった
// SDS・リスクアセスメント・作業標準書・ISO が全部「判定不能」で止まっていた。
// ---------------------------------------------------------------------------

const wt = await import("../dist-test/agent/worktypes.js");
const est = await import("../dist-test/agent/estimate.js");
const { estimateByWorkType, WORK_TYPES } = wt;
const { estimateHours } = est;

test("SDS・リスクアセスメント・作業標準書・ISO が判定不能にならない", () => {
  const cases = [
    "弊社製品5物質分のSDS作成をお願いします。",
    "化学物質12物質のリスクアセスメントを実施してください。",
    "組立ラインの作業標準書を8工程分、作成してください。",
    "ISO9001の内部文書15文書の整備をお願いします。",
  ];
  for (const c of cases) {
    const e = estimateHours(c);
    assert.ok(e, `判定不能になった: ${c}`);
    assert.ok(e.lowHours > 0 && e.highHours >= e.lowHours, JSON.stringify(e));
  }
});

test("数量に比例して工数が増える", () => {
  const one = estimateByWorkType("1物質分のSDS作成");
  const ten = estimateByWorkType("10物質分のSDS作成");
  // 表示用に小数第1位で丸めているので、比が厳密に10倍にはならない
  assert.ok(Math.abs(ten.aiHours / one.aiHours - 10) < 0.2, `${one.aiHours} → ${ten.aiHours}`);
  assert.ok(ten.humanHours > one.humanHours);
});

test("数量が読めなければ1単位として計算し、確信度を下げる", () => {
  const e = estimateByWorkType("SDSの作成をお願いします。");
  assert.equal(e.unitsRead, false);
  assert.equal(e.units, 1);
  assert.equal(estimateHours("SDSの作成をお願いします。").confidence, "low");
});

test("人がやらないと終わらない工程を別に出す", () => {
  const e = estimateByWorkType("化学物質12物質のリスクアセスメント");
  assert.ok(e.humanHours > 0, "人の工程がゼロになっていない");
  assert.ok(e.humanHours < e.aiHours, "全部が人の工程ではない");
  // 現場ヒアリングは人の工程として残っている
  assert.ok(e.breakdown.some((s) => s.by === "human" && /ヒアリング/.test(s.name)));
});

test("AIによる短縮率が「9割」にならない（検証工程が残るため）", () => {
  // 実測で、工程レベルの短縮率の中央値は約5割だった。
  // ここが9割に振れていたら、工数を過小評価している。
  for (const w of WORK_TYPES) {
    const e = estimateByWorkType(w.patterns[0].source.replace(/[\\^$()?:|]/g, "").split("|")[0]);
    if (!e) continue;
    assert.ok(e.reduction <= 0.75, `${w.id} の短縮率が高すぎる: ${e.reduction}`);
  }
});

test("GHS区分の確認は人の工程として残す（AIに任せない）", () => {
  const e = estimateByWorkType("5物質分のSDS作成");
  const ghs = e.breakdown.find((s) => /GHS/.test(s.name));
  assert.ok(ghs, "GHSの工程がある");
  assert.equal(ghs.by, "human");
  assert.match(ghs.why, /一次情報/);
});

test("翻訳は後編集を人の工程として計上する", () => {
  const e = estimateByWorkType("技術資料20,000文字を英訳してください。");
  const post = e.breakdown.find((s) => /後編集/.test(s.name));
  assert.equal(post.by, "human");
  // 2万文字 = 20単位。機械翻訳より後編集のほうが長い
  assert.ok(post.hours > 1, String(post.hours));
});

// ---------------------------------------------------------------------------
// 単価交渉
// 「安いから見送り」で終わらせると、聞けば動いたかもしれない案件を毎回捨てる。
// ---------------------------------------------------------------------------

const rn = await import("../dist-test/agent/renegotiate.js");
const { requiredAsk, buildRenegotiation } = rn;
const CW = { feeRate: 0.2, withdrawalFeeJpy: 500, name: "クラウドワークス" };

test("手数料を戻して、基準を満たす請求額を逆算する", () => {
  // 目標手取り 1,121円 × 10時間 = 11,210円。手数料20%と振込500円を戻す。
  const ask = requiredAsk(1121, 10, CW);
  // (11210 + 500) / 0.8 = 14,637.5 → 千円単位で切り上げ
  assert.equal(ask, 15_000);
  // 実際にその額で手取りが基準を満たすか、順方向で検算する
  const net = ask - Math.floor(ask * CW.feeRate) - CW.withdrawalFeeJpy;
  assert.ok(net / 10 >= 1121, `${net / 10} >= 1121`);
});

test("手数料ゼロの直接取引では、そのままの額になる", () => {
  const direct = { feeRate: 0, withdrawalFeeJpy: 0, name: "直接" };
  assert.equal(requiredAsk(2000, 5, direct), 10_000);
});

test("工数が読めなければ逆算しない", () => {
  assert.equal(requiredAsk(1121, 0, CW), null);
  assert.equal(requiredAsk(1121, NaN, CW), null);
});

test("3倍を超える交渉は、通らないものとして見送らせる", () => {
  const r = buildRenegotiation({
    title: "t",
    offeredJpy: 3_000,
    hours: 20,
    minHourlyJpy: 1121,
    platform: CW,
  });
  assert.equal(r.realistic, false);
  assert.equal(r.message, "", "通らない交渉の文面は作らない");
  assert.match(r.giveUpReason, /見送って/);
});

test("現実的な範囲なら、そのまま送れる文面を作る", () => {
  const r = buildRenegotiation({
    title: "SDS作成",
    offeredJpy: 10_000,
    hours: 10,
    minHourlyJpy: 1121,
    platform: CW,
  });
  assert.equal(r.realistic, true);
  assert.ok(r.message.length > 100);
  assert.match(r.message, /15,000円/);
  // 送る前に人が確認すべきことを必ず添える
  assert.match(r.message, /送る前に確認/);
});

test("工程の内訳があれば、根拠として文面に入れる", () => {
  const byType = estimateByWorkType("5物質分のSDS作成");
  const r = buildRenegotiation({
    title: "SDS作成",
    offeredJpy: 10_000,
    hours: byType.aiHours,
    minHourlyJpy: 1121,
    platform: CW,
    breakdown: byType,
    marketRateJpy: byType.workType.marketRateJpy,
  });
  assert.match(r.message, /GHS区分の確認/);
  assert.match(r.message, /15,000〜50,000円/, "相場を添える");
});

// ---------------------------------------------------------------------------
// 出品型
// 応募型のパイプラインでは、実効時給が高い仕事（SDS・リスクアセスメント・ISO）が
// 原理的に見えない。ココナラの公開依頼1,751件に1件も出てこなかった。
// ---------------------------------------------------------------------------

const ls = await import("../dist-test/agent/listing.js");
const { buildListing, listableWorkTypes, renderListing } = ls;

test("狙う仕事の出品プランが全部作れる", () => {
  const ids = listableWorkTypes();
  assert.ok(ids.includes("sds"));
  assert.ok(ids.includes("risk_assessment"));
  for (const id of ids) {
    const p = buildListing(id, { minHourlyJpy: 1121 });
    assert.ok(p, id);
    assert.equal(p.tiers.length, 3);
  }
});

test("料金は相場の範囲に収める（自分で相場割れの値を付けない）", () => {
  for (const id of listableWorkTypes()) {
    const p = buildListing(id, { minHourlyJpy: 1121 });
    assert.match(p.priceCheck, /範囲に入っています/, `${id}: ${p.priceCheck}`);
  }
});

test("件数が増えるほど1件あたりは安くなる（ただし相場の下限は割らない）", () => {
  const p = buildListing("sds", { minHourlyJpy: 1121 });
  const per = p.tiers.map((t) => t.priceJpy / t.units);
  assert.ok(per[0] >= per[1] && per[1] >= per[2], JSON.stringify(per));
  assert.ok(per[2] >= 15_000 * 0.75, "下限から離れすぎない");
});

test("実効時給は手数料を引いた後の値", () => {
  const p = buildListing("sds", { minHourlyJpy: 1121 });
  const t = p.tiers[0];
  // ココナラ 22% + 振込160円
  const net = t.priceJpy - Math.floor(t.priceJpy * 0.22) - 160;
  assert.equal(t.hourlyJpy, Math.round(net / t.hours));
});

test("責任範囲と「含まないもの」を必ず書く", () => {
  for (const id of listableWorkTypes()) {
    const p = buildListing(id, { minHourlyJpy: 1121 });
    assert.ok(p.notIncluded.length > 0, `${id}: 含まないものが空`);
    assert.ok(p.disclaimer.length > 20, `${id}: 免責が薄い`);
  }
});

test("行政手続の代理を含むと書かない（行政書士法違反になるため）", () => {
  for (const id of listableWorkTypes()) {
    const p = buildListing(id, { minHourlyJpy: 1121 });
    const sellText = [p.title, p.catchCopy, p.body].join("\n");
    assert.ok(!/(届出|申請).{0,6}(代行|代理)(します|いたします|可能)/.test(sellText), `${id} が代理を謳っている`);
  }
  // SDS と リスクアセスメントは、届出代行を「含まないもの」に明記している
  for (const id of ["sds", "risk_assessment"]) {
    const p = buildListing(id, { minHourlyJpy: 1121 });
    assert.ok(p.notIncluded.some((n) => /行政書士/.test(n)), `${id}`);
  }
});

test("持っていない資格を持っていると書かない", () => {
  const iso = buildListing("iso_docs", { minHourlyJpy: 1121 });
  assert.match(iso.disclaimer, /審査員.{0,10}資格は持っていません/);
  const ra = buildListing("risk_assessment", { minHourlyJpy: 1121 });
  assert.ok(ra.notIncluded.some((n) => /作業環境測定/.test(n)), "測定士の業務は含まないと明記");
});

test("出品文には、出品前に人が確認すべきことを添える", () => {
  const md = renderListing(buildListing("sds", { minHourlyJpy: 1121 }));
  assert.match(md, /出品前に確認してください/);
  assert.match(md, /自動出品は各サービスの規約違反/);
});

// ---------------------------------------------------------------------------
// ライセンス
// 「作れる」と「納品してよい」は別。出来が良くても規約違反なら納品できない。
// ---------------------------------------------------------------------------

const lic = await import("../dist-test/agent/licenses.js");
const del = await import("../dist-test/agent/deliverability.js");
const { TOOL_LICENSES, obligationsFor, blockedTools, freeCommercialTools } = lic;
const { judgeDeliverability } = del;

test("すべてのライセンスに、根拠の引用と出典がある", () => {
  for (const l of TOOL_LICENSES) {
    assert.ok(l.quote.length > 20, `${l.id}: 引用が薄い`);
    assert.match(l.sourceUrl, /^https:\/\//, `${l.id}: 出典が無い`);
    assert.match(l.checkedOn, /^\d{4}-\d{2}-\d{2}$/, `${l.id}: 確認日が無い`);
  }
});

test("確認していないツールは、使えないものとして扱う", () => {
  // 「たぶん大丈夫」で通すと、納品してから規約違反が分かる
  assert.deepEqual(obligationsFor(["知らないツール"]), [
    "知らないツール: ライセンスを確認していません。使う前に規約を読んでください。",
  ]);
  assert.equal(blockedTools(["知らないツール"]).length, 1);
});

test("商用禁止のツールは blockedTools が拾う", () => {
  const blocked = blockedTools(["flux_dev"]);
  assert.equal(blocked.length, 1);
  assert.match(blocked[0].why, /Non-Commercial/);
});

test("規約を確認していないツールも弾く（たぶん大丈夫で通さない）", () => {
  const blocked = blockedTools(["gcloud_tts"]);
  assert.equal(blocked.length, 1, "unverified は使えない扱いにする");
  assert.match(blocked[0].why, /確認していません/);
});

test("条件つき（restricted）は弾かず、条件を出す", () => {
  assert.equal(blockedTools(["gemini_free"]).length, 0);
  const o = obligationsFor(["gemini_free"]);
  assert.ok(o.some((x) => /機密/.test(x)), JSON.stringify(o));
});

test("ffmpeg は成果物に義務が無い（配布しないため）", () => {
  assert.deepEqual(obligationsFor(["ffmpeg"]), []);
  assert.equal(blockedTools(["ffmpeg"]).length, 0);
});

test("VOICEVOX Nemo はクレジット表記の義務を出す", () => {
  const o = obligationsFor(["voicevox_nemo"]);
  assert.ok(o.some((x) => /クレジット/.test(x)), JSON.stringify(o));
  assert.equal(blockedTools(["voicevox_nemo"]).length, 0);
});

test("無料で商用に使えるツールに、課金が要るものが混ざらない", () => {
  for (const t of freeCommercialTools()) {
    assert.equal(t.costJpy, 0, `${t.id} は無料ではない`);
    assert.ok(["ok", "ok_with_credit"].includes(t.commercial), t.id);
  }
});

test("ナレーション付きの動画案件が、クレジット義務つきで通る", () => {
  const r = judgeDeliverability(
    "YouTube動画の編集をお願いします。カット、テロップ挿入、BGM合成。ナレーションの読み上げもお願いします。"
  );
  assert.equal(r.canDeliver, true, r.note);
  assert.ok(r.matched.includes("voice"));
  assert.ok(r.licenseObligations.some((o) => /クレジット/.test(o)), JSON.stringify(r.licenseObligations));
});

// ---------------------------------------------------------------------------
// 納期
// 実効時給が良くても、週10時間で納期までに終わらなければ受けられない。
// ---------------------------------------------------------------------------

const dl = await import("../dist-test/agent/deadline.js");
const { readDeadline, checkDeadline } = dl;

const NOW = new Date(2026, 7, 23); // 2026-08-23

test("相対の納期を日数で読む", () => {
  assert.equal(readDeadline("納期は2週間以内でお願いします。", NOW).days, 14);
  assert.equal(readDeadline("納期 10日", NOW).days, 10);
  assert.equal(readDeadline("1ヶ月以内", NOW).days, 30);
});

test("絶対の納期を日数で読む", () => {
  assert.equal(readDeadline("納品希望日 2026年9月10日", NOW).days, 18);
});

test("月日だけの表記で、すでに過ぎていれば来年とみなす", () => {
  // 8/23 時点で「1月10日」は来年
  const d = readDeadline("納期 1月10日まで", NOW);
  assert.ok(d.days > 100, String(d.days));
});

test("即日は成立しないものとして落とす", () => {
  const d = readDeadline("即日納品でお願いします", NOW);
  assert.equal(d.days, 0);
  assert.equal(d.rushed, true);
  assert.equal(checkDeadline(d, 5, 10).fits, false);
});

test("納期が読めなければ落とさず、確認させる", () => {
  const d = readDeadline("よろしくお願いします。", NOW);
  assert.equal(d.days, null);
  const c = checkDeadline(d, 20, 10);
  assert.equal(c.fits, true);
  assert.match(c.reason, /応募前に必ず確認/);
});

test("週の時間を全部1件に注ぐ前提にしない", () => {
  // 週10時間 × 14日 = 20時間ぶんだが、7割しか充てられない前提なので14時間
  const d = readDeadline("納期は2週間以内", NOW);
  const c = checkDeadline(d, 18, 10);
  assert.equal(c.availableHours, 14);
  assert.equal(c.fits, false, "楽観に倒さない");
  assert.match(c.reason, /週かかります/);
});

test("余裕があれば通す", () => {
  const c = checkDeadline(readDeadline("納期 2ヶ月", NOW), 20, 10);
  assert.equal(c.fits, true, c.reason);
});

test("急ぎを煽る書き方を記録する", () => {
  assert.equal(readDeadline("至急対応をお願いします。納期は1週間。", NOW).rushed, true);
  assert.equal(readDeadline("納期は1ヶ月程度で結構です。", NOW).rushed, false);
});

// ---------------------------------------------------------------------------
// 応募前の4つの関門
// ツール調査（規約の条文で確認）から出た結論。この4つで落ちる案件は、
// どのツールを選んでも無料枠では成立しない。
// ---------------------------------------------------------------------------

const gt = await import("../dist-test/agent/gates.js");
const { checkGates, renderGateQuestions } = gt;

test("Premiere プロジェクトファイル必須の案件を拾う", () => {
  // 実在の案件2件が2件ともこれを要求していた。ffmpeg は .prproj を出せない。
  const g = checkGates("動画編集をお願いします。Adobe Premiereのプロジェクトファイルにて納品できる方。");
  assert.equal(g.passed, false);
  assert.ok(g.hits.some((h) => h.id === "format"));
});

test("NDA は交渉で外せないものとして扱う", () => {
  const g = checkGates("本案件はNDAを締結いただきます。社外秘の資料をお渡しします。");
  assert.equal(g.passed, false);
  assert.equal(g.negotiable, false, "交渉では外せない");
  assert.match(g.note, /受けられません/);
});

test("権利非侵害の表明保証・著作権譲渡・独占利用を拾う", () => {
  for (const t of [
    "第三者の権利を侵害しないことを保証していただきます。",
    "著作権は全部譲渡していただきます。",
    "独占的に利用したいので、他所では使わないでください。",
  ]) {
    const g = checkGates(t);
    assert.ok(g.hits.some((h) => h.id === "warranty"), t);
  }
});

test("クレジット表記が出せない案件を拾う", () => {
  const g = checkGates("弊社名義として公開するため、クレジット表記は不可です。");
  assert.ok(g.hits.some((h) => h.id === "credit"));
});

test("交渉で外せるものだけなら、落とさず確認に回す", () => {
  const g = checkGates("Premiereのプロジェクトファイルで納品してください。");
  assert.equal(g.passed, false);
  assert.equal(g.negotiable, true);
  assert.match(g.note, /確認すれば通る可能性/);
});

test("普通の案件は素通しする", () => {
  const g = checkGates("記事を5本書いてください。テーマは弊社ブログの既存記事に沿って。");
  assert.equal(g.passed, true);
  assert.equal(g.hits.length, 0);
});

test("確認事項は、何を聞けばよいかまで書く", () => {
  const g = checkGates("Adobe Premiereのプロジェクトファイルで納品してください。");
  const md = renderGateQuestions(g, "動画編集");
  assert.match(md, /完成データ/);
  assert.match(md, /該当箇所/);
});

test("汎用イラストは作れる側に入っている（ライセンスを確認した結果）", () => {
  const r = judgeDeliverability("ブログのアイキャッチ画像を10点、用意してください。");
  assert.equal(r.canDeliver, true, r.note);
  assert.ok(r.matched.includes("image_gen"), JSON.stringify(r.matched));
});

test("画風・キャラ指定のイラストは作れない側のまま", () => {
  const r = judgeDeliverability(
    "この画風でオリジナルキャラクターのイラストを制作していただける方を募集します。CLIP STUDIO PAINT使用。"
  );
  assert.equal(r.canDeliver, false, r.note);
  assert.ok(r.matched.includes("art"));
});

// ---------------------------------------------------------------------------
// 出品したあとの追跡
// 出品型は初速が出ない。2週間で「売れないからやめる」と判断させてはいけないが、
// 半年ゼロのものを「まだ早い」と言い続けるのも違う。境目を数字で決める。
// ---------------------------------------------------------------------------

const lt = await import("../dist-test/agent/listing-tracker.js");
const { reviewListing, summarizeListings } = lt;

const listing = (over = {}) => ({
  id: "l1",
  workTypeId: "sds",
  title: "SDS作成を代行します",
  platformId: "coconala",
  url: "",
  publishedAt: "2026-06-01",
  priceJpy: 45_000,
  views: 0,
  inquiries: 0,
  orders: 0,
  lastCheckedAt: "",
  status: "published",
  ...over,
});

test("30日未満は触らせない（初速が出ないため）", () => {
  const r = reviewListing(listing({ publishedAt: "2026-08-10" }), "2026-08-23");
  assert.equal(r.verdict, "too_early");
  assert.match(r.nextAction, /触らずに/);
});

test("受注があれば、まず実際にかかった時間を記録させる", () => {
  const r = reviewListing(listing({ orders: 1 }), "2026-08-23");
  assert.equal(r.verdict, "working");
  assert.match(r.nextAction, /実際にかかった時間/);
});

test("見られていないのと、見られているが売れないのを区別する", () => {
  const invisible = reviewListing(listing({ views: 10 }), "2026-08-23");
  assert.equal(invisible.verdict, "invisible");
  assert.match(invisible.nextAction, /タイトルとカテゴリ/);

  const noConv = reviewListing(listing({ views: 500, inquiries: 0 }), "2026-08-23");
  assert.equal(noConv.verdict, "no_conversion");
  assert.match(noConv.nextAction, /価格か/);
});

test("問い合わせは来ているのに受注ゼロが続くなら畳ませる", () => {
  const r = reviewListing(
    listing({ publishedAt: "2026-03-01", views: 800, inquiries: 20, orders: 0 }),
    "2026-08-23"
  );
  assert.equal(r.verdict, "stop");
  assert.match(r.reason, /問い合わせの段階で断られ/);
});

test("直すところを1つに絞る（同時に変えると何が効いたか分からない）", () => {
  const r = reviewListing(listing({ views: 500 }), "2026-08-23");
  assert.match(r.nextAction, /1つだけ|一方だけ|1か所/);
});

test("出品ゼロなら、出すまでは何も起きないと言う", () => {
  assert.match(summarizeListings([]), /出すまでは1円にもなりません/);
});

test("全部が様子見なら、いじらずに出品を増やさせる", () => {
  const reviews = [
    reviewListing(listing({ id: "a", publishedAt: "2026-08-15" }), "2026-08-23"),
    reviewListing(listing({ id: "b", publishedAt: "2026-08-18" }), "2026-08-23"),
  ];
  const s = summarizeListings(reviews);
  assert.match(s, /いま出品文をいじらないでください/);
});
