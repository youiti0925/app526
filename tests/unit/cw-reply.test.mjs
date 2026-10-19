// やり取りへの返信（cw-patrol.mjs reply / autosend）の、通信しない部分。
// 送ってよい種類・設定・間隔・上限の門番、送る文の確かめ、画面の欄の選び方を確かめる。
import test from "node:test";
import assert from "node:assert/strict";
import {
  SEND_KINDS,
  isThreadUrl,
  parseSentLog,
  pickReplyForm,
  scanReplyForms,
  sendGate,
  sentTextAppears,
  validateReplyText,
} from "../../scripts/lib/cw-reply.mjs";
import { externalContactQuestion } from "../../dist-test/jobs/cw-thread.js";

const URL1 = "https://crowdworks.jp/contracts/64033462";
const ON = { autoSend: { enabled: true, termsChecked: "2026-10-19 規約の原文を確認。自動送信の禁止なし" } };
const NOW = new Date("2026-10-19T03:00:00Z");

test("返信を入れてよいのは、クラウドワークスのやり取りの画面だけ", () => {
  assert.equal(isThreadUrl(URL1), true);
  assert.equal(isThreadUrl("https://crowdworks.jp/proposals/308929809"), true);
  assert.equal(isThreadUrl("https://crowdworks.jp/messages/64033462"), true);
  assert.equal(isThreadUrl("https://crowdworks.jp/public/jobs/1"), false);
  assert.equal(isThreadUrl("https://evil.example/contracts/1"), false);
  assert.equal(isThreadUrl("http://crowdworks.jp/contracts/1"), false);
  assert.equal(isThreadUrl("https://crowdworks.jp.evil.example/contracts/1"), false);
  assert.equal(isThreadUrl("not a url"), false);
});

test("自動で作る「理由を聞く質問」は、そのまま送れる文(書きかけ・連絡先なし)", () => {
  for (const denied of [true, false]) {
    const q = externalContactQuestion({ service: "チャットワーク", denied, afterPayment: true });
    assert.deepEqual(validateReplyText(q), [], q);
  }
});

test("送る文の確かめ: 空・書きかけ・URL・メール・電話番号は止める", () => {
  assert.ok(validateReplyText("").length);
  assert.ok(validateReplyText("【要確認】金額").some((p) => p.includes("書きかけ")));
  assert.ok(validateReplyText("こちらを見てください https://example.com/a").some((p) => p.includes("URL")));
  assert.ok(validateReplyText("連絡は a.b@example.com まで").some((p) => p.includes("メール")));
  assert.ok(validateReplyText("電話は 090-1234-5678 です").some((p) => p.includes("電話")));
  assert.ok(validateReplyText("あ".repeat(3001)).length);
  assert.deepEqual(validateReplyText("理由を教えてください。1. 仕事の内容 2. 報酬"), []);
});

test("門番: 設定がオフ・規約の確認なし・許可外の種類・別のURLは送らない", () => {
  assert.equal(sendGate({ config: {}, url: URL1, kind: "reason-question", now: NOW }).ok, false);
  assert.match(sendGate({ config: { autoSend: { enabled: false, termsChecked: "x" } }, url: URL1, kind: "reason-question", now: NOW }).reason, /オフ/);
  assert.match(sendGate({ config: { autoSend: { enabled: true } }, url: URL1, kind: "reason-question", now: NOW }).reason, /規約/);
  // 応募・納品・条件の交渉は、許可の対象外
  for (const kind of ["apply", "delivery", "negotiation", "price", ""]) {
    assert.equal(sendGate({ config: ON, url: URL1, kind, now: NOW }).ok, false, kind);
  }
  assert.match(sendGate({ config: ON, url: "https://crowdworks.jp/public/jobs/1", kind: "reason-question", now: NOW }).reason, /URL/);
  assert.equal(sendGate({ config: { autoSend: { ...ON.autoSend, kinds: [] } }, url: URL1, kind: "reason-question", now: NOW }).ok, false);
  assert.equal(sendGate({ config: ON, url: URL1, kind: "reason-question", now: NOW }).ok, true);
  assert.deepEqual(Object.keys(SEND_KINDS), ["reason-question"]);
});

