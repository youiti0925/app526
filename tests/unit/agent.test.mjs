// 自律エージェントの純ロジックの回帰テスト。
// AIキー無しでも判定が成立することが最重要なので、そこを厚く見る。
import test from "node:test";
import assert from "node:assert/strict";

import { estimateHours, detectScopeRisks } from "../../dist-test/agent/estimate.js";
import { extractBudget, parsePasted, parseFeed, splitPasted, fingerprint, cleanEmail } from "../../dist-test/agent/ingest.js";
import { CallBudget } from "../../dist-test/agent/budget.js";

// --- 作業量の見積もり（AIなしで実効時給を出すための土台）-------------------

test("記事の本数から、工程表で見積もる", () => {
  // 以前は文字数÷1,200文字/時で30時間と出していた。これは手作業の速度。
  // いまは工程表（生成は自動、事実確認と突き合わせが人）で数える。
  const e = estimateHours("記事作成をお願いします。1記事3000文字、10本お願いします。");
  assert.ok(e, "見積もれていない");
  assert.ok(e.highHours > e.lowHours);
  // 「1記事」ではなく「10本」を数量として読めていること
  const byType = estimateByWorkType("記事作成をお願いします。1記事3000文字、10本お願いします。");
  assert.equal(byType.workType.id, "article_writing");
  assert.equal(byType.units, 10, "1記事のほうを数量として読んでいる");
  // 手作業（10記事）よりは大幅に短い
  assert.ok(byType.humanHours < byType.manualHours / 5, `${byType.humanHours} / ${byType.manualHours}`);
});

test("文字数からの素朴な見積もりは、工程表が無いときだけ使う", () => {
  const e = estimateHours("商品説明文を1商品300文字、100商品分でお願いします。");
  assert.ok(e);
  assert.match(e.basis, /上乗せ/);
});

test("抜き取り検査を件数ぶん掛けない", () => {
  // 「抜き取り」なので件数に比例しない。掛けていたので、
  // 500件のリストで「抜き取り検査に16時間」という計算になっていた。
  const small = estimateByWorkType("企業リストの作成です。50件の企業情報を入力してください。");
  const big = estimateByWorkType("企業リストの作成です。500件の企業情報を入力してください。");
  assert.equal(small.workType.id, "data_entry");
  const sample = (e) => e.breakdown.find((b) => /抜き取り/.test(b.name)).hours;
  assert.equal(sample(small), sample(big), "抜き取り検査が件数で増えている");
  // 人の時間は10倍にはならない（機械の時間だけが増える）
  assert.ok(big.humanHours < small.humanHours * 2, `${small.humanHours} → ${big.humanHours}`);
  assert.ok(big.machineHours > small.machineHours);
});

test("文字起こしは音声時間の4倍で見積もる", () => {
  const e = estimateHours("60分の会議音声の文字起こしをお願いします。");
  assert.ok(e);
  assert.ok(e.lowHours >= 4.5 && e.lowHours <= 5.5, `low=${e.lowHours}`);
});

test("見積もれない募集文では null を返す（推測で埋めない）", () => {
  assert.equal(estimateHours("よろしくお願いします。詳細は面談で。"), null);
});

test("見積もりは必ず0.5時間以上になる（0除算を作らない）", () => {
  const e = estimateHours("10文字だけ書いてください");
  if (e) assert.ok(e.lowHours >= 0.5 && e.highHours >= e.lowHours);
});

test("地雷になる条件を検出する", () => {
  const risks = detectScopeRisks(
    "修正は納得いくまで何度でも対応をお願いします。単価は応相談。継続前提のお仕事です。"
  );
  assert.ok(risks.length >= 3, JSON.stringify(risks));
  assert.ok(risks.some((r) => r.includes("青天井")));
  assert.ok(risks.some((r) => r.includes("確定していません")));
});

test("普通の募集文では地雷を出しすぎない", () => {
  const risks = detectScopeRisks(
    "記事作成をお願いします。1記事3000文字、単価5000円。修正は2回まで。納期は1週間です。"
  );
  assert.equal(risks.length, 0, JSON.stringify(risks));
});

// --- 報酬額の読み取り -------------------------------------------------------

test("いろいろな書き方の報酬額を読む", () => {
  assert.equal(extractBudget("報酬は10,000円です"), 10000);
  assert.equal(extractBudget("予算 5万円"), 50000);
  assert.equal(extractBudget("単価：3000円"), 3000);
  assert.equal(extractBudget("１記事あたり報酬 8,000円"), 8000);
});

test("報酬額が無ければ null（0にしない）", () => {
  assert.equal(extractBudget("報酬は応相談です"), null);
  assert.equal(extractBudget(""), null);
});

