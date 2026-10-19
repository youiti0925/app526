// 検索画面の登録（cw-patrol.mjs add-keyword）の、通信しない部分。
import test from "node:test";
import assert from "node:assert/strict";
import { WIDE_KEYWORDS, WIDE_WORD_LIST, keywordOf, rotate, searchUrlFrom } from "../../scripts/lib/cw-searches.mjs";

test("探す言葉は Excel だけに絞らない（文章・翻訳・データ・資料・Web・プログラミングを含む）", () => {
  const groups = WIDE_KEYWORDS.map((g) => g.group).join("|");
  for (const g of ["文章", "翻訳", "データ", "資料", "Web", "プログラミング", "Excel"]) assert.ok(groups.includes(g), g);
  assert.ok(WIDE_WORD_LIST.length >= 20);
  assert.equal(new Set(WIDE_WORD_LIST).size, WIDE_WORD_LIST.length, "同じ言葉を二重に持たない");
  assert.ok(WIDE_WORD_LIST.includes("記事作成") && WIDE_WORD_LIST.includes("文字起こし") && WIDE_WORD_LIST.includes("Python"));
});

test("登録済みの検索画面の形を借りて、言葉だけ差し替える（新着順にし、ページ番号は借りない）", () => {
  const registered = ["https://crowdworks.jp/public/jobs/search?hide_expired=true&order=score&page=3&search%5Bkeywords%5D=Excel"];
  const url = searchUrlFrom(registered, "文字起こし");
  const u = new URL(url);
  assert.equal(u.searchParams.get("search[keywords]"), "文字起こし");
  assert.equal(u.searchParams.get("order"), "new");
  assert.equal(u.searchParams.get("hide_expired"), "true");
  assert.equal(u.searchParams.get("page"), null);
  assert.equal(keywordOf(url), "文字起こし");
  // 空白つきの言葉も、そのまま1つの検索になる
  assert.equal(keywordOf(searchUrlFrom(registered, "SEO 記事")), "SEO 記事");
});

test("借りられる検索画面が無ければ、既定の形を使う（クラウドワークス以外のURLは借りない）", () => {
  for (const templates of [[], undefined, ["https://example.com/search?search%5Bkeywords%5D=x"], ["not a url"]]) {
    const url = searchUrlFrom(templates, "翻訳");
    assert.ok(url.startsWith("https://crowdworks.jp/public/jobs/search?"));
    assert.equal(keywordOf(url), "翻訳");
    assert.equal(new URL(url).searchParams.get("order"), "new");
  }
  assert.throws(() => searchUrlFrom([], "  "));
  assert.equal(keywordOf("https://crowdworks.jp/public/jobs?category_id=267"), null);
});

test("検索画面を回す順は、巡回ごとにずらす（毎回同じ検索で枠が埋まらない）", () => {
  const list = ["a", "b", "c", "d"];
  assert.deepEqual(rotate(list, 0), ["a", "b", "c", "d"]);
  assert.deepEqual(rotate(list, 1), ["b", "c", "d", "a"]);
  assert.deepEqual(rotate(list, 6), ["c", "d", "a", "b"]);
  assert.deepEqual(rotate(list, -1), ["d", "a", "b", "c"]);
  assert.deepEqual(rotate([], 3), []);
});