test("門番: 同じやり取りに同じ種類を2回送らない／前の送信から10分あける／1日3件まで(日本時間の日)", () => {
  const at = (iso) => ({ url: "https://crowdworks.jp/contracts/1", kind: "reason-question", at: iso });
  // 同じURL・同じ種類
  assert.match(sendGate({ config: ON, url: URL1, kind: "reason-question", sentLog: [{ url: URL1, kind: "reason-question", at: "2026-10-01T00:00:00Z" }], now: NOW }).reason, /もう送って/);
  // 3分前に別の件を送った
  const soon = sendGate({ config: ON, url: URL1, kind: "reason-question", sentLog: [at("2026-10-19T02:57:00Z")], now: NOW });
  assert.equal(soon.ok, false);
  assert.match(soon.reason, /あと約7分/);
  // 15分前なら送れる
  assert.equal(sendGate({ config: ON, url: URL1, kind: "reason-question", sentLog: [at("2026-10-19T02:45:00Z")], now: NOW }).ok, true);
  // 今日(日本時間)すでに3件
  const three = ["2026-10-19T00:00:00Z", "2026-10-19T00:30:00Z", "2026-10-19T01:00:00Z"].map(at);
  assert.match(sendGate({ config: ON, url: URL1, kind: "reason-question", sentLog: three, now: NOW }).reason, /3 件まで/);
  // 日本時間では前の日(UTC 14:59 = JST 23:59)の分は数えない
  const yesterday = ["2026-10-18T10:00:00Z", "2026-10-18T11:00:00Z", "2026-10-18T14:59:00Z"].map(at);
  assert.equal(sendGate({ config: ON, url: URL1, kind: "reason-question", sentLog: yesterday, now: NOW }).ok, true);
});

test("送信記録は壊れた行を飛ばして読む", () => {
  const raw = `${JSON.stringify({ at: "2026-10-19T00:00:00Z", url: URL1, kind: "reason-question" })}\nこわれた行\n\n{"url":"x"}\n`;
  assert.equal(parseSentLog(raw).length, 1);
  assert.deepEqual(parseSentLog(undefined), []);
});

test("送ったあとの画面に、送った文の頭が出ているかで送信を確かめる", () => {
  const text = "お世話になっております。\n仮払いのご対応ありがとうございます。";
  assert.equal(sentTextAppears(`xxx お世話になっております。 仮払いの\nご対応ありがとうございます。 yyy`, text), true);
  assert.equal(sentTextAppears("何も出ていない画面", text), false);
  assert.equal(sentTextAppears("何か", ""), false);
});

const form = (o) => ({ index: 0, id: "", name: "", placeholder: "", formAction: "", shown: true, value: "", buttons: [{ key: `${o.index ?? 0}-0`, label: "送信", type: "submit", shown: true, disabled: false }], ...o });

test("欄の選び方: ご意見箱・検索・通報の組は選ばず、返信の組が1つだけのときに選ぶ", () => {
  const forms = [
    form({ index: 0, id: "feedback_body", formAction: "/feedbacks" }),
    form({ index: 1, name: "message[body]", formAction: "/contracts/1/messages", buttons: [{ key: "1-0", label: "メッセージを送信", type: "submit", shown: true, disabled: false }] }),
    form({ index: 2, name: "report[reason]", formAction: "/reports", buttons: [{ key: "2-0", label: "送信", type: "submit", shown: true, disabled: false }] }),
  ];
  const r = pickReplyForm(forms);
  assert.equal(r.ok, true);
  assert.equal(r.textarea, '[data-cwp-ta="1"]');
  assert.equal(r.button, '[data-cwp-btn="1-0"]');
  assert.equal(r.buttonLabel, "メッセージを送信");
});

test("欄の選び方: 送信ボタンに文字が無い(画像・アイコン)ときも、送信用の1つだけなら選ぶ。納品の組は選ばない", () => {
  const reply = form({ index: 3, name: "message[body]", placeholder: "ここにメッセージ", buttons: [{ key: "3-0", label: "", type: "submit", shown: true, disabled: false }] });
  const delivery = form({ index: 4, name: "message[body]", placeholder: "例）ファイルを納品いたします。", buttons: [{ key: "4-0", label: "納品完了報告をする", type: "submit", shown: true, disabled: false }] });
  const r = pickReplyForm([reply, delivery]);
  assert.equal(r.ok, true);
  assert.equal(r.textarea, '[data-cwp-ta="3"]');
  // 文字の無いボタンが2つあれば、どちらか決められない
  const two = form({ index: 5, buttons: [{ key: "5-0", label: "", type: "submit", shown: true, disabled: false }, { key: "5-1", label: "", type: "submit", shown: true, disabled: false }] });
  assert.equal(pickReplyForm([two]).ok, false);
});

