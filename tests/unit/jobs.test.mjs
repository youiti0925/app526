// 仕事ライン（依頼→振り分け→手順書→作業→検品→やり直し→承認待ち）の回帰テスト。
// AIとページ取得は偽物を渡す。本物のClaudeは呼ばない。
import test from "node:test";
import assert from "node:assert/strict";

import { validateRecipe, nextTier } from "../../dist-test/jobs/recipe.js";
import { runRecipe, withSrc, verifyLookup } from "../../dist-test/jobs/ops.js";
import { summarize, compareToExpected, checkOutput, cellKey, MAX_ERROR_ROW_RATE } from "../../dist-test/jobs/checks.js";
import { scoreRecipes, decideByRule, parseRouteResponse } from "../../dist-test/jobs/router.js";
import { readCliOutput, createCaller, buildCliArgs, QuotaPauseError } from "../../dist-test/jobs/models.js";
import { isPrivateAddress, createPageFetcher } from "../../dist-test/jobs/fetcher.js";
import { processJob } from "../../dist-test/jobs/pipeline.js";
import { candidatesFor, compareModels } from "../../dist-test/jobs/compare.js";
import { parseTable } from "../../dist-test/dataops/table.js";

// --- 共通の偽物 ---------------------------------------------------------------

const usage = (req, ok = true) => ({
  provider: req.override?.provider ?? "claude", model: req.override?.model ?? req.tier, tier: req.tier, purpose: req.purpose,
  ok, durationMs: 1, inputTokens: 1, outputTokens: 1, cacheTokens: 0, costUsd: 0, note: "",
});

/** purpose ごとの応答を返す偽のAI。呼ばれた内容を calls に残す。 */
function fakeCaller(handlers) {
  const calls = [];
  const fn = async (req) => {
    calls.push(req);
    const h = handlers[req.purpose];
    if (!h) return { ok: false, data: null, error: `unexpected ${req.purpose}`, usage: usage(req, false) };
    const data = await h(req);
    return data === null ? { ok: false, data: null, error: "fail", usage: usage(req, false) } : { ok: true, data, usage: usage(req) };
  };
  fn.calls = calls;
  return fn;
}

const noFetch = async (url) => ({ ok: false, url, text: "", reason: "テストでは取得しない" });

function memoryStore(initial = []) {
  const all = [...initial];
  return {
    all,
    list: () => {
      const latest = new Map();
      for (const r of all) if (!latest.has(r.id) || latest.get(r.id).version < r.version) latest.set(r.id, r);
      return [...latest.values()];
    },
    get: (id) => all.filter((r) => r.id === id).sort((a, b) => b.version - a.version)[0] ?? null,
    save: (r) => {
      const top = Math.max(0, ...all.filter((x) => x.id === r.id).map((x) => x.version));
      const saved = { ...r, version: top + 1 };
      all.push(saved);
      return saved;
    },
  };
}

const LABELS = ["見積", "苦情", "その他"];

const RECIPE = {
  name: "問い合わせ分類",
  summary: "問い合わせ文から電話番号を抜き、内容を分類する",
  match: { keywords: ["問い合わせ", "分類", "電話番号"], description: "問い合わせの一覧を分類する" },
  input: { columns: ["会社名", "本文"] },
  steps: [
    { op: "normalize", column: "会社名", kind: "text" },
    { op: "extract", from: "本文", kind: "phone", into: "電話", pick: "first" },
    { op: "ai_classify", from: "本文", labels: LABELS, into: "分類" },
  ],
  output: {
    columns: ["会社名", "電話", "分類"],
    rules: { 会社名: [{ kind: "required" }], 分類: [{ kind: "oneOf", values: LABELS }] },
  },
  tier: "light",
};

const CSV = [
  "会社名,本文",
  "Ａ商事,見積をお願いします。03-1234-5678まで",
  "B工業,納品が遅いです",
  "C社,資料の件です",
  "D社,むずかしい相談です",
  "E社,むずかしい案件の見積",
].join("\n");

const expectedFor = (rows) =>
  rows.map((r) => ({
    会社名: r["会社名"].replace("Ａ", "A"),
    電話: (r["本文"].match(/0\d{1,3}-\d{2,4}-\d{4}/) ?? [""])[0],
    分類: label(r["本文"]),
  }));

function label(text) {
  if (text.includes("見積")) return "見積";
  if (/遅い|ひどい/.test(text)) return "苦情";
  return "その他";
}

