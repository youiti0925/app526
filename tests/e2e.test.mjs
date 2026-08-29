// パイプライン全体を、AIキー無しで最後まで走らせる。
//
// なぜ要るか:
// 単体テストは各部品が正しいことしか見ていない。実際に落ちるのは
// 「工程Aが返した形を工程Bが読めない」ような、つなぎ目のほうです。
// そして「AIキーが無くても判定が成立する」がこのアプリの前提なので、
// キー無しで最後まで走ることは毎回確かめる価値があります。
//
// 実DBを汚さないよう、APP_DATA_DIR を一時ディレクトリに向けます。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module from "node:module";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "app526-e2e-"));
process.env.APP_DATA_DIR = dataDir;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

// コンパイル後も "@/lib/..." のまま残るので、require を差し替えて解決する。
const ROOT = path.resolve(import.meta.dirname, "..", "dist-e2e");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) {
    return original.call(this, path.join(ROOT, request.slice(2)), ...rest);
  }
  return original.call(this, request, ...rest);
};

const require_ = Module.createRequire(import.meta.url);
const { runAgent } = require_(path.join(ROOT, "lib/hustle/agent/runner.js"));
const agentDb = require_(path.join(ROOT, "lib/hustle/agent/db.js"));
const { hasApiKey } = require_(path.join(ROOT, "lib/hustle/ai.js"));

test("AIキーが無い状態で確認する（この前提が崩れたら残りは無意味）", () => {
  assert.equal(hasApiKey(), false, "テストがAIキーを拾っている");
});

test("案件を入れてパイプラインを最後まで回す", async () => {
  agentDb.insertLead({
    source: "manual",
    externalId: "e2e:1",
    url: "https://example.test/jobs/1",
    title: "商品説明文の作成",
    rawText: [
      "ECサイトの商品説明文の作成をお願いします。",
      "【業務内容】",
      "・1商品あたり300文字の説明文を作成",
      "・100商品分をお願いします",
      "・納期は2週間以内",
      "報酬は総額80,000円です。修正は2回まで。",
      "納品形式はスプレッドシートです。",
    ].join("\n"),
    budgetJpy: 80_000,
  });

  const { ran, result } = await runAgent({ trigger: "manual", force: true });

  assert.equal(ran, true);
  assert.equal(result.run.status, "done", JSON.stringify(result?.run));
  // AIキーが無いので生成は0回。それでも工程は走りきる。
  assert.equal(result.run.callsUsed, 0);

  // 判定まで進んでいること
  const leads = agentDb.readLeads();
  assert.equal(leads.length, 1);
  assert.notEqual(leads[0].status, "new", "判定されていない");

  // 監査ログが残っていること（何をしたか後から追えるのが前提）
  const events = agentDb.readEvents();
  assert.ok(events.length > 0, "イベントが1件も無い");
  assert.ok(
    events.some((e) => e.step === "triage"),
    "判定の記録が無い"
  );
});

test("2回目も落ちない（同じ案件を二重に処理しない）", async () => {
  const { result } = await runAgent({ trigger: "manual", force: true });
  assert.equal(result.run.status, "done", JSON.stringify(result?.run));
  assert.equal(agentDb.readLeads().length, 1, "案件が増えている");
});

test("自律運転がオフなら回さない", async () => {
  const out = await runAgent({ trigger: "daemon" });
  assert.equal(out.ran, false, JSON.stringify(out));
  assert.match(out.reason ?? "", /オフ/, JSON.stringify(out));
});

test("1日の上限を超えたら回さない", async () => {
  // ここまでで force 付きの実行を2回しているので、上限1回はすでに超えている。
  agentDb.writeAgentConfig({ enabled: true, maxRunsPerDay: 1 });
  const out = await runAgent({ trigger: "daemon" });
  assert.equal(out.ran, false, JSON.stringify(out));
  assert.match(out.reason ?? "", /上限/, JSON.stringify(out));
});

test("取り込み元は、入れたばかりの状態でも既定で有効になっている", () => {
  // defaultEnabled はどこからも読まれていなかったので、
  // 新規インストールでは取り込み元が1つも有効にならなかった。
  const config = agentDb.readAgentConfig();
  const on = Object.entries(config.sources)
    .filter(([, v]) => v.enabled)
    .map(([id]) => id);
  assert.deepEqual(on, ["mamaworks", "coconala"], JSON.stringify(config.sources));
});

test("承認待ちも出品も、件数が上限を超えても id で引ける", () => {
  // 一覧（上限つき）から find していたので、溜まると古いものが
  // 404 になり、承認も却下もできなくなっていた。同じ間違いを
  // 案件・出品でもしていた。
  const first = agentDb.pushInbox({
    runId: "e2e",
    kind: "question",
    priority: 1,
    title: "いちばん古い1件",
    body: "本文",
    actionUrl: "",
    leadId: null,
    meta: {},
  });
  for (let i = 0; i < 120; i++) {
    agentDb.pushInbox({
      runId: "e2e",
      kind: "question",
      priority: 50,
      title: `あとから来た ${i}`,
      body: "本文",
      actionUrl: "",
      leadId: null,
      meta: {},
    });
  }
  // 既定の一覧（100件）には入っていないこと＝上限を超えている状態
  assert.ok(
    !agentDb.readInbox("pending", 100).some((i) => i.id === first.id),
    "上限を超えていない。テストの前提が崩れている"
  );
  // それでも id で引ける
  assert.equal(agentDb.readInboxItem(first.id)?.title, "いちばん古い1件");
  assert.ok(agentDb.countInbox("pending") > 100);

  const listing = agentDb.upsertPublishedListing({
    workTypeId: "sds",
    title: "SDS作成",
    publishedAt: "2026-01-01",
    priceJpy: 30000,
  });
  assert.equal(agentDb.readPublishedListing(listing.id)?.title, "SDS作成");
  assert.equal(agentDb.readPublishedListing("そんなidは無い"), null);
});

test("上位モデルの判定は、新しい案件が増えても書き戻せる", () => {
  const target = agentDb.insertLead({
    source: "manual",
    externalId: "e2e:old",
    url: "https://example.test/jobs/old",
    title: "古い案件",
    rawText: "記事作成をお願いします。".repeat(30),
    budgetJpy: 50_000,
  }).lead;
  for (let i = 0; i < 320; i++) {
    agentDb.insertLead({
      source: "manual",
      externalId: `e2e:filler-${i}`,
      url: `https://example.test/jobs/f${i}`,
      title: `あとから来た ${i}`,
      rawText: "記事作成をお願いします。".repeat(30),
      budgetJpy: 50_000,
    });
  }
  // 新しい順300件には入っていない
  assert.ok(!agentDb.readLeads(undefined, 300).some((l) => l.id === target.id));
  // それでも id で引ける（ここが無くて判定が捨てられていた）
  assert.equal(agentDb.readLeadsByIds([target.id]).get(target.id)?.title, "古い案件");
});

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});