test("欄の選び方: 本物の契約画面の形(返信欄は div#messageForm の中・ボタンは type=button の「メッセージを投稿する」。納品の欄はダイアログの中)", () => {
  const forms = [
    form({ index: 0, name: "content", buttons: [{ key: "0-0", label: "送信する", type: "button", shown: true, disabled: true }] }),
    form({
      index: 1,
      id: "message_body",
      name: "message[body]",
      placeholder: "ここにメッセージ",
      buttons: [
        { key: "1-0", label: "新しい条件を提示する", type: "button", shown: false, disabled: false },
        { key: "1-1", label: "テンプレートを作成", type: "button", shown: true, disabled: false },
        { key: "1-2", label: "メッセージを投稿する", type: "button", shown: true, disabled: false },
      ],
    }),
    form({ index: 2, id: "message_body", name: "message[body]", shown: false, inDialog: true, formAction: "/milestones/13915956/complete", buttons: [{ key: "2-0", label: "納品完了報告をする", type: "submit", shown: false, disabled: true }] }),
  ];
  const r = pickReplyForm(forms);
  assert.equal(r.ok, true);
  assert.equal(r.textarea, '[data-cwp-ta="1"]');
  assert.equal(r.buttonLabel, "メッセージを投稿する");
  // 納品のダイアログが開いて見えていても、納品の欄は選ばない
  const open = forms.map((f) => (f.index === 2 ? { ...f, shown: true, buttons: f.buttons.map((b) => ({ ...b, shown: true, disabled: false })) } : f));
  assert.equal(pickReplyForm(open).textarea, '[data-cwp-ta="1"]');
});

test("欄の選び方: 見つからない・複数ある・ボタンが曖昧なときは選ばない", () => {
  assert.equal(pickReplyForm([]).ok, false);
  assert.equal(pickReplyForm([form({ index: 0, shown: false })]).ok, false);
  const two = pickReplyForm([form({ index: 0, name: "a" }), form({ index: 1, name: "b" })]);
  assert.equal(two.ok, false);
  assert.match(two.reason, /複数/);
  const twoButtons = form({ index: 0, buttons: [
    { key: "0-0", label: "送信", type: "submit", shown: true, disabled: false },
    { key: "0-1", label: "返信", type: "submit", shown: true, disabled: false },
  ] });
  assert.equal(pickReplyForm([twoButtons]).ok, false);
  // 「下書き保存」「キャンセル」しかない組は選ばない
  const cancel = form({ index: 0, buttons: [{ key: "0-0", label: "キャンセル", type: "button", shown: true, disabled: false }] });
  assert.equal(pickReplyForm([cancel]).ok, false);
  // 押せない(disabled)送信ボタンは数えない
  const off = form({ index: 0, buttons: [{ key: "0-0", label: "送信", type: "submit", shown: true, disabled: true }] });
  assert.equal(pickReplyForm([off]).ok, false);
  // 見つけたものの一覧は、失敗のときも返す(直すために使う)
  assert.equal(two.seen.length, 2);
});

// 本物のブラウザで、欄の集め方を確かめる(ブラウザが使えない環境では飛ばす)
async function launch() {
  const { chromium } = await import("playwright-core");
  const tries = [
    { executablePath: process.env.CW_PATROL_EXECUTABLE },
    { channel: "msedge" },
    { executablePath: "/opt/pw-browsers/chromium" },
  ].filter((o) => o.channel || o.executablePath);
  for (const o of tries) {
    try {
      return await chromium.launch({ headless: true, ...o });
    } catch {
      /* 次を試す */
    }
  }
  return null;
}

test("本物のブラウザ: 画面の欄を集めて、返信の組だけを選べる(入力も送信もしない)", async (t) => {
  const browser = await launch().catch(() => null);
  if (!browser) return t.skip("ブラウザが使えないため飛ばします");
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <form action="/feedbacks"><textarea id="feedback_body"></textarea><button type="submit">ご意見を送信</button></form>
      <div>メッセージ</div>
      <form action="/contracts/1/messages" method="post">
        <textarea name="message[body]" placeholder="メッセージを入力"></textarea>
        <button type="button">テンプレートを選択</button>
        <input type="submit" value="メッセージを送信">
      </form>
      <form action="/hidden"><textarea name="x" style="display:none"></textarea><input type="submit" value="送信"></form>`);
    const forms = await page.evaluate(scanReplyForms);
    assert.equal(forms.length, 3);
    assert.equal(forms[2].shown, false);
    const pick = pickReplyForm(forms);
    assert.equal(pick.ok, true, JSON.stringify(pick));
    assert.equal(pick.buttonLabel, "メッセージを送信");
    // 選んだ印で、実際にその欄とボタンを指せる
    await page.locator(pick.textarea).first().fill("テスト");
    assert.equal(await page.locator('textarea[name="message[body]"]').inputValue(), "テスト");
    assert.equal(await page.locator(pick.button).first().getAttribute("value"), "メッセージを送信");
    assert.equal(await page.locator("#feedback_body").inputValue(), "");
  } finally {
    await browser.close();
  }
});