/** 分類プロンプト（"0: 本文"の行）を読んで答える。weak のときは「むずかしい」を分類できない。 */
function classifyAnswer(prompt, weak) {
  const rows = [...prompt.matchAll(/^(\d+): (.*)$/gm)].map((m) => ({ index: Number(m[1]), text: m[2] }));
  return {
    rows: rows.map(({ index, text }) =>
      weak && text.includes("むずかしい")
        ? { index, label: "分類不能", quote: "" }
        : { index, label: label(text), quote: text.slice(0, 4) }
    ),
  };
}

const job = (over = {}) => ({
  id: "job-1", title: "問い合わせの分類", instructions: "問い合わせ一覧の分類と電話番号の抜き出しをお願いします",
  inputCsv: CSV, lists: {}, dataClass: "confidential", deadline: "", priceJpy: 0, status: "working", note: "",
  recipeId: null, recipeVersion: null, route: null, outputCsv: "", issues: [], removed: [], report: null,
  qualityPass: null, outputSrc: [], feedback: "", inboxId: null, error: "", retryAt: null,
  createdAt: "", updatedAt: "", startedAt: null, finishedAt: null, ...over,
});

const okReview = async () => ({ problems: [], systemic: "" });

// --- 手順書の検証 ---------------------------------------------------------------

test("正しい手順書は通り、使えない操作・存在しない列・危ない正規表現は弾く", () => {
  const ok = validateRecipe(RECIPE);
  assert.equal(ok.ok, true, ok.errors.join("\n"));
  assert.equal(ok.recipe.steps.length, 3);

  const unknownOp = validateRecipe({ ...RECIPE, steps: [...RECIPE.steps, { op: "run_shell", cmd: "rm -rf /" }] });
  assert.equal(unknownOp.ok, false);
  assert.match(unknownOp.errors.join(), /使えない操作/);

  const badColumn = validateRecipe({ ...RECIPE, steps: [{ op: "extract", from: "存在しない列", kind: "phone", into: "電話", pick: "first" }] });
  assert.equal(badColumn.ok, false);
  assert.match(badColumn.errors.join(), /存在しません/);

  const redos = validateRecipe({ ...RECIPE, output: { ...RECIPE.output, rules: { 分類: [{ kind: "pattern", pattern: "(a+)+$", label: "x" }] } } });
  assert.equal(redos.ok, false);

  const missingOut = validateRecipe({ ...RECIPE, output: { columns: ["会社名", "作っていない列"], rules: {} } });
  assert.equal(missingOut.ok, false);

  const listRef = validateRecipe({ ...RECIPE, steps: [...RECIPE.steps, { op: "exclude", column: "会社名", listRef: "NG" }] }, { lists: ["別のリスト"] });
  assert.equal(listRef.ok, false);
  assert.match(listRef.errors.join(), /添付されていません/);
});

test("段の繰り上げは 軽い→中→上位 で、上位の上は無い", () => {
  assert.equal(nextTier("light"), "standard");
  assert.equal(nextTier("standard"), "heavy");
  assert.equal(nextTier("heavy"), null);
});

// --- 実行（機械の操作とAIの検品）------------------------------------------------

test("AIが原文に無い値を返したら、空欄にして要確認にする（幻覚ガード）", async () => {
  const recipe = validateRecipe({
    ...RECIPE,
    steps: [{ op: "ai_extract", from: "本文", fields: [{ name: "担当者", kind: "text", description: "担当者名" }] }],
    output: { columns: ["担当者"], rules: {} },
  }).recipe;
  const call = fakeCaller({
    run: async () => ({
      rows: [
        { index: 0, fields: [{ name: "担当者", value: "山田", quote: "担当は山田です" }] },
        { index: 1, fields: [{ name: "担当者", value: "佐藤", quote: "佐藤" }] }, // 原文に無い
      ],
    }),
  });
  const out = await runRecipe(recipe, withSrc([{ 本文: "担当は山田です" }, { 本文: "担当は未定です" }]), { call, fetchPage: noFetch, lists: {} });
  assert.equal(out.rows[0]["担当者"], "山田");
  assert.equal(out.rows[1]["担当者"], "");
  assert.ok(out.issues.some((i) => i.src === 1 && i.severity === "error" && /幻覚/.test(i.reason)));
});