test("非現実的な金額は拾わない", () => {
  assert.equal(extractBudget("999999999999円"), null);
});

// --- 取り込み ---------------------------------------------------------------

test("--- で区切って複数案件に割る", () => {
  const raw = `1件目の募集文です。記事作成をお願いします。3000文字。

---

2件目の募集文です。データ入力をお願いします。100件。

---

短すぎ`;
  const chunks = splitPasted(raw);
  assert.equal(chunks.length, 2, "20文字未満のかけらは落とす");
});

test("貼り付けた案件からタイトル・URL・報酬を拾う", () => {
  const [lead] = parsePasted(
    "【急募】ブログ記事の作成\n報酬は1記事5,000円です。\n詳細はこちら https://example.com/jobs/1"
  );
  assert.match(lead.title, /急募/);
  assert.equal(lead.url, "https://example.com/jobs/1");
  assert.equal(lead.budgetJpy, 5000);
  assert.ok(lead.externalId.length > 0);
});

test("同じ本文からは同じ識別子が出る（二重取り込みを防ぐ）", () => {
  const a = fingerprint("記事作成をお願いします。3000文字。");
  const b = fingerprint("記事作成をお願いします。  3000文字。 ");
  const c = fingerprint("まったく別の案件です。データ入力。");
  assert.equal(a, b, "空白の違いは無視する");
  assert.notEqual(a, c);
});

test("RSSをパースする", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item>
      <title>ライター募集</title>
      <link>https://example.com/1</link>
      <description><![CDATA[<p>3000文字の記事を10本。報酬は50,000円です。</p>]]></description>
      <guid>job-1</guid>
      <pubDate>Mon, 23 Aug 2026 09:00:00 +0900</pubDate>
    </item>
  </channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].externalId, "job-1");
  assert.equal(items[0].title, "ライター募集");
  assert.equal(items[0].url, "https://example.com/1");
  assert.equal(items[0].budgetJpy, 50000);
  assert.ok(!items[0].rawText.includes("<p>"), "HTMLタグが残っている");
});

test("Atomもパースする", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <title>デザイン案件</title>
      <link href="https://example.com/2"/>
      <id>urn:uuid:2</id>
      <summary>バナー制作を5点。単価は3,000円。</summary>
      <updated>2026-08-23T00:00:00Z</updated>
    </entry>
  </feed>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://example.com/2");
  assert.equal(items[0].budgetJpy, 3000);
});

test("壊れたXMLでも例外を投げない", () => {
  assert.doesNotThrow(() => parseFeed("<rss><item><title>壊れ"));
  assert.deepEqual(parseFeed(""), []);
  assert.deepEqual(parseFeed("これはXMLではない"), []);
});

test("メールの引用と署名を落とす", () => {
  const cleaned = cleanEmail(`新着案件のお知らせです。
記事作成をお願いします。報酬5,000円。

> 前のメールの引用
> これも引用

--
配信停止はこちら`);
  assert.ok(!cleaned.includes("引用"));
  assert.ok(!cleaned.includes("配信停止"));
  assert.ok(cleaned.includes("記事作成"));
});

// --- 無料枠の予算配分 -------------------------------------------------------

test("上限を超えたら take が false になる", () => {
  const b = new CallBudget(3);
  assert.equal(b.take(), true);
  assert.equal(b.take(), true);
  assert.equal(b.take(), true);
  assert.equal(b.take(), false, "4回目は拒否する");
  assert.equal(b.spent, 3);
  assert.equal(b.remaining, 0);
});

test("上限0なら1回も使えない（AIなしで走る）", () => {
  const b = new CallBudget(0);
  assert.equal(b.take(), false);
  assert.equal(b.allocate(0.5), 0);
});

test("工程ごとの割り当ては残数を超えない", () => {
  const b = new CallBudget(10);
  b.take(4);
  assert.equal(b.remaining, 6);
  assert.equal(b.allocate(0.5), 3);
  assert.ok(b.allocate(1) <= b.remaining);
});

test("「100商品分」のような単位も本数として数える", () => {
  const e = estimateHours("1商品300文字、100商品分の商品説明文を作成してください。");
  assert.ok(e, "見積もれていない");
  // 300文字 × 100商品 = 30,000文字 ÷ 1,200 = 25時間 → 上乗せして30〜45時間
  assert.ok(e.lowHours >= 29 && e.lowHours <= 31, `low=${e.lowHours}`);
});

