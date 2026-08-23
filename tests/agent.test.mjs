// 自律エージェントの純ロジックの回帰テスト。
// AIキー無しでも判定が成立することが最重要なので、そこを厚く見る。
import test from "node:test";
import assert from "node:assert/strict";

import { estimateHours, detectScopeRisks } from "../dist-test/agent/estimate.js";
import { extractBudget, parsePasted, parseFeed, splitPasted, fingerprint, cleanEmail } from "../dist-test/agent/ingest.js";
import { CallBudget } from "../dist-test/agent/budget.js";

// --- 作業量の見積もり（AIなしで実効時給を出すための土台）-------------------

test("文字数×本数から作業時間を見積もる", () => {
  const e = estimateHours("記事作成をお願いします。1記事3000文字、10本お願いします。");
  assert.ok(e, "見積もれていない");
  // 30,000文字 ÷ 1,200文字/時 = 25時間。そこに2〜8割の上乗せ。
  assert.ok(e.lowHours >= 29 && e.lowHours <= 31, `low=${e.lowHours}`);
  assert.ok(e.highHours >= 44 && e.highHours <= 46, `high=${e.highHours}`);
  assert.ok(e.highHours > e.lowHours);
  assert.match(e.basis, /上乗せ/);
});

test("データ入力の件数から見積もる", () => {
  const e = estimateHours("企業リストの作成です。500件の企業情報を入力してください。");
  assert.ok(e);
  // 500件 × 2分 = 16.7時間
  assert.ok(e.lowHours >= 19 && e.lowHours <= 21, `low=${e.lowHours}`);
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
