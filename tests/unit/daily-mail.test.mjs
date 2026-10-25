// 巡回のメールを1日1回にまとめる（朝8時・日本時間より前は溜める。送ったら同じ日は溜めるだけ）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deliverDaily, buildDigest } from "../../scripts/lib/daily-mail.mjs";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dm-")), "d.json");
// 日本時間 = UTC+9
const jst = (iso) => new Date(`${iso}+09:00`);

test("朝8時前は溜め、8時以降の最初の巡回で1通にまとめて送り、同じ日は送らない", async () => {
  const file = tmp();
  const sent = [];
  const base = { file, from: "a@x", to: "a@x", send: async (m) => sent.push(m) };
  assert.equal(await deliverDaily({ ...base, source: "CW", entry: { subject: "【CW巡回】今やること 2件", body: "朝前の分", html: '<body><div style="max-width:600px;x">A</div></body>' }, now: jst("2026-10-25T05:00:00") }), "held");
  assert.equal(await deliverDaily({ ...base, source: "ランサーズ", entry: { subject: "【ランサーズ】候補 1件", body: "L" }, now: jst("2026-10-25T07:00:00") }), "held");
  assert.equal(sent.length, 0);
  assert.equal(await deliverDaily({ ...base, source: "CW", entry: null, now: jst("2026-10-25T08:05:00") }), "sent");
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes("multipart/alternative"));
  // 同じ日の2回目以降は溜めるだけ
  assert.equal(await deliverDaily({ ...base, source: "CW", entry: { subject: "【CW巡回】今やること 1件", body: "昼" }, now: jst("2026-10-25T11:00:00") }), "held");
  assert.equal(sent.length, 1);
  // 翌朝に送る
  assert.equal(await deliverDaily({ ...base, source: "CW", entry: null, now: jst("2026-10-26T08:10:00") }), "sent");
  assert.equal(sent.length, 2);
  // 送るものが無ければ何もしない
  assert.equal(await deliverDaily({ ...base, source: "CW", entry: null, now: jst("2026-10-27T09:00:00") }), "none");
});

test("送れなかったときは溜めたまま、force は時刻に関係なく今送る", async () => {
  const file = tmp();
  const base = { file, from: "a@x", to: "a@x" };
  const bad = await deliverDaily({ ...base, send: async () => { throw new Error("down"); }, source: "CW", entry: { subject: "s", body: "b" }, now: jst("2026-10-25T09:00:00") });
  assert.equal(bad, "failed");
  const sent = [];
  assert.equal(await deliverDaily({ ...base, send: async (m) => sent.push(m), source: "CW", entry: null, now: jst("2026-10-25T12:00:00") }), "sent");
  assert.equal(sent.length, 1);
  assert.equal(await deliverDaily({ ...base, send: async (m) => sent.push(m), source: "CW", entry: { subject: "s2", body: "b2" }, now: jst("2026-10-25T13:00:00"), force: true }), "sent");
  assert.equal(sent.length, 2);
});

test("まとめの件名・本文に、各巡回の分が入る", () => {
  const d = buildDigest([
    { source: "CW", at: jst("2026-10-25T05:00:00").toISOString(), subject: "【CW巡回】今やること 2件", body: "B1" },
    { source: "ランサーズ", at: jst("2026-10-25T07:00:00").toISOString(), subject: "【ランサーズ】応募候補 1件", body: "<b>B2</b>" },
  ], jst("2026-10-25T08:00:00"));
  assert.ok(d.subject.startsWith("【今日のまとめ】10/25"));
  assert.ok(d.body.includes("5:00 のCW巡回") && d.body.includes("7:00 のランサーズ巡回"));
  assert.ok(d.html.includes("&lt;b&gt;B2&lt;/b&gt;"));
});