test("単位のバリエーションを取りこぼさない", () => {
  const cases = [
    ["1点500文字、20点", 20],
    ["1枚400文字を50枚", 50],
    ["1件600文字で30件", 30],
    ["1コンテンツ1000文字、12コンテンツ", 12],
  ];
  for (const [text, expectedItems] of cases) {
    const e = estimateHours(text);
    assert.ok(e, `見積もれていない: ${text}`);
    assert.match(e.basis, new RegExp(`× ${expectedItems}本`), `${text} → ${e.basis}`);
  }
});

test("時給が最低賃金を大きく割る案件を見逃さない", () => {
  // 100商品 × 300文字 = 30,000文字。報酬5,000円なら時給は3桁に届かない。
  const e = estimateHours("1商品300文字、100商品分。報酬は総額5,000円です。");
  assert.ok(e);
  const netPerHour = 5000 / e.highHours;
  assert.ok(netPerHour < 200, `時給 ${Math.round(netPerHour)}円 と出るはず`);
});

// --- 上位モデルの判定の検算 --------------------------------------------------
// ここは安全上の要。返ってきた結論より、金額と時間から計算した数字を優先する。

import { reconcileVerdict } from "../../dist-test/agent/reconcile.js";

const CW = { feeRate: 0.2, withdrawalFeeJpy: 500 };
const base = {
  verdict: "proceed",
  reason: "いけます",
  riskCount: 0,
  minHourlyJpy: 1121,
  platform: CW,
};

test("時給が基準を割るなら、proceed と返ってきても reject に上書きする", () => {
  const r = reconcileVerdict({ ...base, offeredJpy: 8000, lowHours: 30, highHours: 45 });
  // 8,000円 − 手数料1,600円 − 振込500円 = 5,900円 ÷ 45h = 131円/h
  assert.equal(r.verdict, "reject");
  assert.equal(r.overridden, true);
  assert.equal(r.hourly.low, 131);
  assert.match(r.reason, /元の判定: proceed/, "上書きした事実を残す");
});

test("下限だけ割っているなら reject ではなく verify_first に落とす", () => {
  // 20,000円 → 手取り15,500円。10hなら1,550円/h、15hなら1,033円/h。
  const r = reconcileVerdict({ ...base, offeredJpy: 20000, lowHours: 10, highHours: 15 });
  assert.equal(r.verdict, "verify_first");
  assert.equal(r.overridden, true);
  assert.ok(r.hourly.low < 1121 && r.hourly.high >= 1121);
});

test("数字が足りているなら結論を変えない", () => {
  const r = reconcileVerdict({ ...base, offeredJpy: 60000, lowHours: 12, highHours: 18 });
  assert.equal(r.verdict, "proceed");
  assert.equal(r.overridden, false);
  assert.ok(r.hourly.low >= 1121);
});

test("reject をわざわざ緩めることはしない", () => {
  const r = reconcileVerdict({
    ...base,
    verdict: "reject",
    reason: "資格が要る",
    offeredJpy: 200000,
    lowHours: 2,
    highHours: 3,
  });
  assert.equal(r.verdict, "reject", "時給が高くても reject は維持する");
  assert.equal(r.overridden, false);
  assert.equal(r.reason, "資格が要る");
});

test("報酬額が分からないときは検算せず、結論をそのまま通す", () => {
  const r = reconcileVerdict({ ...base, offeredJpy: null, lowHours: 10, highHours: 20 });
  assert.equal(r.hourly, null);
  assert.equal(r.verdict, "proceed");
  assert.equal(r.overridden, false);
  assert.equal(r.score, 25, "判定できないときは中間のスコアにする");
});

test("壊れた数値でも落ちない", () => {
  for (const bad of [
    { offeredJpy: Number.NaN, lowHours: 10, highHours: 20 },
    { offeredJpy: 10000, lowHours: Number.NaN, highHours: 20 },
    { offeredJpy: 10000, lowHours: 10, highHours: 0 },
    { offeredJpy: -5000, lowHours: 10, highHours: 20 },
  ]) {
    const r = reconcileVerdict({ ...base, ...bad });
    assert.equal(r.hourly, null, JSON.stringify(bad));
    assert.ok(Number.isFinite(r.score));
  }
});

test("地雷の数だけスコアが下がる", () => {
  const clean = reconcileVerdict({ ...base, offeredJpy: 60000, lowHours: 12, highHours: 18 });
  const risky = reconcileVerdict({ ...base, offeredJpy: 60000, lowHours: 12, highHours: 18, riskCount: 5 });
  assert.ok(risky.score < clean.score);
  assert.ok(risky.score >= 0);
});

// --- レビュー第3・4弾の回帰 --------------------------------------------------

import { STEP_ORDER } from "../../dist-test/agent/types.js";
import { estimateUnits, estimateByWorkType, stripNonQuantities } from "../../dist-test/agent/worktypes.js";
import { reconcileDiscovery } from "../../dist-test/agent/discovery-core.js";
import { buildRenegotiation } from "../../dist-test/agent/renegotiate.js";

