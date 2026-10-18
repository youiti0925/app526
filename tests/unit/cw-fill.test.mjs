// 応募画面への入力（cw-patrol.mjs fill）の、通信しない部分。偽のページで「送信系に触らない」ことを確かめる。
import test from "node:test";
import assert from "node:assert/strict";
import { FIELDS, MAX_TABS, applyState, applyUrl, deadlineParts, fillProposalForm, jobIdFromUrl, parseList, validateEntry } from "../../scripts/lib/cw-fill.mjs";

/** Playwright の Page の、fill で使う部分だけを真似た偽物。操作をすべて記録する。 */
function fakePage(present) {
  const calls = [];
  const values = {};
  const locator = (sel) => {
    const el = {
      count: async () => (present[sel] ? 1 : 0),
      isVisible: async () => present[sel] === "visible",
      fill: async (v) => (calls.push(["fill", sel, v]), (values[sel] = v)),
      press: async (k) => calls.push(["press", sel, k]),
      check: async () => calls.push(["check", sel]),
      selectOption: async (v) => (calls.push(["select", sel, v]), (values[sel] = v)),
      click: async () => calls.push(["click", sel]),
    };
    return { ...el, first: () => el };
  };
  return { calls, values, locator, click: async (sel) => calls.push(["click", sel]) };
}

const FIXED_FORM = {
  [FIELDS.message]: "visible",
  [FIELDS.paymentFixed]: "visible",
  [FIELDS.presentContractFixed]: "visible",
  [FIELDS.amount]: "visible",
  [FIELDS.hourlyWage]: "hidden",
  [FIELDS.deadlineYear]: "visible",
  [FIELDS.deadlineMonth]: "visible",
  [FIELDS.deadlineDay]: "visible",
};

test("募集のURL・番号から募集番号を取り出す（クラウドワークス以外は断る）", () => {
  assert.equal(jobIdFromUrl("https://crowdworks.jp/public/jobs/13541720"), "13541720");
  assert.equal(jobIdFromUrl("https://crowdworks.jp/public/jobs/13541720?ref=x"), "13541720");
  assert.equal(jobIdFromUrl("https://crowdworks.jp/proposals/new?job_offer_id=13541720"), "13541720");
  assert.equal(jobIdFromUrl("13541720"), "13541720");
  assert.equal(jobIdFromUrl("https://evil.example/public/jobs/13541720"), null);
  assert.equal(jobIdFromUrl("https://crowdworks.jp/proposals/123"), null);
  assert.equal(applyUrl("1"), "https://crowdworks.jp/proposals/new?job_offer_id=1");
});

test("応募できない募集（応募済み・締切・リンク無し・ログイン切れ）は飛ばす", () => {
  const open = { text: "仕事の詳細 ...", hrefs: ["https://crowdworks.jp/proposals/new?job_offer_id=1"], finalUrl: "https://crowdworks.jp/public/jobs/1" };
  assert.equal(applyState(open).ok, true);
  assert.match(applyState({ ...open, text: "この仕事には応募済みです" }).reason, /応募済み/);
  assert.match(applyState({ ...open, text: "この仕事の募集は終了しています" }).reason, /終わって/);
  assert.equal(applyState({ ...open, hrefs: [] }).ok, false);
  assert.match(applyState({ ...open, finalUrl: "https://crowdworks.jp/login?x" }).reason, /ログイン/);
});

test("納期は日本時間の今日から数える", () => {
  // 日本時間 10/19 08:00（UTC 10/18 23:00）の 7 日後は 10/26
  assert.deepEqual(deadlineParts(7, new Date("2026-10-18T23:00:00Z")), { year: "2026", month: "10", day: "26" });
  assert.deepEqual(deadlineParts(14, new Date("2026-12-25T03:00:00Z")), { year: "2027", month: "1", day: "8" });
});

test("一覧ファイルを読み、おかしい値は先に止める", () => {
  const rows = parseList("# コメント\nhttps://crowdworks.jp/public/jobs/1\ta.txt\t5,000円\t7\n\nhttps://crowdworks.jp/public/jobs/2\tb.txt\n");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { url: "https://crowdworks.jp/public/jobs/1", proposal: "a.txt", price: 5000, days: 7 });
  assert.equal(rows[1].price, undefined);
  assert.deepEqual(validateEntry({ ...rows[0], message: "よろしくお願いします" }), []);
  assert.equal(validateEntry({ ...rows[0], message: " " }).length, 1);
  assert.equal(validateEntry({ ...rows[0], message: "x", price: -1 }).length, 1);
  assert.equal(validateEntry({ url: "https://example.com/", message: "x" }).length, 1);
  assert.equal(validateEntry({ ...rows[0], message: "経験があります。【要確認: QUERY関数の使用経験】" }).length, 1);
  assert.equal(validateEntry({ ...rows[0], message: "○○様 はじめまして" }).length, 1);
  assert.equal(MAX_TABS, 5);
});

test("固定報酬の応募画面に、提案文・金額・納期を入れ、送信系には一切触らない", async () => {
  const page = fakePage(FIXED_FORM);
  const r = await fillProposalForm(page, { message: "提案文です", price: 5000, days: 7, now: new Date("2026-10-18T23:00:00Z") });
  assert.equal(page.values[FIELDS.message], "提案文です");
  assert.equal(page.values[FIELDS.amount], "5000");
  assert.deepEqual([page.values[FIELDS.deadlineYear], page.values[FIELDS.deadlineMonth], page.values[FIELDS.deadlineDay]], ["2026", "10", "26"]);
  assert.equal(r.skipped.length, 0);
  // click は一度も呼ばない。check はラジオ（金額の出し方）だけ
  assert.equal(page.calls.filter((c) => c[0] === "click").length, 0);
  for (const c of page.calls.filter((c) => c[0] === "check")) assert.ok([FIELDS.paymentFixed, FIELDS.presentContractFixed].includes(c[1]), c[1]);
  // 触った欄はすべて FIELDS の中（ご意見箱などには触らない）
  const allowed = new Set(Object.values(FIELDS));
  for (const c of page.calls) assert.ok(allowed.has(c[1]), `想定外の欄に触った: ${c[1]}`);
});

test("時間単価制の画面では時間単価の欄に入れ、納期の欄が無ければ入れずに知らせる", async () => {
  const page = fakePage({ [FIELDS.message]: "visible", [FIELDS.hourlyWage]: "visible", [FIELDS.presentContractHourly]: "visible", [FIELDS.amount]: "hidden" });
  const r = await fillProposalForm(page, { message: "x", price: 1500, days: 7 });
  assert.equal(page.values[FIELDS.hourlyWage], "1500");
  assert.equal(page.values[FIELDS.amount], undefined);
  assert.match(r.skipped.join(), /納期/);
});

test("提案文の欄が無い画面（応募できない状態）では何も入れずに止める", async () => {
  const page = fakePage({});
  await assert.rejects(() => fillProposalForm(page, { message: "x" }), /提案文の欄が見つかりません/);
  assert.equal(page.calls.length, 0);
});
