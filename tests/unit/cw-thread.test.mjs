// クラウドワークスの画面テキストの読み取り。実在の相手・内容は入れず、形だけを似せた作り話で確かめる。
import test from "node:test";
import assert from "node:assert/strict";
import { parseCwThreads, reviewCwThread, formatCwReview, scamLabel, ASKED_MARK, externalContactQuestion, externalBookingSignal } from "../../dist-test/jobs/cw-thread.js";

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
  const plain = SAMPLE.replace(/testshoji\n2026年10月06日 09:00\n[\s\S]*?登録後、クラウドワークス名を送ってください。\n/, "testshoji\n2026年10月06日 09:00\nご連絡ありがとうございます。募集の内容を補足します。\n");
  const r = reviewCwThread(parseCwThreads(plain, "taro_test")[0], now);
  assert.equal(r.waiting, "me");
  assert.equal(r.daysSinceLast, 6);
  assert.notEqual(r.scam?.verdict, "danger");
  assert.ok(r.actions[0].includes("まだ返していません"));
});

test("危険信号が強い相手には「返事するか決めてください」と言わず、返信しないと伝える(まとめの言い方と合わせる)", () => {
  const r = reviewCwThread(parseCwThreads(SAMPLE, "taro_test")[0], now);
  assert.equal(r.scam?.verdict, "danger");
  assert.ok(!r.actions.some((a) => a.includes("返事するか")));
  assert.ok(r.actions.some((a) => a.includes("返信しない")));
});