test("名寄せ・NGリスト除外は行を落とし、落とした理由を残す", async () => {
  const recipe = validateRecipe({
    ...RECIPE,
    steps: [
      { op: "dedupe", keys: [{ column: "会社名", kind: "corp" }] },
      { op: "exclude", column: "会社名", listRef: "NG" },
    ],
    output: { columns: ["会社名"], rules: {} },
  }, { lists: ["NG"] }).recipe;
  const rows = withSrc([{ 会社名: "株式会社ソラーレ", 本文: "" }, { 会社名: "ソラーレ", 本文: "" }, { 会社名: "青空商店", 本文: "" }, { 会社名: "（株）山田工業", 本文: "" }]);
  const out = await runRecipe(recipe, rows, { call: fakeCaller({}), fetchPage: noFetch, lists: { NG: ["山田工業"] } });
  assert.deepEqual(out.rows.map((r) => r["会社名"]), ["株式会社ソラーレ", "青空商店"]);
  assert.equal(out.removed.length, 2);
  assert.ok(out.removed.some((r) => /重複/.test(r.reason)));
  assert.ok(out.removed.some((r) => /NG/.test(r.reason)));
});

test("Web調査の値は出典ページを自分で開いて確かめる", async () => {
  const pages = {
    "https://hotel.example/": "ホテル例 公式サイト お電話 03-1111-2222",
    "https://blog.example/": "まとめ記事",
  };
  const fetchPage = async (url) => (pages[url] ? { ok: true, url, text: pages[url], reason: "" } : { ok: false, url, text: "", reason: "HTTP 404" });
  const phone = { name: "電話", kind: "phone", description: "" };
  assert.equal(await verifyLookup(phone, "03-1111-2222", "https://hotel.example/", fetchPage), null);
  assert.equal(await verifyLookup(phone, "0311112222", "https://hotel.example/", fetchPage), null, "表記違いでも同じ番号なら通す");
  assert.equal((await verifyLookup(phone, "03-9999-0000", "https://hotel.example/", fetchPage)).severity, "error");
  assert.equal((await verifyLookup(phone, "03-1111-2222", "https://gone.example/", fetchPage)).severity, "warn", "出典を開けないときは目視へ");
  assert.equal((await verifyLookup(phone, "03-1111-2222", "", fetchPage)).severity, "error", "出典なしは通さない");
  const url = { name: "公式URL", kind: "url", description: "" };
  assert.equal(await verifyLookup(url, "https://hotel.example/", "", fetchPage), null);
  assert.equal((await verifyLookup(url, "https://nothing.example/", "", fetchPage)).severity, "error");
});

// --- 検品と手本の照合 -------------------------------------------------------------

test("合格の基準: AIが原因の要確認が2割超・検品AIの全体指摘は不合格。元データの問題だけなら改修しない", () => {
  const rows = withSrc([{}, {}, {}, {}, {}]);
  const ai = (src) => ({ src, column: "a", reason: "x", severity: "error", fromAi: true });
  const rule = (src) => ({ src, column: "a", reason: "ダミー番号の疑い", severity: "error", fromAi: false });
  assert.equal(summarize(rows, [ai(0)]).pass, true);
  const twoAi = summarize(rows, [ai(0), ai(1)]);
  assert.equal(twoAi.pass, false);
  assert.equal(twoAi.fixable, true);
  assert.deepEqual(twoAi.aiErrorRows, [0, 1]);
  const dataOnly = summarize(rows, [rule(0), rule(1)]);
  assert.equal(dataOnly.pass, true, "元データのダミー番号2件は、手順書の失敗ではない");
  assert.equal(dataOnly.errorRows, 2, "ただし要確認としては数える");
  assert.equal(summarize(rows, [rule(0), rule(1), rule(2)]).pass, false, "半分を超えたら手順の誤りを疑う");
  assert.equal(summarize(rows, []).pass, true);
  assert.equal(summarize(rows, [], true).pass, false);
  assert.equal(summarize(rows, [], true).fixable, true);
});

test("手本との照合は電話・URLの表記ゆれを同じとみなし、落とした行は不一致に数える", () => {
  assert.equal(cellKey("03-1234-5678"), cellKey("0312345678"));
  assert.equal(cellKey("https://Example.com/"), cellKey("https://example.com"));
  const actual = withSrc([{ 電話: "0312345678", 名前: "A" }]);
  const cmp = compareToExpected(actual, [{ 電話: "03-1234-5678", 名前: "A" }, { 電話: "", 名前: "B" }], ["電話", "名前"]);
  assert.equal(cmp.matched, 3);
  assert.equal(cmp.cells, 4);
  assert.equal(cmp.mismatches[0].actual, "（行が出力されていない）");
});

