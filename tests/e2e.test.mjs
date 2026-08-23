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
  assert.deepEqual(on, ["coconala"], JSON.stringify(config.sources));
});

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});
