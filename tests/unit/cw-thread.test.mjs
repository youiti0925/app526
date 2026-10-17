// クラウドワークスの画面テキストの読み取り。実在の相手・内容は入れず、形だけを似せた作り話で確かめる。
import test from "node:test";
import assert from "node:assert/strict";
import { parseCwThreads, reviewCwThread, formatCwReview, scamLabel } from "../../dist-test/jobs/cw-thread.js";

const SAMPLE = `相談から契約まで：テスト商事 データ入力のお仕事
 詳しい説明はこちら
気軽な相談	応募・スカウト	条件交渉	条件合意	契約
現在、クライアントが、あなたの提示した条件を確認中です。しばらくお待ちください。
【注意】まだ業務を開始しないでください。契約後に、クライアントが仮払いをおこなってから、業務を開始してください。
これまでの条件提示
条件（税込）	日時
募集条件		固定報酬: 10,000円 〜 30,000円	-
最新	自分 » testshoji	固定報酬: 330,000円
（源泉徴収税・システム利用料控除後のメンバー報酬：259,220円）
2026年10月05日 20:10
メッセージ
スクール勧誘・ねずみ講・直接契約などの禁止行為にご注意ください悪質案件の例を見る
違反報告をする
 スター付きメッセージ一覧
メッセージを探す
※現在やりとりしているメッセージは、契約終了後2年間経過すると自動的に削除されます。


taro_test
2026年10月05日 20:10
はじめまして。応募します。


問題報告
testshoji
2026年10月06日 09:00
ご連絡ありがとうございます。詳細は公式LINEでお伝えします。
https://lin.ee/abcdefg
登録後、クラウドワークス名を送ってください。


問題報告
testshoji
2026年10月10日 12:30
その後いかがでしょうか。
`;

const now = new Date("2026-10-17T03:00:00+09:00");

test("スレッドを読み、発言者・日時・本文を分ける", () => {
  const [t] = parseCwThreads(SAMPLE, "taro_test");
  assert.equal(t.title, "テスト商事 データ入力のお仕事");
  assert.equal(t.messages.length, 3);
  assert.deepEqual(t.messages.map((m) => m.mine), [true, false, false]);
  assert.equal(t.messages[1].from, "testshoji");
  assert.equal(t.messages[1].at, "2026-10-06T09:00:00+09:00");
  assert.ok(t.messages[1].text.includes("lin.ee"));
  assert.ok(!t.messages[1].text.includes("問題報告"));
  assert.ok(!t.messages[0].text.includes("testshoji"));
});

test("最後が相手の発言なら、返事待ち（あなた）とその日数を出す", () => {
  const r = reviewCwThread(parseCwThreads(SAMPLE, "taro_test")[0], now);
  assert.equal(r.waiting, "me");
  assert.equal(r.daysSinceLast, 6);
  assert.ok(r.actions[0].includes("まだ返していません"));
});

test("最後が自分の発言で1週間たてば、見送りの目安を出す", () => {
  const text = SAMPLE.replace("testshoji\n2026年10月10日 12:30\nその後いかがでしょうか。", "taro_test\n2026年10月08日 18:00\n条件を確認しました。いかがでしょうか。");
  const r = reviewCwThread(parseCwThreads(text, "taro_test")[0], now);
  assert.equal(r.waiting, "client");
  assert.ok(r.actions.some((a) => a.includes("返事がありません")));
});

test("自分の提示額が募集の上限の2倍を超えていれば知らせる", () => {
  const r = reviewCwThread(parseCwThreads(SAMPLE, "taro_test")[0], now);
  assert.ok(r.flags.some((f) => f.includes("330,000円") && f.includes("入力ミス")));
  assert.ok(r.flags.some((f) => f.includes("業務を開始しないで")));
});

test("詐欺ルールは相手の発言にだけ当て、LINE誘導を拾う", () => {
  const r = reviewCwThread(parseCwThreads(SAMPLE, "taro_test")[0], now);
  assert.equal(r.scam?.verdict, "danger");
  assert.ok(r.scam?.signals.some((s) => s.id === "offplatform_link"));
  // 自分の発言だけなら、LINEの話が出ても相手のせいにしない
  const mineOnly = SAMPLE.replace("はじめまして。応募します。", "LINEは使いません。https://lin.ee/zzz は開きません。").replace(/testshoji\n2026年10月06日[\s\S]*$/, "");
  const r2 = reviewCwThread(parseCwThreads(mineOnly, "taro_test")[0], now);
  assert.equal(r2.scam, null);
});

test("「安全」とは言わない", () => {
  assert.ok(!scamLabel({ score: 0, verdict: "safe", signals: [], advice: "" }).includes("安全です"));
  assert.ok(scamLabel({ score: 0, verdict: "safe", signals: [], advice: "" }).includes("保証ではありません"));
  assert.ok(formatCwReview(reviewCwThread(parseCwThreads(SAMPLE, "taro_test")[0], now)).includes("危険"));
});

test("複数のスレッドを続けて貼っても分けて読む／見出しが無くても落ちない", () => {
  const two = parseCwThreads(`${SAMPLE}\n${SAMPLE.replace("テスト商事", "別の会社")}`, "taro_test");
  assert.equal(two.length, 2);
  assert.equal(two[1].title, "別の会社 データ入力のお仕事");
  const none = parseCwThreads("ただの文章です", "taro_test");
  assert.equal(none.length, 1);
  assert.equal(none[0].messages.length, 0);
  assert.ok(formatCwReview(reviewCwThread(none[0], now)).includes("読めませんでした"));
});