test("出力規則: 必須の空欄と、決められた値以外を要確認にする", () => {
  const recipe = validateRecipe(RECIPE).recipe;
  const issues = checkOutput(recipe, withSrc([{ 会社名: "", 分類: "見積" }, { 会社名: "A", 分類: "雑談" }]));
  assert.ok(issues.some((i) => i.src === 0 && /必須/.test(i.reason)));
  assert.ok(issues.some((i) => i.src === 1 && i.column === "分類"));
});

// --- 振り分け ---------------------------------------------------------------

test("振り分け: 手順書なし→新規、はっきり一致→AIを使わず決定、迷う→AIへ", () => {
  assert.equal(decideByRule(scoreRecipes({ instructions: "何か", headers: ["a"] }, [])).action, "new");
  const recipe = validateRecipe(RECIPE).recipe;
  const clear = scoreRecipes({ instructions: "問い合わせの分類と電話番号", headers: ["会社名", "本文"] }, [recipe]);
  assert.equal(decideByRule(clear).action, "use");
  const vague = scoreRecipes({ instructions: "問い合わせの整理", headers: ["会社名", "本文"] }, [recipe]);
  assert.equal(decideByRule(vague), null, "キーワードが少ないときはAIに聞く");
  const noCols = scoreRecipes({ instructions: "問い合わせの分類と電話番号", headers: ["社名"] }, [recipe]);
  assert.notEqual(decideByRule(noCols)?.action, "use", "入力列が足りないのにそのまま使わない");
});

test("振り分けAIの答え: 列が足りない use は adapt に直し、読めない答えは new", () => {
  const cands = [{ recipeId: "r1", name: "x", score: 0.5, keywordHits: [], missingColumns: ["本文"] }];
  assert.equal(parseRouteResponse({ action: "use", recipeId: "r1", reason: "" }, cands).action, "adapt");
  assert.equal(parseRouteResponse({ action: "use", recipeId: "知らないid", reason: "" }, cands).action, "new");
  assert.equal(parseRouteResponse(null, cands).action, "new");
});

// --- 呼び出し口 ---------------------------------------------------------------

test("CLIの出力: 成功時は structured_output と使用量を読み、上限・ログイン切れを見分ける", () => {
  const ok = readCliOutput(0, JSON.stringify({
    is_error: false, duration_ms: 3321, total_cost_usd: 0.0119, result: '{"phone":"03"}', structured_output: { phone: "03-1234-5678" },
    modelUsage: { "claude-haiku-4-5-20251001": { inputTokens: 937, outputTokens: 258, cacheReadInputTokens: 0, cacheCreationInputTokens: 4823 } },
  }), "", { tier: "light", purpose: "run", model: "haiku", elapsedMs: 4000 });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data, { phone: "03-1234-5678" });
  assert.equal(ok.usage.model, "claude-haiku-4-5-20251001");
  assert.equal(ok.usage.inputTokens, 937);
  assert.equal(ok.usage.cacheTokens, 4823);
  assert.equal(ok.usage.durationMs, 3321);

  const both = readCliOutput(0, JSON.stringify({
    is_error: false, structured_output: {},
    modelUsage: {
      "claude-haiku-4-5-20251001": { inputTokens: 10, outputTokens: 5, costUSD: 0.001 },
      "claude-opus-5-5": { inputTokens: 900, outputTokens: 700, costUSD: 0.05 },
    },
  }), "", { tier: "heavy", purpose: "author", model: "opus", elapsedMs: 1 });
  assert.equal(both.usage.model, "claude-opus-5-5", "裏で呼ばれた軽いモデルではなく、指定したモデルとして記録する");
  assert.equal(both.usage.inputTokens, 910);
  assert.match(both.usage.note, /haiku/);

  const quota = readCliOutput(1, JSON.stringify({ is_error: true, result: "Claude usage limit reached. Your limit will reset at 5pm" }), "", { tier: "light", purpose: "run", model: "haiku", elapsedMs: 1 });
  assert.equal(quota.ok, false);
  assert.equal(quota.quota, true);

  const auth = readCliOutput(1, JSON.stringify({ is_error: true, result: "Invalid API key · Please run /login" }), "", { tier: "light", purpose: "run", model: "haiku", elapsedMs: 1 });
  assert.equal(auth.quota ?? false, false);
  assert.match(auth.error, /setup-token/);

  const missing = readCliOutput(-1, "", "spawn claude ENOENT", { tier: "light", purpose: "run", model: "haiku", elapsedMs: 1 });
  assert.match(missing.error, /見つかりません/);
});

