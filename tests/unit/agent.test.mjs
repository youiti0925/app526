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

test("ページの飾りの「2,000万円」を予算と読み違えない", () => {
  assert.equal(extractBudget("累計取引額 2,000万円突破\n予算 5,000円"), 5000);
  assert.equal(extractBudget("会員1,500万人 取引2,000万円\n報酬は応相談です"), null);
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

// --- 出品の状態（承認は出品ではない）---------------------------------------

test("承認しただけの出品は「未出品」であって、経過日数の判定を始めない", async () => {
  const { reviewListing } = await import("../../dist-test/agent/listing-tracker.js");
  // 承認直後の記録: 出品日は空、状態は approved
  const listing = {
    id: "t1",
    workTypeId: "sds",
    title: "テスト出品",
    platformId: "coconala",
    priceJpy: 45000,
    url: "",
    publishedAt: "",
    status: "approved",
    views: 0,
    inquiries: 0,
    orders: 0,
    lastCheckedAt: "",
  };
  const r = reviewListing(listing, "2026-08-30");
  assert.equal(r.verdict, "too_early");
  assert.match(r.reason, /まだ出品されていません/);
  // 以前はここが publishedAt=承認日・status=published で保存され、
  // 出してもいない出品の「60日問い合わせゼロ」判定が動く恐れがあった。
});

test("出品日が空でも経過日数の計算が暴走しない", async () => {
  const { reviewListing } = await import("../../dist-test/agent/listing-tracker.js");
  const listing = {
    id: "t2",
    workTypeId: "sds",
    title: "テスト出品2",
    platformId: "coconala",
    priceJpy: 1000,
    url: "",
    publishedAt: "",
    status: "published",
    views: 0,
    inquiries: 0,
    orders: 0,
    lastCheckedAt: "",
  };
  const r = reviewListing(listing, "2026-08-30");
  assert.equal(r.ageDays, 0);
  assert.equal(r.verdict, "too_early");
  assert.match(r.nextAction, /出品日/);
});

// --- 締切超過の自動取り下げ（承認待ちのまま募集終了する事故の再発防止）--------

test("募集文の締切日を読み、超過した承認待ちだけを選ぶ", async () => {
  const { parseListedDeadline, isPastDeadline, findExpiredItems } = await import("../../dist-test/agent/maintenance.js");
  assert.equal(parseListedDeadline("応募状況 締切日 2026年8月28日 / 掲載日 2026年8月21日"), "2026-08-28");
  assert.equal(parseListedDeadline("締切日 2026年 9月 3日"), "2026-09-03");
  assert.equal(parseListedDeadline("納品希望日 ご相談"), null);
  assert.equal(parseListedDeadline("締切日 2026年13月40日"), null, "ありえない日付は読まない");

  // 締切当日はまだ出せる。過ぎたら下げる
  assert.equal(isPastDeadline("2026-08-30", "2026-08-30"), false);
  assert.equal(isPastDeadline("2026-08-28", "2026-08-30"), true);
  assert.equal(isPastDeadline(null, "2026-08-30"), false, "締切の書かれていない案件は触らない");

  const expired = findExpiredItems(
    [
      { id: "a", title: "海外企業リスト", leadRawText: "締切日 2026年8月28日" },
      { id: "b", title: "本日締切", leadRawText: "締切日 2026年8月30日" },
      { id: "c", title: "出品案（締切なし）", leadRawText: null },
      { id: "d", title: "貼り付け起源", leadRawText: "納期は相談" },
    ],
    "2026-08-30"
  );
  assert.deepEqual(expired.map((e) => e.inboxId), ["a"]);
  assert.equal(expired[0].deadline, "2026-08-28");
});

test("ページ下部の「個人情報保護方針」は機密の根拠にしない。本文の「個人情報」は従来どおり", async () => {
  const { checkGates } = await import("../../dist-test/agent/gates.js");
  const footer = "紙資料をExcelへ入力します。\nクライアント情報\n運営会社 利用規約 個人情報保護方針 特定商取引法に基づく表記";
  assert.ok(!checkGates(footer).gates?.some?.((g) => g.id === "confidentiality") && !JSON.stringify(checkGates(footer)).includes("機密・NDA"));
  assert.ok(JSON.stringify(checkGates("顧客の個人情報を含む名簿を入力します")).includes("機密・NDA"));
});

test("予算: 10円未満の仮入力（1文字1円など）は報酬として読まない", () => {
  assert.equal(extractBudget("報酬 1円（1文字）"), null);
  assert.equal(extractBudget("報酬 10,000円"), 10000);
});

test("予算: 依頼者の商品・コースの値段（括弧の中の個人○円・税込）は報酬にしない", () => {
  assert.equal(extractBudget("料金はご提案ください。ヒストリエコース（個人672,000円・税込）の営業です"), null);
  assert.equal(extractBudget("報酬 10,000円（税込）"), 10000);
});

test("機密・本人性の判定: 定型の表示や「記入しないでください」の注意書きでは立たない", async () => {
  const { checkGates } = await import("../../dist-test/agent/gates.js");
  assert.ok(!JSON.stringify(checkGates("アンケートです。個人情報は記入しないでください。")).includes("機密・NDA"));
  assert.ok(JSON.stringify(checkGates("顧客の個人情報を含む名簿を入力します")).includes("機密・NDA"));
});

test("無いと言い切っている文は条件に数えない（電話は一切ありません／出社なし／社外秘の開示は不要）", async () => {
  const { judgeDeliverability } = await import("../../dist-test/agent/deliverability.js");
  const { checkGates } = await import("../../dist-test/agent/gates.js");
  const { stripNegatedClauses } = await import("../../dist-test/agent/negation.js");

  // 実データ: 在宅のデータ整理の募集が、安心させる一文で「現地作業・電話」に落ちていた
  const home = "完全在宅（出社なし）です。営業活動・電話連絡・ライティング作成・手作業でのデータ打ち込みは一切ありません。AIを使った整理をお願いします。";
  assert.ok(!judgeDeliverability(home).matched.includes("onsite"), "否定文の電話・出社で現地作業にしない");
  // 本当に求めている電話は、そのまま拾う
  assert.ok(judgeDeliverability("お客様への電話対応をお願いします。").matched.includes("onsite"));
  assert.ok(judgeDeliverability("週1回の出社が必須です。").matched.includes("onsite"));
  // 否定の言い切りが別の節にあっても、前の節は残す
  assert.ok(judgeDeliverability("撮影が必要ですが、編集は不要です。").matched.includes("onsite"));

  // 実データ: 「社名のご開示は不要」の注意書きが機密・NDAに当たっていた
  assert.ok(!JSON.stringify(checkGates("30分のヒアリングです。※社外秘の情報や社名のご開示は不要です。")).includes("機密・NDA"));
  assert.ok(!JSON.stringify(checkGates("NDAの締結は必要ありません。")).includes("機密・NDA"));
  assert.ok(JSON.stringify(checkGates("社外秘の資料を扱います。NDAを締結していただきます。")).includes("機密・NDA"));
  // 無いこと自体が条件になるもの（クレジット表記なし）は消さない
  assert.ok(JSON.stringify(checkGates("納品物はクレジット表記なしでお願いします。")).includes("クレジット"));

  // 並んだ語は両方消えるが、助詞のある別の節は残る
  assert.equal(stripNegatedClauses("出社、電話連絡は一切ありません。"), "。");
  assert.match(stripNegatedClauses("NDAを締結してください、電話は不要です。"), /NDAを締結してください/);
  assert.doesNotMatch(stripNegatedClauses("NDAを締結してください、電話は不要です。"), /電話/);
  // 「問題ありませんか？」のような質問や、不要な〜（修飾）は消さない
  assert.match(stripNegatedClauses("電話でも問題ありませんか？"), /電話/);
  assert.match(stripNegatedClauses("不要な電話は断ってください。"), /電話/);
});

test("語の一部には当たらない（予算アロケーションの「ロケ」、ユーザー名「SAI12」の「SAI」）", async () => {
  const { judgeDeliverability } = await import("../../dist-test/agent/deliverability.js");
  assert.ok(!judgeDeliverability("広告の予算アロケーションの提案資料を作ります。").matched.includes("onsite"));
  assert.ok(!judgeDeliverability("応募者一覧\nSAI12 さん 2026/10/19").matched.includes("art"));
  assert.ok(judgeDeliverability("ロケ撮影の補助をお願いします。").matched.includes("onsite"));
  assert.ok(judgeDeliverability("SAIで線画を描ける方").matched.includes("art"));
});

test("詐欺判定: 作るホームページの仕様（LINEの友だち追加ページへリンク）は、ワーカーをLINEに誘う文と読まない", async () => {
  const { scoreScam } = await import("../../dist-test/scam-rules.js");
  const spec = "HPの全体リニューアルをお願いします。\n・LINEは、既存の友だち追加ページへリンクしてください。\n・Instagramは、保存済みのフィードを表示してください。";
  const ids = scoreScam(spec).signals.map((s) => s.id);
  assert.ok(!ids.includes("offplatform_link") && !ids.includes("line_only_contact"));
  // ワーカーへの誘導や、リンクそのものは従来どおり拾う
  assert.ok(scoreScam("詳細はLINEでお話しします。友だち追加をお願いします。").signals.some((s) => s.id === "offplatform_link"));
  assert.ok(scoreScam("LINEの友だち追加ページへリンクして連絡ください https://lin.ee/abc").signals.some((s) => s.id === "offplatform_link"));
});

test("AIの使用を禁止している募集は「確認が要る」に回す（見送りにはしない。使っていいと書いてあるものは引っかけない）", async () => {
  const { checkGates } = await import("../../dist-test/agent/gates.js");
  const hit = (t) => JSON.stringify(checkGates(t)).includes("AIの使用の禁止");
  for (const t of [
    "ChatGPTなどの生成AIの使用は禁止です。",
    "AI利用不可です。ご自身の言葉で書いてください。",
    "生成AIを使った執筆はご遠慮ください。",
    "AIの使用はNGとさせていただきます",
    "AIで作った文章は受け取れません。",
    "※AI禁止",
    "ＡＩの使用は禁止",
  ]) assert.ok(hit(t), `落とすべき: ${t}`);
  for (const t of [
    "生成AIの使用は禁止しません。むしろ歓迎です。",
    "ChatGPTを活用できる方歓迎です。",
    "AI利用OK。納期は厳守でお願いします。",
    "EMAILの利用は不可です。チャットでお願いします。",
    "AIの使用を禁止する旨の記載は一切ありません。",
    "記事を10本書いてください。AIを使えば速いです。",
  ]) assert.ok(!hit(t), `落としてはいけない: ${t}`);
});

test("AIの禁止は見送りでなく確認に回し、禁止の範囲を本文から抜き出す", async () => {
  const { checkGates } = await import("../../dist-test/agent/gates.js");
  const { readAiRestriction } = await import("../../dist-test/agent/ai-restriction.js");
  const g = checkGates("ブログ記事を書いてください。ChatGPTなどの生成AIの使用は禁止です。");
  assert.equal(g.passed, false);
  assert.equal(g.negotiable, true, "見送り(reject)にせず、確認してから応募に回る");

  const all = readAiRestriction("記事の執筆をお願いします。生成AIの使用は禁止です。納期は1週間です。");
  assert.equal(all.restricted, true);
  assert.equal(all.kind, "all");
  assert.deepEqual(all.scope, ["生成AIの使用は禁止です。"]);
  assert.match(all.summary, /AI禁止あり（全面に見えます）/);

  const part = readAiRestriction("バナーを作ってください。\n画像生成AIの使用は不可です。文章は自由です。");
  assert.equal(part.kind, "part");
  assert.deepEqual(part.scope, ["画像生成AIの使用は不可です。"]);
  assert.match(part.summary, /一部の範囲/);

  assert.equal(readAiRestriction("AIの使用は禁止しません。歓迎です。").restricted, false);
  assert.equal(readAiRestriction("記事を10本書いてください。").restricted, false);
});

// --- 本物の募集(2026-10-19 に PC で読んだもの)で見つかった見落とし -----------------------------

test("本物の募集: シナリオライター募集(AIは調査のみ可・平日昼の会議が必須)は、AI禁止と平日昼の拘束を拾う", async () => {
  const { readAiRestriction } = await import("../../dist-test/agent/ai-restriction.js");
  const { checkGates } = await import("../../dist-test/agent/gates.js");
  const { judgeDeliverability, explainDeliverability } = await import("../../dist-test/agent/deliverability.js");
  const text = [
    "YouTubeで大人気の「スカッとする話」をご執筆いただける、シナリオライターさんを募集しています☆",
    "【報酬】初回トライアル：5,000円 / 1本 本採用後：10,000円 / 1本",
    "■ シナリオ打ち合わせ（週3時間程度）",
    "以下の日程のうち、いずれか1つに参加必須です。",
    "木曜 13:00〜16:00",
    "金曜 13:00〜16:00",
    "※設定すり合わせのため、不参加の場合はシナリオをお渡しできません。",
    "【注意事項】",
    "他サイトからのコピー＆ペーストは固く禁止いたします。",
    "AIはリサーチでの使用を推奨しておりますが、それ以外は禁止です。",
  ].join("\n");
  const ai = readAiRestriction(text);
  assert.equal(ai.restricted, true, "「AIはリサーチでの使用を推奨…それ以外は禁止」を禁止と読む");
  assert.ok(ai.scope.some((s) => s.includes("それ以外は禁止")));
  const g = checkGates(text);
  const ids = g.hits.map((h) => h.id);
  assert.ok(ids.includes("ai_prohibited") && ids.includes("fixed_hours"), ids.join(","));
  // 禁止の文の「リサーチ」を、調査・要約の仕事の根拠にしない
  assert.ok(!explainDeliverability(text).some((m) => m.label.includes("調査") && m.matched.includes("リサーチ")));
  assert.ok(judgeDeliverability(text).canDeliver);
  // 平日の日中でない・必須でない書き方は拾わない
  assert.ok(!checkGates("打ち合わせは土曜 10:00〜11:00 に参加できる方歓迎です。").hits.some((h) => h.id === "fixed_hours"));
  assert.ok(!checkGates("稼働時間は平日 9:00〜18:00 の間で自由に決められます。").hits.some((h) => h.id === "fixed_hours"));
});

test("本物の募集: 補助金の事業計画書の作成は士業の独占業務の関門に当たる。「今日まで」は急かしではない", async () => {
  const { checkGates } = await import("../../dist-test/agent/gates.js");
  const { scoreScam } = await import("../../dist-test/scam-rules.js");
  const text = [
    "弊社は「補助金コンサル業務、WEB制作事業」を行っている会社です。【補助金コンサル業務の事業計画作成業務】を依頼させていただきたいです。",
    "※社会保険労務士の資格をお持ちの方は優遇させていただきます。",
    "今日まで「完全内製」と「外注コンサルタントへ依頼」を並行してクライアントを支援しており、100社以上の実績があります。",
    "【報酬（1案件あたり）】省力化投資補助金：20万円〜",
  ].join("\n");
  const g = checkGates(text);
  assert.ok(g.hits.some((h) => h.id === "restricted_work"));
  assert.equal(g.negotiable, false, "交渉では外せない(見送り)");
  assert.ok(!scoreScam(text).signals.some((s) => s.id === "urgency_pressure"));
  // 本当の急かしは拾う
  assert.ok(scoreScam("本日限定の募集です。").signals.some((s) => s.id === "urgency_pressure"));
  assert.ok(scoreScam("今日までにご応募ください。").signals.some((s) => s.id === "urgency_pressure"));
});

test("本物の募集: 契約金額は仮の額を入力させる・DMを大量に送る募集は危険信号に、成果報酬のみ(最低保証なし)は関門に当たる", async () => {
  const { checkGates } = await import("../../dist-test/agent/gates.js");
  const { scoreScam } = await import("../../dist-test/scam-rules.js");
  const dm = [
    "・ターゲットになる企業を探していただき、こちらが用意したテンプレートのメッセージを送信していただく作業です。",
    "・送信件数目安：週100件程度のDMを送っていただく形です。",
    "・新規の送信先リストアップ＋DM送信１件ごとに10円（返信対応は含まない）",
    "※固定報酬金額は仮で3000円とご入力ください。",
    "※契約金額を入力する欄の下にある「クライアントに源泉徴収をしてもらう」のチェックを外してご応募ください！",
  ].join("\n");
  const r = scoreScam(dm);
  const ids = r.signals.map((s) => s.id);
  assert.ok(ids.includes("placeholder_contract_amount") && ids.includes("mass_dm"), ids.join(","));
  assert.equal(r.verdict, "danger");
  // 普通の「契約金額」「DM」の言い方は拾わない
  assert.equal(scoreScam("契約金額は応募時に5,000円と入力してください。DMで連絡します。").signals.some((s) => s.id === "placeholder_contract_amount"), false);

  const sns = [
    "報酬は、活動によって得られた成果に応じてお支払いする成果報酬制です。",
    "成果によって報酬額は異なり、固定給や最低報酬の保証はありません。",
    "具体的な報酬単価や支払条件については、契約前にご案内します。",
  ].join("\n");
  const g = checkGates(sns);
  assert.ok(g.hits.some((h) => h.id === "commission_only") && g.negotiable === false);
  // 「保証はありません」を、収入の断定と読まない
  assert.equal(scoreScam(sns).signals.some((s) => s.id === "guaranteed_income"), false);
  assert.ok(scoreScam("月収50万円を保証します。").signals.some((s) => s.id === "guaranteed_income"));
  // 成果報酬が上乗せで、固定の報酬もある募集は関門に当たらない
  assert.equal(checkGates("固定報酬は1記事3,000円です。成果に応じて別途ボーナスがあります。").hits.some((h) => h.id === "commission_only"), false);
});

// --- 2026-10-19 実データ(クラウドワークスの新着)で出た誤判定 --------------------------------

test("「来社は一切なく、完全在宅」は現地作業に数えない。ただし「ではなく」の対比や、本当の来社は残す", async () => {
  const { judgeDeliverability } = await import("../../dist-test/agent/deliverability.js");
  const { stripNegatedClauses } = await import("../../dist-test/agent/negation.js");
  assert.ok(!judgeDeliverability("作業はマネーフォワード上で行います。・来社は一切なく、完全在宅でのお仕事です。").matched.includes("onsite"));
  assert.ok(!judgeDeliverability("出社はなく、在宅で完結します。").matched.includes("onsite"));
  assert.ok(judgeDeliverability("オンラインではなく、来社での打ち合わせが必須です。").matched.includes("onsite"));
  assert.ok(judgeDeliverability("週1回の来社が必要です。").matched.includes("onsite"));
  assert.match(stripNegatedClauses("電話ではなく、メールで連絡します。"), /電話/);
});

test("記事ライターの募集の「・営業リスト作成、CRM」は、記事のテーマ例であって個人情報を集める依頼ではない。リスト作成の募集は従来どおり止める", async () => {
  const { checkGates, dropTopicBullets } = await import("../../dist-test/agent/gates.js");
  const writer =
    "【AI好き歓迎】Claude Code・AIエージェントのX記事ライター募集 仕事の概要 固定報酬制 " +
    "記事のテーマ例 【マーケティングAX】 ・営業リスト作成、CRM、商談分析 ・営業資料の自動作成 【コンテンツ制作】 ・画像生成、動画生成";
  assert.ok(!JSON.stringify(checkGates(writer)).includes("個人の連絡先"));
  assert.ok(!dropTopicBullets(writer).includes("営業リスト"));
  // ライターの募集でも、箇条書きの外で個人の連絡先の収集を頼んでいれば止める
  assert.ok(JSON.stringify(checkGates("記事ライター募集。あわせて、経営者のメールアドレスを収集してリストにしてください。")).includes("個人の連絡先"));
  // ライター以外の募集は、箇条書きでも従来どおり止める
  assert.ok(JSON.stringify(checkGates("データ入力のお仕事です。\n・営業リスト作成\n・住所の確認")).includes("個人の連絡先"));
  assert.ok(JSON.stringify(checkGates("営業リスト作成のお仕事です。")).includes("個人の連絡先"));
});

test("詐欺判定: 「コピペするだけのAI完結作業ではありません」のような、そうではないと言う文は訴求に数えない", async () => {
  const { scoreScam } = await import("../../dist-test/scam-rules.js");
  const text = "ただ出力されたものをコピペするだけのAI完結作業ではありません。記事の構成と事実確認をお願いします。";
  assert.ok(!scoreScam(text).signals.some((s) => s.id === "effortless_claim"));
  assert.ok(scoreScam("スマホだけで簡単に稼げます。コピペするだけ。").signals.some((s) => s.id === "effortless_claim"));
  assert.ok(scoreScam("1日10分で月10万円。").signals.some((s) => s.id === "effortless_claim"));
});

test("納期: 「即日スタート」「即日お支払い」は即日納品ではない。納品や提出の話のときだけ即日と読む", async () => {
  const { readDeadline } = await import("../../dist-test/agent/deadline.js");
  const now = new Date("2026-10-19T03:00:00+09:00");
  assert.notEqual(readDeadline("即日スタート可能な方を募集します。納品希望日は11月2日です。", now).days, 0);
  assert.equal(readDeadline("報酬は即日お支払いします。", now).rushed, false);
  assert.equal(readDeadline("即日勤務できる方歓迎。", now).days === 0, false);
  assert.equal(readDeadline("即日納品でお願いします。", now).days, 0);
  assert.equal(readDeadline("本日中にご対応いただける方。", now).days, 0);
  assert.equal(readDeadline("至急対応お願いします。", now).rushed, true);
});
