// ランサーズ巡回（lancers-patrol.mjs）の、通信しない部分。
import test from "node:test";
import assert from "node:assert/strict";
import {
  clientIdFromUrl,
  clientScore,
  formatList,
  jobIdFromUrl,
  normalizeDetail,
  normalizeListItem,
  onePerClient,
  parseSubnote,
  searchUrl,
} from "../../scripts/lib/lancers.mjs";

test("検索URLは新着順、2ページ目から page を付ける", () => {
  assert.equal(searchUrl("VBA"), "https://www.lancers.jp/work/search?keyword=VBA&sort=started");
  assert.match(searchUrl("エクセル", 2), /keyword=%E3%82%A8.*&sort=started&page=2$/);
});

test("募集のURLだけを拾い、広告・ほかのサイトは捨てる", () => {
  assert.equal(jobIdFromUrl("https://www.lancers.jp/work/detail/5617444"), "5617444");
  assert.equal(jobIdFromUrl("/work/detail/12?purpose=lancer"), "12");
  assert.equal(jobIdFromUrl("https://tech-agent.lancers.jp/projects/1"), null);
  assert.equal(normalizeListItem({ href: "https://tech-agent.lancers.jp/x", title: "広告" }), null);
  assert.equal(normalizeListItem({ href: "https://www.lancers.jp/work/detail/9", inLatest: true }), null);
});

test("依頼者の欄から発注数と評価を読む", () => {
  assert.deepEqual(parseSubnote("発注 1,234  評価 4.9"), { orders: 1234, rating: 4.9 });
  assert.deepEqual(parseSubnote(""), { orders: null, rating: null });
});

test("リピートの多い依頼者ほど点数が高い", () => {
  const many = clientScore({ awarded: 370, good: 200, bad: 1, awardRate: 80, verified: true });
  const none = clientScore({ awarded: 0, awardRate: 0, verified: false });
  const fewBad = clientScore({ awarded: 20, good: 5, bad: 5, verified: true });
  assert.ok(many > fewBad && fewBad > none);
});

test("詳細: 終了した募集を見分け、確認済みの項目と発注率を読む", () => {
  const d = normalizeDetail({
    budget: "20,000",
    remaining: "5日と17時間",
    tags: ["募集中"],
    checks: [{ label: "本人確認", done: true }, { label: "電話確認", done: false }],
    percent: "80%",
    awarded: "370",
    posted: "461",
  });
  assert.equal(d.closed, false);
  assert.equal(d.verified, true);
  assert.equal(d.checks["電話確認"], false);
  assert.equal(d.budget, "20,000円");
  assert.deepEqual([d.awardRate, d.awarded, d.posted], [80, 370, 461]);
  assert.equal(normalizeDetail({ remaining: "募集終了" }).closed, true);
  assert.equal(normalizeDetail({ tags: ["終了"] }).closed, true);
  assert.equal(normalizeDetail({ completedNote: true }).closed, true);
});

test("一覧は「応募してよい」が先、同じ判定なら依頼者の点数順", () => {
  const md = formatList([
    { id: "1", title: "A", verdict: "確認してから応募", score: 90 },
    { id: "2", title: "B", verdict: "応募してよい", score: 10 },
    { id: "3", title: "C|x", verdict: "応募してよい", score: 50 },
  ]);
  const rows = md.split("\n").filter((l) => /^\| \d/.test(l));
  assert.deepEqual(rows.map((r) => r.split("|")[4].trim().match(/\[(.+?)\]/)[1]), ["C／x", "B", "A"]);
  assert.match(md, /応募はしていません/);
  assert.match(md, /work\/detail\/3\?purpose=lancer/);
});

test("一覧: 題名の空白をまとめ、終わった募集と「当選者数」を提案数と取り違えない", () => {
  const it = normalizeListItem({
    href: "https://www.lancers.jp/work/detail/5",
    title: "\n   【急募】 エクセル\n  で見積書  ",
    remaining: "募集終了",
    proposals: "当選者数 0 人 / 募集人数 1 人",
    closed: true,
  });
  assert.equal(it.title, "【急募】 エクセル で見積書");
  assert.equal(it.closed, true);
  assert.equal(it.proposals, null);
  assert.equal(normalizeListItem({ href: "/work/detail/6", proposals: "提案数 45 件" }).proposals, 45);
  assert.equal(normalizeListItem({ href: "/work/detail/7", remaining: "あと3日" }).closed, false);
});

test("詳細: 予算は幅のまま「円」をつめて読む", () => {
  assert.equal(normalizeDetail({ budget: " 50,000 円 ~ 100,000 円 " }).budget, "50,000円 ~ 100,000円");
  assert.equal(normalizeDetail({ budget: "~ 5,000 円" }).budget, "~ 5,000円");
});

test("依頼者は一覧の /client/<名前> で見分ける", () => {
  assert.equal(clientIdFromUrl("https://www.lancers.jp/client/ops_desk"), "ops_desk");
  assert.equal(clientIdFromUrl("/client/JCS20240724/"), "JCS20240724");
  assert.equal(clientIdFromUrl("https://tech-agent.lancers.jp/client/x"), null);
  assert.equal(clientIdFromUrl(""), null);
  assert.equal(normalizeListItem({ href: "/work/detail/1", clientHref: "/client/abc" }).client, "abc");
});

test("詳細を読むのは依頼者1人につき1件まで、分からなければ題名の先頭20文字で見分ける", () => {
  const picked = onePerClient(
    [
      { id: "1", client: "a", title: "電話対応スタッフ募集" },
      { id: "2", client: "a", title: "フォーム送信スタッフ募集" },
      { id: "3", client: "b", title: "見積書の雛形" },
      { id: "4", client: null, title: "【急募】エクセルで見積書の雛形作成をお願いしたいです（1）" },
      { id: "5", client: null, title: "【急募】 エクセルで見積書の雛形作成をお願いしたいです（2）" },
      { id: "6", client: null, title: "別の依頼" },
    ],
    3
  );
  assert.deepEqual(picked.map((j) => j.id), ["1", "3", "4"]);
  assert.deepEqual(onePerClient([{ id: "4", title: "【急募】エクセルで見積書の雛形作成をお願いしたいです（1）" }, { id: "5", title: "【急募】 エクセルで見積書の雛形作成をお願いしたいです（2）" }, { id: "6", title: "別" }]).map((j) => j.id), ["4", "6"]);
});

test("検索語は前回の続きから順番に回し、一周したら最初に戻る", async () => {
  const { rotateKeywords, DEFAULT_KEYWORDS } = await import("../../scripts/lib/lancers.mjs");
  const all = ["a", "b", "c", "d", "e"];
  assert.deepEqual(rotateKeywords(all, 0, 3), { words: ["a", "b", "c"], next: 3 });
  assert.deepEqual(rotateKeywords(all, 3, 3), { words: ["d", "e", "a"], next: 1 });
  assert.deepEqual(rotateKeywords(all, 0, 9).words, all);
  assert.ok(DEFAULT_KEYWORDS.includes("文字起こし") && DEFAULT_KEYWORDS.includes("翻訳") && DEFAULT_KEYWORDS.includes("Python"));
});