test("工程の並び順に listing が含まれる（APIの絞り込みが素通りしない）", () => {
  // ここが欠けていたせいで only:["listing"] が「該当なし」になり、
  // 絞り込みが消えて全工程が走っていた。
  assert.ok(STEP_ORDER.includes("listing"), STEP_ORDER.join(","));
  assert.equal(STEP_ORDER[0], "ingest");
  assert.equal(STEP_ORDER[STEP_ORDER.length - 1], "learn");
});

test("実績や経験の「◯件」を納品本数として数えない", () => {
  const e = estimateHours("1記事3000文字を5本お願いします。応募には実績50件以上が必要です。");
  assert.ok(e);
  // 50件を拾っていたら 3000×50=150,000文字 → 125時間超になる
  assert.match(e.basis, /× 5本/, e.basis);
  assert.ok(e.highHours < 30, `high=${e.highHours}`);
});

test("文字起こしの分数が書かれていないとき、仮の数字だと明示する", () => {
  const e = estimateHours("会議の文字起こしをお願いします。");
  assert.ok(e);
  assert.match(e.basis, /仮に/, e.basis);
  assert.equal(e.confidence, "low");
});

test("文字起こしの本数を無視しない", () => {
  const one = estimateHours("30分の音声の文字起こしをお願いします。");
  const ten = estimateHours("30分の音声の文字起こしを10本お願いします。");
  assert.ok(one && ten);
  assert.ok(ten.highHours > one.highHours * 5, `${one.highHours} → ${ten.highHours}`);
});

test("10万文字のような大きな数量を、ID とみなして消さない", () => {
  // 5桁以上を一律に消していたので、100000文字が読めず
  // 1単位（1,000文字）として計算していた。100倍の過小見積り。
  assert.match(stripNonQuantities("100000文字の翻訳"), /100000文字/);
  // ID や年号は今までどおり消える
  assert.doesNotMatch(stripNonQuantities("求人ID 1234567 の件"), /1234567/);
  assert.doesNotMatch(stripNonQuantities("ISO9001 の整備"), /9001/);
});

test("工程表から直接数える（合成文を判定器に通さない）", () => {
  const sds = estimateByWorkType("SDSの作成をお願いします。20物質分です。");
  assert.ok(sds, "SDS と判定できていない");
  const one = estimateUnits(sds.workType, 1);
  const ten = estimateUnits(sds.workType, 10);
  assert.ok(one.aiHours > 0);
  // 1単位4時間という根拠の無い既定値に落ちていないこと
  assert.notEqual(one.aiHours, 4);
  // 案件ごとの工程（やりとり）は数量で増えないので、厳密な10倍にはならない
  assert.ok(ten.aiHours > one.aiHours, `${one.aiHours} → ${ten.aiHours}`);
  assert.ok(ten.aiHours < one.aiHours * 10, "案件ごとの工程まで掛け算している");
  assert.equal(ten.units, 10);
});

test("知らないプラットフォームを手数料0%で計算しない", () => {
  const finding = {
    platformId: "しらないサイト",
    priceJpy: { low: 10_000, high: 10_000 },
    estimatedHours: { low: 5, high: 5 },
  };
  const unknown = reconcileDiscovery(finding, 1000);
  const direct = reconcileDiscovery({ ...finding, platformId: "direct" }, 1000);
  assert.ok(unknown.hourlyJpy && direct.hourlyJpy);
  // 手数料0%（direct）より必ず低く出る
  assert.ok(unknown.hourlyJpy.high < direct.hourlyJpy.high, `${unknown.hourlyJpy.high} vs ${direct.hourlyJpy.high}`);
  assert.match(unknown.note, /手数料が分からない/);
});

test("相場を1単位あたりのまま案件全体の相場として書かない", () => {
  const breakdown = estimateByWorkType("SDSの作成をお願いします。20物質分です。");
  assert.ok(breakdown, "SDS と判定できていない");
  assert.equal(breakdown.units, 20);

  const r = buildRenegotiation({
    title: "SDS作成",
    offeredJpy: 30_000,
    hours: breakdown.aiHours,
    minHourlyJpy: 1500,
    platform: { feeRate: 0.2, withdrawalFeeJpy: 500, name: "クラウドワークス" },
    breakdown,
    marketRateJpy: breakdown.workType.marketRateJpy,
  });
  assert.ok(r);
  // 1物質15,000円をそのまま「相場」と書いていた。20物質なら30万円台。
  assert.match(r.message, /1物質あたり/, r.message);
  assert.match(r.message, /300,000/, r.message);
});