test("メッセージ欄の下の画面の定型文(添付の容量・条件の提示ボタン)は、発言の本文に入れない", () => {
  const withFooter = SAMPLE.replace("その後いかがでしょうか。\n", "その後いかがでしょうか。\n計 0 B/100MB\n新しい条件を提示する ▼\nテンプレートを選択\n");
  const [t] = parseCwThreads(withFooter, "taro_test");
  const last = t.messages[t.messages.length - 1];
  assert.equal(last.text, "その後いかがでしょうか。");
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

// 契約・仮払いのあとに、外のチャット(チャットワーク)へ誘うメッセージ。画面には外部連絡の申請が否認と出ている
const CONTRACT_CHATWORK = `契約詳細：【初心者歓迎】選んで入力するだけのデータ入力【個別指導で安心】
業務を開始しています
サービス外連絡申請が否認されました。サービス外連絡申請ステータス： 否認（申請者：テスト企画 さん）
※もし、外部の連絡先に誘導されても応じることなく、必ずクラウドワークス内でやり取りを行ってください。
※現在やりとりしているメッセージは、契約終了後2年間経過すると自動的に削除されます。

taro_test
2026年10月04日 21:32
お世話になります。お仕事の内容に興味がありご連絡いたしました。

テスト企画
2026年10月19日 12:37
仮払いが完了いたしました。
つきましては、調査員リーダーの 「tester」 より、詳しいお仕事内容をチャットワークにてご連絡させていただきます。
（チャットワークのコンタクトURL: chatwork.com/tester24）
【パソコンの場合】
1.チャットワークWebサイトにログインし、「コンタクト管理」画面へ移動します。
`;

test("契約後に、外のチャット(チャットワーク)へ誘うメッセージは危険にし、否認の表示も知らせる", () => {
  const r = reviewCwThread(parseCwThreads(CONTRACT_CHATWORK, "taro_test")[0], new Date("2026-10-19T18:00:00+09:00"));
  assert.equal(r.scam.verdict, "danger");
  assert.ok(r.scam.signals.some((s) => s.id === "thread_offplatform_chat"));
  assert.ok(r.flags.some((f) => f.includes("否認")), "否認の表示を知らせる");
  assert.ok(r.actions.some((a) => a.includes("連絡先は追加しない")));
  assert.ok(formatCwReview(r).includes("危険"));
});

test("外のチャットへの誘いでない普通の連絡や、自分の発言には反応しない", () => {
  const text = CONTRACT_CHATWORK.replace(/つきましては[\s\S]*$/, "つきましては、作業の流れを、このメッセージ内でご説明します。\n1. ファイルをお送りします。\n");
  const r = reviewCwThread(parseCwThreads(text, "taro_test")[0], new Date("2026-10-19T18:00:00+09:00"));
  assert.ok(!r.scam?.signals.some((s) => s.id === "thread_offplatform_chat"));
  assert.ok(!r.flags.some((f) => f.includes("否認")), "外へ誘っていないのに否認の注意は出さない");
  // 自分が「チャットワークでの連絡はできません」と書いた文は、相手の発言ではないので当てない
  const mine = CONTRACT_CHATWORK.replace("お仕事の内容に興味がありご連絡いたしました。", "チャットワークでのご連絡は控えております。");
  const r2 = reviewCwThread(parseCwThreads(mine.replace(/テスト企画\n2026年10月19日[\s\S]*$/, "テスト企画\n2026年10月19日 12:37\n承知しました。このままここでお願いします。\n"), "taro_test")[0], new Date("2026-10-19T18:00:00+09:00"));
  assert.ok(!r2.scam?.signals.some((s) => s.id === "thread_offplatform_chat"));
});

test("外のチャットへ誘われたら、クラウドワークスの中で理由を聞く返信の下書きを作る(否認の表示と仮払いに合わせる)", () => {
  const r = reviewCwThread(parseCwThreads(CONTRACT_CHATWORK, "taro_test")[0], new Date("2026-10-19T18:00:00+09:00"));
  assert.ok(r.draftReply, "下書きがある");
  assert.ok(r.draftReply.includes("チャットワーク"));
  assert.ok(r.draftReply.includes("否認"));
  assert.ok(r.draftReply.includes("仮払いのご対応ありがとうございます"));
  assert.ok(r.draftReply.includes(ASKED_MARK));
  assert.ok(!r.draftReply.includes("待ち"));
  // 否認の理由は画面に出ていないので、出ていないと言う(作り話の理由を書かない)
  assert.ok(r.flags.some((f) => f.includes("否認の理由は画面に出ていません")));
  // 否認でない誘い(LINEなど)は、先に仕事の内容をここで出してもらう形にする
  const line = CONTRACT_CHATWORK.replace("サービス外連絡申請が否認されました。サービス外連絡申請ステータス： 否認（申請者：テスト企画 さん）\n", "").replace(/チャットワーク/g, "LINE").replace("chatwork.com/tester24", "lin.ee/abc");
  const r2 = reviewCwThread(parseCwThreads(line, "taro_test")[0], new Date("2026-10-19T18:00:00+09:00"));
  assert.ok(r2.draftReply.includes("LINE"));
  assert.ok(!r2.draftReply.includes("否認"));
  assert.ok(r2.draftReply.includes("お仕事の内容・報酬・納期"));
});

test("理由を聞いたあとは下書きを作り直さず、相手の返事を判定する", () => {
  const asked = CONTRACT_CHATWORK + `\ntaro_test\n2026年10月19日 18:30\n${externalContactQuestion({ service: "チャットワーク", denied: true, afterPayment: true })}\n`;
  const now = new Date("2026-10-20T09:00:00+09:00");
  const r1 = reviewCwThread(parseCwThreads(asked, "taro_test")[0], now);
  assert.equal(r1.draftReply, undefined);
  assert.ok(r1.flags.some((f) => f.includes("質問済み")));
  // 外へは誘わず、ここで答えた
  const okReply = asked + "\nテスト企画\n2026年10月20日 08:00\nご指摘ありがとうございます。こちらのメッセージ内で進めます。まず、作業手順書をお送りします。\n";
  const r2 = reviewCwThread(parseCwThreads(okReply, "taro_test")[0], now);
  assert.ok(r2.flags.some((f) => f.includes("相手の返事があります")));
  // 答えずにまた外へ誘った
  const again = asked + "\nテスト企画\n2026年10月20日 08:00\nお手数ですが、チャットワークにて「tester」へご連絡ください。\n";
  const r3 = reviewCwThread(parseCwThreads(again, "taro_test")[0], now);
  assert.ok(r3.flags.some((f) => f.includes("答えずに外のチャットへ誘っています")));
  assert.equal(r3.draftReply, undefined);
});

test("画面に否認の理由が書かれていれば、そのまま出す", () => {
  const withReason = CONTRACT_CHATWORK.replace("サービス外連絡申請ステータス： 否認（申請者：テスト企画 さん）", "サービス外連絡申請ステータス： 否認（申請者：テスト企画 さん）\n否認理由：直接取引を目的とした申請と判断したため");
  const r = reviewCwThread(parseCwThreads(withReason, "taro_test")[0], new Date("2026-10-19T18:00:00+09:00"));
  assert.ok(r.flags.some((f) => f.includes("画面の表示") && f.includes("直接取引を目的とした申請と判断したため")));
  assert.ok(!r.flags.some((f) => f.includes("否認の理由は画面に出ていません")));
});

test("外部の予約サイト(timerex など)での説明会・面談の予約を求めるメッセージは危険にする。返事を考えるに出さず、返信しないと伝える", () => {
  assert.equal(externalBookingSignal("こちらから日程をご予約ください https://timerex.net/s/abc/def")?.id, "thread_external_booking");
  assert.equal(externalBookingSignal("ご応募ありがとうございます。業務内容は追ってお伝えします。"), null);
  const text = SAMPLE.replace(/testshoji\n2026年10月06日 09:00\n[\s\S]*?登録後、クラウドワークス名を送ってください。\n/, "testshoji\n2026年10月06日 09:00\nお仕事の前に10分のご案内のお時間をいただいております。こちらから予約ください https://timerex.net/s/abc/def\n");
  const r = reviewCwThread(parseCwThreads(text, "taro_test")[0], now);
  assert.equal(r.scam?.verdict, "danger");
  assert.ok(r.actions.some((a) => a.includes("返信しない")));
  assert.ok(!r.actions.some((a) => a.includes("返事するか")));
});

test("注意(caution)の相手にも「返事するか決めてください」と言わない(まとめの「返事をしなくてよい」と食い違うため)", () => {
  const text = SAMPLE.replace(/testshoji\n2026年10月06日 09:00\n[\s\S]*?登録後、クラウドワークス名を送ってください。\n/, "testshoji\n2026年10月06日 09:00\nスマホだけで簡単です。1日10分でOKです。\n");
  const r = reviewCwThread(parseCwThreads(text, "taro_test")[0], now);
  if (r.scam && r.scam.verdict !== "safe") {
    assert.ok(!r.actions.some((a) => a.includes("返事するか")));
    assert.ok(r.actions.some((a) => a.includes("返信")));
  }
});