test("CLIの呼び方: --bare を使わず（サブスクが読めない）、モデル指定・ツール制限・権限をつける", () => {
  const args = buildCliArgs({ purpose: "run", tier: "light", prompt: "x", schema: { type: "object" } }, "haiku");
  assert.ok(!args.includes("--bare"));
  assert.ok(args.includes("--safe-mode"));
  assert.equal(args[args.indexOf("--model") + 1], "haiku");
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.equal(args[args.indexOf("--permission-mode") + 1], "dontAsk");
  assert.ok(!args.includes("bypassPermissions"));
  const web = buildCliArgs({ purpose: "run", tier: "light", prompt: "x", schema: {}, web: true }, "haiku");
  assert.equal(web[web.indexOf("--tools") + 1], "WebSearch,WebFetch");
});

test("呼び出し口: 依頼者の資料はGeminiに送らない・回数上限・使用上限で一時停止・Geminiの枠切れはClaudeで続行", async () => {
  const seen = [];
  const claude = async (req) => { seen.push(`claude:${req.override?.model ?? req.tier}`); return { ok: true, data: {}, usage: usage(req) }; };
  const gemini = async (req) => { seen.push("gemini"); return { ok: false, data: null, quota: true, error: "429", usage: usage(req, false) }; };
  const records = [];

  const conf = createCaller({ dataClass: "confidential", record: (u) => records.push(u), maxCalls: 2, claude, gemini });
  await conf({ purpose: "run", tier: "light", prompt: "", schema: {}, override: { provider: "gemini", model: "g" } });
  assert.deepEqual(seen, ["claude:light"], "confidential は Gemini を指定されても Claude に戻す");
  await conf({ purpose: "run", tier: "light", prompt: "", schema: {} });
  const over = await conf({ purpose: "run", tier: "light", prompt: "", schema: {} });
  assert.equal(over.ok, false);
  assert.match(over.error, /上限/);

  seen.length = 0;
  const pub = createCaller({ dataClass: "public", record: (u) => records.push(u), maxCalls: 5, claude, gemini });
  const res = await pub({ purpose: "run", tier: "light", prompt: "", schema: {}, override: { provider: "gemini", model: "g" } });
  assert.equal(res.ok, true);
  assert.deepEqual(seen, ["gemini", "claude:light"]);

  const limited = createCaller({
    dataClass: "public", record: () => {}, maxCalls: 5,
    claude: async (req) => ({ ok: false, data: null, quota: true, error: "usage limit", usage: usage(req, false) }),
  });
  await assert.rejects(limited({ purpose: "run", tier: "light", prompt: "", schema: {} }), QuotaPauseError);
});

// --- ページ取得の安全策 ---------------------------------------------------------

test("社内・ローカルのアドレスには行かない", () => {
  for (const ip of ["127.0.0.1", "10.0.0.5", "172.20.1.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  assert.equal(isPrivateAddress("93.184.216.34"), false);
});

test("ページ取得: robots.txt の禁止・内側への転送を守り、本文はテキストにする", async () => {
  const responses = {
    "https://ok.example/robots.txt": new Response("User-agent: *\nDisallow: /private", { status: 200 }),
    "https://ok.example/page": new Response("<html><body><p>電話 03-1111-2222</p><script>x</script></body></html>", { status: 200, headers: { "content-type": "text/html" } }),
    "https://ok.example/private/a": new Response("secret", { status: 200 }),
    "https://ok.example/jump": new Response("", { status: 302, headers: { location: "http://intranet.example/" } }),
    "https://none.example/robots.txt": new Response("", { status: 404 }),
    "https://none.example/": new Response("hello", { status: 200, headers: { "content-type": "text/plain" } }),
  };
  const fetchImpl = async (url) => responses[url]?.clone() ?? new Response("", { status: 500 });
  const resolve = async (host) => (host === "intranet.example" ? ["10.1.2.3"] : ["93.184.216.34"]);
  const fetchPage = createPageFetcher({ fetchImpl, resolve, sleep: async () => {} });

  const page = await fetchPage("https://ok.example/page");
  assert.equal(page.ok, true);
  assert.match(page.text, /03-1111-2222/);
  assert.doesNotMatch(page.text, /<p>/);
  assert.equal((await fetchPage("https://ok.example/private/a")).ok, false);
  const jump = await fetchPage("https://ok.example/jump");
  assert.equal(jump.ok, false);
  assert.match(jump.reason, /社内・ローカル/);
  assert.equal((await fetchPage("https://none.example/")).ok, true, "robots.txt が無い（404）なら取得してよい");
  assert.equal((await fetchPage("file:///etc/passwd")).ok, false);
  assert.equal((await fetchPage("http://localhost:3000/")).ok, false);
});

// --- パイプライン全体 ---------------------------------------------------------------

function authorHandler() {
  return async (req) => {
    const table = parseTable(CSV);
    return { feasible: true, reason: "", recipe: RECIPE, expected: expectedFor(table.rows.slice(0, 3)) };
  };
}

test("新しい型の依頼: 上位モデルが手順書と手本を作り、手本で試験して採用し、承認待ちまで進む", async () => {
  const store = memoryStore();
  const call = fakeCaller({ author: authorHandler(), run: async (req) => classifyAnswer(req.prompt, false), review: okReview });
  const progress = [];
  const result = await processJob(job(), { call, fetchPage: noFetch, recipes: store, progress: (p) => progress.push(p) });

  assert.equal(result.status, "awaiting_approval");
  assert.equal(store.all.length, 1, "手順書が保存される");
  assert.equal(result.patch.report.recipe.origin, "new");
  assert.equal(result.patch.report.test.accuracy, 1);
  assert.equal(result.patch.qualityPass, true);
  const out = parseTable(result.patch.outputCsv);
  assert.deepEqual(out.headers, ["会社名", "電話", "分類"]);
  assert.equal(out.rows[0]["会社名"], "A商事", "全角の表記ゆれがそろう");
  assert.equal(out.rows[0]["電話"], "03-1234-5678", "電話は機械で抜く（AIを使わない）");
  assert.equal(out.rows[1]["分類"], "苦情");
  const author = call.calls.find((c) => c.purpose === "author");
  assert.equal(author.tier, "heavy");
  assert.ok(call.calls.filter((c) => c.purpose === "run").every((c) => c.tier === "light"), "作業は軽いモデル");
  assert.equal(call.calls.find((c) => c.purpose === "review").tier, "standard", "検品は別の呼び出しで中くらいのモデル");
  assert.deepEqual(result.patch.outputSrc, [0, 1, 2, 3, 4]);
});

test("同じ型の2件目: 機械の振り分けで既存の手順書を使い、上位モデルを呼ばない", async () => {
  const store = memoryStore();
  const first = fakeCaller({ author: authorHandler(), run: async (req) => classifyAnswer(req.prompt, false), review: okReview });
  await processJob(job(), { call: first, fetchPage: noFetch, recipes: store, progress: () => {} });

  const second = fakeCaller({ run: async (req) => classifyAnswer(req.prompt, false), review: okReview });
  const result = await processJob(job({ id: "job-2", instructions: "今月分の問い合わせ一覧です。分類と電話番号をお願いします" }), {
    call: second, fetchPage: noFetch, recipes: store, progress: () => {},
  });
  assert.equal(result.status, "awaiting_approval");
  assert.equal(result.patch.route.action, "use");
  assert.equal(result.patch.route.by, "rule");
  assert.ok(!second.calls.some((c) => c.purpose === "author" || c.purpose === "route" || c.tier === "heavy"), "上位モデルも振り分けAIも使わない");
});

test("軽いモデルで要確認が多いとき、その行だけ1段上のモデルでやり直して合格させる", async () => {
  const store = memoryStore();
  const call = fakeCaller({
    author: authorHandler(),
    run: async (req) => classifyAnswer(req.prompt, req.tier === "light"),
    review: okReview,
  });
  const result = await processJob(job(), { call, fetchPage: noFetch, recipes: store, progress: () => {} });
  assert.equal(result.status, "awaiting_approval");
  assert.equal(result.patch.qualityPass, true);
  const attempts = result.patch.report.attempts;
  assert.equal(attempts[0].phase, "run");
  assert.ok(attempts[0].errorRate > MAX_ERROR_ROW_RATE);
  assert.equal(attempts[1].phase, "rerun_rows");
  assert.equal(attempts[1].tier, "standard");
  assert.equal(attempts[1].rows, 2, "やり直すのは落ちた2行だけ");
  const out = parseTable(result.patch.outputCsv);
  assert.equal(out.rows[4]["分類"], "見積");
});

test("元データにダミー番号があっても、手順書の改修（上位モデル）は呼ばず、要確認を付けて承認待ちにする", async () => {
  const withPhoneRule = { ...RECIPE, output: { ...RECIPE.output, rules: { ...RECIPE.output.rules, 電話: [{ kind: "phone" }] } } };
  const table = parseTable(CSV);
  const call = fakeCaller({
    author: async () => ({ feasible: true, reason: "", recipe: withPhoneRule, expected: expectedFor(table.rows.slice(0, 3)) }),
    run: async (req) => classifyAnswer(req.prompt, false),
    review: okReview,
  });
  const result = await processJob(job(), { call, fetchPage: noFetch, recipes: memoryStore(), progress: () => {} });
  assert.equal(result.status, "awaiting_approval");
  assert.equal(result.patch.qualityPass, true);
  assert.ok(result.patch.issues.some((i) => i.src === 0 && /ダミー/.test(i.reason)), "03-1234-5678 はダミーの疑いとして人に見せる");
  assert.equal(call.calls.filter((c) => c.purpose === "fix").length, 0);
});

test("検品AIへの抜粋は行番号順で、落とした行とその理由も見せる", async () => {
  const { pickReviewSample, buildReviewPrompt } = await import("../../dist-test/jobs/review.js");
  const rows = withSrc([{ a: "1" }, { a: "2" }, { a: "3" }]);
  const sample = pickReviewSample(rows, [{ src: 0, column: "a", reason: "x", severity: "error", fromAi: false }]);
  assert.deepEqual(sample.map((r) => r._src), ["0", "1", "2"]);
  const prompt = buildReviewPrompt({ instructions: "x" }, { name: "n", summary: "", output: { columns: ["a"], rules: {} } }, sample, 3, 1, [{ src: 3, reason: "重複" }]);
  assert.match(prompt, /src=3: 重複/);
  assert.match(prompt, /番号の飛びや並びは問題ではありません/);
});

test("自動では作れない依頼は、理由つきで人に返す（作ったふりをしない）", async () => {
  const call = fakeCaller({ author: async () => ({ feasible: false, reason: "スキャン画像の読み取りが必要", recipe: {}, expected: [] }) });
  const result = await processJob(job(), { call, fetchPage: noFetch, recipes: memoryStore(), progress: () => {} });
  assert.equal(result.status, "needs_human");
  assert.match(result.patch.note, /スキャン画像/);
});

test("手本との一致率が直しても基準に届かなければ、手順書を採用しない", async () => {
  const table = parseTable(CSV);
  const wrong = expectedFor(table.rows.slice(0, 3)).map((r) => ({ ...r, 分類: "苦情" }));
  const store = memoryStore();
  const call = fakeCaller({
    author: async () => ({ feasible: true, reason: "", recipe: RECIPE, expected: wrong }),
    fix: async () => ({ feasible: true, reason: "", recipe: RECIPE, expectedCorrections: [] }),
    run: async (req) => classifyAnswer(req.prompt, false),
    review: okReview,
  });
  const result = await processJob(job(), { call, fetchPage: noFetch, recipes: store, progress: () => {} });
  assert.equal(result.status, "needs_human");
  assert.match(result.patch.note, /一致率/);
  assert.equal(store.all.length, 0, "試験に落ちた手順書は保存しない");
  assert.equal(call.calls.filter((c) => c.purpose === "fix").length, 2, "改修は2回まで");
});

test("形の壊れた手順書は1回だけ直させ、直れば使う", async () => {
  const broken = { ...RECIPE, steps: [...RECIPE.steps, { op: "delete_everything" }] };
  const table = parseTable(CSV);
  const call = fakeCaller({
    author: async () => ({ feasible: true, reason: "", recipe: broken, expected: expectedFor(table.rows.slice(0, 3)) }),
    fix: async (req) => {
      assert.match(req.prompt, /使えない操作/, "誤りの一覧を見せて直させる");
      return { feasible: true, reason: "", recipe: RECIPE, expectedCorrections: [] };
    },
    run: async (req) => classifyAnswer(req.prompt, false),
    review: okReview,
  });
  const result = await processJob(job(), { call, fetchPage: noFetch, recipes: memoryStore(), progress: () => {} });
  assert.equal(result.status, "awaiting_approval");
});

test("入力が空なら、AIを1回も呼ばずに人に返す", async () => {
  const call = fakeCaller({});
  const result = await processJob(job({ inputCsv: "会社名,本文\n" }), { call, fetchPage: noFetch, recipes: memoryStore(), progress: () => {} });
  assert.equal(result.status, "needs_human");
  assert.equal(call.calls.length, 0);
});

test("使用上限に当たったら、処理を止めて上に知らせる（勝手に続けない）", async () => {
  const caller = createCaller({
    dataClass: "confidential", record: () => {}, maxCalls: 50,
    claude: async (req) => ({ ok: false, data: null, quota: true, error: "usage limit reached", usage: usage(req, false) }),
  });
  await assert.rejects(processJob(job(), { call: caller, fetchPage: noFetch, recipes: memoryStore(), progress: () => {} }), QuotaPauseError);
});

// --- モデル比較（並行） ---------------------------------------------------------------

test("比較の候補: 依頼者の資料から作った手本や、Web調査を含む手順書では Gemini を候補にしない", () => {
  const base = validateRecipe({ ...RECIPE, testSet: { input: [{ 会社名: "a", 本文: "b" }], expected: [{ 会社名: "a", 電話: "", 分類: "その他" }], compareColumns: [], source: "model", dataClass: "public" } }).recipe;
  const opts = { geminiAvailable: true, geminiModel: "g", lightModel: "haiku", standardModel: "sonnet" };
  assert.equal(candidatesFor(base, opts)[0].provider, "gemini");
  assert.ok(!candidatesFor({ ...base, testSet: { ...base.testSet, dataClass: "confidential" } }, opts).some((c) => c.provider === "gemini"));
  const lookup = { ...base, steps: [...base.steps, { op: "ai_lookup", query: "{{会社名}}", fields: [{ name: "URL", kind: "url", description: "" }] }] };
  assert.ok(!candidatesFor(lookup, opts).some((c) => c.provider === "gemini"));
});

test("比較: 安い順に試し、手本と95%以上一致した最初のモデルに切り替える", async () => {
  const table = parseTable(CSV);
  const recipe = validateRecipe({
    ...RECIPE,
    testSet: { input: table.rows.slice(0, 4), expected: expectedFor(table.rows.slice(0, 4)), compareColumns: [], source: "human", dataClass: "public" },
  }).recipe;
  const call = fakeCaller({ run: async (req) => classifyAnswer(req.prompt, req.override?.model === "cheap") });
  const result = await compareModels(recipe, { call, fetchPage: noFetch }, [
    { provider: "gemini", model: "cheap", label: "" },
    { provider: "claude", model: "haiku", label: "" },
    { provider: "claude", model: "sonnet", label: "" },
  ]);
  assert.deepEqual(result.preferred, { provider: "claude", model: "haiku" });
  assert.equal(result.trials.length, 2, "基準を満たしたら残りは試さない");
  assert.ok(result.trials[0].accuracy < 0.95);
});

// --- GitHubへの保存（library/） -----------------------------------------------------

test("GitHubに残す手順書から、依頼者の資料で作った手本を外し、使用量の記録にはエラー文を書かない", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const lib = await import("../../dist-test/jobs/library.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "joblib-"));
  process.env.JOB_LIBRARY_DIR = dir;
  try {
    const ts = (dataClass) => ({ input: [{ 会社名: "秘密商事", 本文: "x" }], expected: [{ 会社名: "秘密商事", 電話: "", 分類: "その他" }], compareColumns: [], source: "human", dataClass });
    const conf = validateRecipe({ ...RECIPE, id: "conf-recipe", testSet: ts("confidential") }).recipe;
    const pub = validateRecipe({ ...RECIPE, id: "pub-recipe", testSet: ts("public") }).recipe;
    lib.exportRecipe(conf);
    lib.exportRecipe(pub);
    const saved = fs.readFileSync(path.join(dir, "recipes", "conf-recipe.json"), "utf8");
    assert.doesNotMatch(saved, /秘密商事/, "依頼者の資料から作った手本はGitHubに出さない");
    assert.equal(JSON.parse(saved).steps.length, 3, "手順そのものは残す");
    assert.match(fs.readFileSync(path.join(dir, "recipes", "pub-recipe.json"), "utf8"), /秘密商事/, "公開情報の手本は残す");
    assert.equal(lib.readLibraryRecipes().length, 2);

    lib.appendUsage({ provider: "claude", model: "haiku", tier: "light", purpose: "run", ok: false, durationMs: 1, inputTokens: 1, outputTokens: 1, cacheTokens: 0, costUsd: 0, note: "エラー: 秘密商事の…", at: "2026-01-01T00:00:00Z", jobId: "j", recipeId: "r" });
    assert.doesNotMatch(fs.readFileSync(path.join(dir, "usage.jsonl"), "utf8"), /秘密商事/);
    assert.equal(lib.readLibraryUsage()[0].model, "haiku");
  } finally {
    delete process.env.JOB_LIBRARY_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
