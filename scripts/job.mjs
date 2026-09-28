#!/usr/bin/env node
/**
 * 仕事ラインをコマンド1つで回す（画面もサーバーも立てない）。
 *
 * スマホの Claude アプリで「依頼を貼る専用の会話」から使う前提。
 * 会話の相手（Claude）が何度も動くと、その分だけ使用量が増えるので、
 * 1件の処理は「ファイルを置く → このコマンドを1回 → 結果を送る」で終わるようにしてある。
 *
 *   node scripts/job.mjs run --title "件名" --instructions 依頼.txt --input 入力.xlsx（または .csv） \
 *       [--sheet シート名] [--list NGリスト=ng.txt または ng.xlsx] [--public] [--deadline 2026-10-10] [--price 20000] [--push]
 *   node scripts/job.mjs approve [id|last] [--push]
 *   node scripts/job.mjs reject  [id|last] --note "理由" [--push]
 *   node scripts/job.mjs redo    [id|last] --note "直す点" [--push]
 *   node scripts/job.mjs resume  [id|last] [--push]     # 使用上限で止まった依頼の続き
 *   node scripts/job.mjs status
 *   node scripts/job.mjs usage
 *
 *   node scripts/job.mjs judge --text 募集文.txt [--title "件名"] [--url URL] [--budget 20000] [--push]
 *   node scripts/job.mjs lead [id|last] applied|won|lost|archived   # 応募した・受注した・落ちた・やめた
 *   node scripts/job.mjs profile --file 経歴.txt [--push]            # 提案文に使う経歴を登録
 *
 * --push: 手順書と使用量の記録（library/ だけ）を GitHub に保存する。
 *         依頼者のデータ（入力・納品物）は outbox/ と data/ に置き、どちらもコミットしない。
 *         リポジトリが公開設定なら保存しない（手順書や経歴を世界に公開しないため）。
 *
 * AIはサブスクの Claude を使う（HUSTLE_AI_PROVIDER=claude）。
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist-e2e");

// クラウドの作業場所では外への通信がプロキシ経由。Node の fetch は既定でプロキシを使わないので、
// 使うように設定して自分を起動し直す（そうしないと一部のサイトとGitHubのAPIに届かない）。
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && process.env.NODE_USE_ENV_PROXY !== "1") {
  const r = spawnSync(process.execPath, ["--no-warnings", ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
  });
  process.exit(r.status ?? 1);
}

// 開発用の会話で直した手順・修正を、専用の会話にも届ける。作業の前に GitHub の最新を取り込む
// （取り込めなくても作業は続ける。JOB_AUTO_PULL=0 で止められる）
if (process.env.JOB_AUTO_PULL !== "0" && fs.existsSync(path.join(ROOT, ".git"))) {
  const head = () => spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const before = head();
  spawnSync("git", ["pull", "--ff-only", "--quiet"], { cwd: ROOT, encoding: "utf8", timeout: 30_000 });
  if (before && head() !== before) {
    console.log("最新の手順・修正を取り込みました（docs/JOB-SESSION.md が変わっていれば読み直してください）");
  }
}

process.env.APP_DATA_DIR ||= path.join(ROOT, "data");
process.env.JOB_LIBRARY_DIR ||= path.join(ROOT, "library");
process.env.HUSTLE_AI_PROVIDER ||= "claude";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};
const opts = (name) => argv.flatMap((a, i) => (a === `--${name}` && i + 1 < argv.length ? [argv[i + 1]] : []));
// 依頼のid（または last）はコマンドの直後に書く
const positional = argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined;

function die(message) {
  console.error(`エラー: ${message}`);
  process.exit(1);
}

// --- 準備（初回だけ時間がかかる）--------------------------------------------

function ensureDeps() {
  if (fs.existsSync(path.join(ROOT, "node_modules", "better-sqlite3"))) return;
  console.log("準備: 部品を入れています（初回だけ1〜2分）…");
  const r = spawnSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) die(`npm ci に失敗しました\n${(r.stderr || r.stdout).slice(-2000)}`);
}

function newestMtime(dir) {
  let newest = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) newest = Math.max(newest, newestMtime(p));
    else if (e.name.endsWith(".ts")) newest = Math.max(newest, fs.statSync(p).mtimeMs);
  }
  return newest;
}

function ensureBuild() {
  const marker = path.join(DIST, "lib", "hustle", "jobs", "worker.js");
  if (fs.existsSync(marker) && fs.statSync(marker).mtimeMs >= newestMtime(path.join(ROOT, "src", "lib"))) return;
  console.log("準備: コンパイルしています…");
  const r = spawnSync("npx", ["tsc", "-p", "tsconfig.e2e.json"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) die(`コンパイルに失敗しました\n${(r.stdout || r.stderr).slice(-2000)}`);
}

ensureDeps();
ensureBuild();

// コンパイル後も "@/lib/..." のまま残るので、require を差し替えて解決する（E2Eテストと同じ方法）
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) return original.call(this, path.join(DIST, request.slice(2)), ...rest);
  return original.call(this, request, ...rest);
};
const require_ = Module.createRequire(import.meta.url);
const jobsDb = require_(path.join(DIST, "lib/hustle/jobs/db.js"));
const worker = require_(path.join(DIST, "lib/hustle/jobs/worker.js"));
const { JOB_STATUS_LABELS } = require_(path.join(DIST, "lib/hustle/jobs/pipeline.js"));
const judge = require_(path.join(DIST, "lib/hustle/jobs/judge.js"));
const xlsx = require_(path.join(DIST, "lib/hustle/dataops/xlsx.js"));
const { toCsvText } = require_(path.join(DIST, "lib/hustle/dataops/table.js"));

/** 入力の表を読む。Excel（.xlsx）ならシートを選んでCSVにする。 */
function readTableFile(file, sheetWanted) {
  const buf = fs.readFileSync(path.resolve(file));
  if (!xlsx.looksLikeXlsx(buf)) {
    if (/\.xls$/i.test(file)) die("古い形式の Excel（.xls）は読めません。Excel で .xlsx か CSV として保存し直してください");
    return { csv: buf.toString("utf8").replace(/^\uFEFF/, ""), note: "" };
  }
  let book;
  try {
    book = xlsx.readXlsx(buf);
  } catch (e) {
    die(`Excelを読めませんでした: ${e.message}`);
  }
  const filled = book.sheets.filter((s) => s.rows.some((r) => r.some((v) => v.trim())));
  let sheet;
  if (sheetWanted) {
    sheet = book.sheets.find((s) => s.name === sheetWanted) ?? book.sheets[Number(sheetWanted) - 1];
    if (!sheet) die(`シート「${sheetWanted}」がありません（あるのは: ${book.sheets.map((s) => s.name).join("、")}）`);
  } else {
    sheet = filled[0] ?? book.sheets[0];
  }
  const table = xlsx.sheetToTable(sheet);
  if (table.rows.length === 0) die(`シート「${sheet.name}」に表がありません`);
  const others = filled.filter((s) => s !== sheet).map((s) => s.name);
  const note =
    `Excelのシート「${sheet.name}」から ${table.rows.length}行を読みました（見出し: ${table.headers.join(" / ")}）` +
    (others.length ? `。ほかのシート: ${others.join("、")}（使うなら --sheet で指定）` : "");
  return { csv: toCsvText(table.rows, table.headers), note };
}

const LIST_HEADERS = /^(会社名|社名|企業名|法人名|名称|名前|氏名|店舗名|施設名|屋号|NG|NGリスト|除外|除外リスト|既存|既存リスト|リスト)$/i;

/** NGリストなどを読む。テキストは1行1件、Excelは最初のシートの最初の列（見出しらしい1行目は除く）。 */
function readListFile(file) {
  const buf = fs.readFileSync(path.resolve(file));
  if (!xlsx.looksLikeXlsx(buf)) {
    return buf.toString("utf8").replace(/^\uFEFF/, "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  const book = xlsx.readXlsx(buf);
  const sheet = book.sheets.find((s) => s.rows.some((r) => r.some((v) => v.trim())));
  const values = (sheet?.rows ?? []).map((r) => (r[0] ?? "").trim()).filter(Boolean);
  return values.length > 0 && LIST_HEADERS.test(values[0]) ? values.slice(1) : values;
}
const agentDb = require_(path.join(DIST, "lib/hustle/agent/db.js"));
const hustleDb = require_(path.join(DIST, "lib/hustle/db.js"));
const repo = require_(path.join(DIST, "lib/hustle/repo.js"));
const { emptyProfile } = require_(path.join(DIST, "lib/hustle/types.js"));

// 経歴（提案文に使う）は library/profile.json に控えてある。作業場所が作り直されたら読み戻す
const PROFILE_FILE = path.join(process.env.JOB_LIBRARY_DIR, "profile.json");
if (!hustleDb.readProfile() && fs.existsSync(PROFILE_FILE)) {
  try {
    repo.saveProfile({ ...emptyProfile, ...JSON.parse(fs.readFileSync(PROFILE_FILE, "utf8")) });
  } catch {
    /* 壊れていたら読まない。提案文は経歴の箇所を【要確認】で残す */
  }
}

// --- 表示 ---------------------------------------------------------------------

const ORIGIN = { existing: "既存の手順書をそのまま使用", new: "新しく作った", adapted: "既存を直して使用", fixed: "改修した" };
const PURPOSE = { route: "振り分け", author: "手順書づくり", fix: "手順書の改修", run: "作業", review: "検品", compare: "モデル比較" };

function shortModel(m) {
  return String(m).replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

function writeOutbox(job) {
  if (!job.outputCsv) return null;
  const dir = path.join(ROOT, "outbox", `${job.createdAt.slice(0, 10)}-${job.id.slice(0, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "納品.xlsx"), worker.outputXlsx(job, false));
  fs.writeFileSync(path.join(dir, "確認メモ付き.xlsx"), worker.outputXlsx(job, true));
  fs.writeFileSync(path.join(dir, "納品.csv"), job.outputCsv);
  fs.writeFileSync(path.join(dir, "確認メモ付き.csv"), worker.outputWithIssuesCsv(job));
  return dir;
}

function report(job) {
  const lines = [`【${job.title}】 ${JOB_STATUS_LABELS[job.status] ?? job.status}（id: ${job.id.slice(0, 8)}）`];
  lines.push(job.error ? `エラー: ${job.error}` : job.note);
  const r = job.report;
  if (r) {
    lines.push(`手順書: ${r.recipe.name}（第${r.recipe.version}版・${ORIGIN[r.recipe.origin] ?? r.recipe.origin}）`);
    if (r.test) lines.push(`手本との一致率: ${Math.round(r.test.accuracy * 100)}%`);
    lines.push(
      `入力 ${r.inputRows}行 → 出力 ${r.outputRows}行（除外 ${job.removed.length}行）／要確認 ${r.quality.errorRows}行・注意 ${r.quality.warnRows}行` +
        `／品質基準: ${r.quality.pass ? "合格" : "未達"}`
    );
    if (r.systemic) lines.push(`検品AIの指摘: ${r.systemic}`);
    if (r.expectedCorrections?.length) lines.push(`AIが手本を訂正（要確認）: ${r.expectedCorrections.map((c) => `${c.column}→${c.value}`).join(" / ")}`);
  }
  const usage = jobsDb.usageForJob(job.id);
  if (usage.length) {
    const cost = usage.reduce((a, u) => a + u.costUsd, 0);
    lines.push(
      `使ったAI: ${usage.map((u) => `${PURPOSE[u.purpose] ?? u.purpose} ${shortModel(u.model)} ${u.calls}回 ${u.minutes}分`).join(" / ")}` +
        `（API換算 $${cost.toFixed(3)}。サブスクでは請求されない）`
    );
  }
  const dir = writeOutbox(job);
  if (dir) {
    const rel = (f) => path.relative(ROOT, path.join(dir, f));
    lines.push(`納品用（Excel）: ${rel("納品.xlsx")}　／ CSVが要るとき: ${rel("納品.csv")}`);
    lines.push(`確認メモ付き（要確認の行は赤）: ${rel("確認メモ付き.xlsx")}`);
  }
  if (job.status === "awaiting_approval") lines.push("次: 承認なら approve、直すなら redo --note \"直す点\"、出さないなら reject");
  if (job.status === "waiting_quota") lines.push(`次: ${job.retryAt ? new Date(job.retryAt).toLocaleString("ja-JP") : "しばらく"} 以降に resume`);
  console.log(lines.join("\n"));
}

const VERDICT = { proceed: "応募してよい", verify_first: "確認してから応募", reject: "見送り", unknown: "判定できず" };
const KIND = { proposal: "提案文", outreach: "単価交渉の文面", question: "応募前に確認すること", warning: "危険の通知" };

function reportJudge(r, started) {
  const t = r.lead.triage ?? {};
  const lines = [`【案件判定】${r.lead.title}（id: ${r.lead.id.slice(0, 8)}）`];
  lines.push(`結論: ${VERDICT[r.lead.verdict] ?? r.lead.verdict}${r.escalated ? "（ルールで決めきれず、Claudeが判定）" : ""}`);
  if (t.reason) lines.push(`理由: ${t.reason}`);
  if (t.hourly) lines.push(`手取り時給: ${t.hourly.low.toLocaleString()}〜${t.hourly.high.toLocaleString()}円（手数料を引いた後）`);
  else lines.push("手取り時給: 判定できていません（報酬か作業量が読めない）");
  if (t.yourTime?.highHours) lines.push(`あなたが手を動かす時間: ${t.yourTime.lowHours}〜${t.yourTime.highHours}時間`);
  if (t.estimate?.highHours) lines.push(`仕事全体の作業量: ${t.estimate.lowHours}〜${t.estimate.highHours}時間`);
  if (t.competition?.note) lines.push(`競争: ${t.competition.note}`);
  if (t.risks?.length) lines.push(`送る前に詰めること:\n${t.risks.map((x) => `・${x}`).join("\n")}`);
  if (r.note) lines.push(r.note);
  lines.push(
    r.automation
      ? `仕事ライン: 手順書「${r.automation.name}」が使えそうです（一致: ${r.automation.hits.join("・")}）。受注したら同じ型として自動で処理できる見込み`
      : "仕事ライン: まだこの型の手順書はありません（受注したら、1件目は上位モデルが手順書を作ります）"
  );

  const dir = path.join(ROOT, "outbox", `judge-${started.slice(0, 10)}-${r.lead.id.slice(0, 8)}`);
  for (const item of r.items) {
    const label = KIND[item.kind] ?? item.kind;
    const body = item.kind === "proposal" ? judge.proposalBody(item) : item.body.trim();
    lines.push("", `--- ${label} ---`, body);
    if (item.kind === "proposal" || item.kind === "outreach") {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${label}.txt`), `${body}\n`);
    }
  }
  if (!r.items.some((i) => i.kind === "proposal") && r.lead.verdict !== "reject") {
    lines.push("", "（提案文は出ていません。判定の理由を見て、確認してから進めてください）");
  }
  if (!hustleDb.readProfile()?.background) {
    lines.push("", "※ 経歴が未登録のため、提案文の経歴の箇所は【要確認】のままです（profile で登録できます）");
  }
  const usage = jobsDb.usageSince(started);
  if (usage.length) {
    const cost = usage.reduce((a, u) => a + u.costUsd, 0);
    lines.push("", `使ったAI: ${usage.map((u) => `${shortModel(u.model)} ${u.calls}回 ${u.minutes}分`).join(" / ")}（API換算 $${cost.toFixed(3)}）`);
  }
  if (fs.existsSync(dir)) lines.push(`保存先: ${path.relative(ROOT, dir)}`);
  lines.push("次: 送ったら lead last applied、受注したら lead last won。承認しても送信はされません（応募は各サイトで）");
  console.log(lines.join("\n"));
}

function pickJob(ref, wanted) {
  if (ref && ref !== "last") {
    const found = jobsDb.readJobs(200).find((j) => j.id === ref || j.id.startsWith(ref));
    if (!found) die(`依頼 ${ref} が見つかりません`);
    return found;
  }
  const jobs = jobsDb.readJobs(50);
  const found = jobs.find((j) => wanted.includes(j.status)) ?? null;
  if (!found) die(`対象の依頼がありません（${wanted.map((s) => JOB_STATUS_LABELS[s]).join("・")}）`);
  return found;
}

// --- GitHubへの保存（library/ だけ）----------------------------------------------

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * リポジトリが公開設定か。GitHubのAPIを認証なしで引き、見えれば公開・404なら非公開。
 * 分からないときは null（保存しない側に倒す）。
 */
async function repoIsPublic() {
  let slug = "";
  try {
    const m = git(["remote", "get-url", "origin"]).match(/([^/:]+)\/([^/]+?)(?:\.git)?$/);
    if (m) slug = `${m[1]}/${m[2]}`;
  } catch {
    return null;
  }
  if (!slug) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}`, {
      headers: { "User-Agent": "app526-job", Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return false;
    if (!res.ok) return null;
    const body = await res.json();
    return body.private === false;
  } catch {
    return null;
  }
}

async function pushLibrary() {
  const lib = path.relative(ROOT, process.env.JOB_LIBRARY_DIR);
  if (!fs.existsSync(path.join(ROOT, lib))) return;
  if (process.env.JOB_LIBRARY_ALLOW_PUBLIC !== "1") {
    const pub = await repoIsPublic();
    if (pub !== false) {
      console.log(
        pub
          ? "GitHub: このリポジトリは公開設定なので、手順書と経歴は保存しませんでした（誰でも見られるため）。" +
              "GitHubのリポジトリ設定で非公開にすると、次から保存されます。今の作業場所の中には残っています。"
          : "GitHub: リポジトリが非公開か確認できなかったので、保存しませんでした（今の作業場所の中には残っています）。"
      );
      return;
    }
  }
  git(["add", "--", lib]);
  const staged = spawnSync("git", ["diff", "--cached", "--quiet", "--", lib], { cwd: ROOT });
  if (staged.status === 0) {
    console.log("GitHub: 手順書・記録に変更なし");
    return;
  }
  git(["commit", "-m", "chore(library): 仕事ラインの手順書と使用量の記録を更新", "--", lib]);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  for (let i = 0; i < 4; i++) {
    try {
      git(["pull", "--no-rebase", "--no-edit", "origin", branch]);
      git(["push", "-u", "origin", branch]);
      console.log(`GitHub: 手順書と使用量の記録を保存しました（${branch}）`);
      return;
    } catch (e) {
      if (i === 3) {
        console.error(`GitHub への保存に失敗しました: ${String(e.stderr || e.message).slice(0, 500)}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
}

// --- コマンド -------------------------------------------------------------------

async function main() {
  switch (cmd) {
    case "run": {
      const title = opt("title");
      const instructionsFile = opt("instructions");
      const inputFile = opt("input") ?? opt("csv");
      if (!title || !instructionsFile || !inputFile) die("--title と --instructions（依頼文のファイル）と --input（入力の表。CSV か Excel）が要ります");
      const read = (f) => fs.readFileSync(path.resolve(f), "utf8").replace(/^\uFEFF/, "");
      const lists = {};
      for (const spec of opts("list")) {
        const eq = spec.indexOf("=");
        if (eq <= 0) die(`--list は 名前=ファイル の形で指定してください（${spec}）`);
        lists[spec.slice(0, eq)] = readListFile(spec.slice(eq + 1));
      }
      const input = readTableFile(inputFile, opt("sheet"));
      if (input.note) console.log(input.note);
      const job = jobsDb.createJob({
        title,
        instructions: read(instructionsFile),
        inputCsv: input.csv,
        lists,
        dataClass: flag("public") ? "public" : "confidential",
        deadline: /^\d{4}-\d{2}-\d{2}$/.test(opt("deadline") ?? "") ? opt("deadline") : "",
        priceJpy: Math.max(0, Number(opt("price") ?? 0) || 0),
      });
      console.log(`処理を始めます（id: ${job.id.slice(0, 8)}）。新しい型なら数分かかります。`);
      report(await worker.runJobNow(job.id));
      break;
    }
    case "approve":
    case "reject": {
      const job = pickJob(positional, ["awaiting_approval"]);
      worker.decideJob(job.id, cmd === "approve" ? "approved" : "rejected", opt("note") ?? "");
      report(jobsDb.readJob(job.id));
      break;
    }
    case "redo": {
      const note = opt("note");
      if (!note) die("--note で直す点を書いてください");
      const job = pickJob(positional, ["awaiting_approval", "rejected", "needs_human"]);
      worker.decideJob(job.id, "redo", note, { kick: false });
      console.log("直す点を反映して作り直します。");
      report(await worker.runJobNow(job.id));
      break;
    }
    case "resume": {
      const job = pickJob(positional, ["waiting_quota", "queued"]);
      report(await worker.runJobNow(job.id));
      break;
    }
    case "status": {
      const jobs = jobsDb.readJobs(10);
      if (jobs.length === 0) console.log("依頼はまだありません");
      for (const j of jobs) console.log(`${j.id.slice(0, 8)}  ${(JOB_STATUS_LABELS[j.status] ?? j.status).padEnd(8)}  ${j.title}  — ${j.error || j.note}`);
      const recipes = jobsDb.listRecipes();
      console.log(`手順書: ${recipes.length}件${recipes.length ? `（${recipes.map((r) => r.name).join("、")}）` : ""}`);
      break;
    }
    case "usage": {
      const week = jobsDb.usageSince(new Date(Date.now() - 7 * 86_400_000).toISOString());
      if (week.length === 0) console.log("直近7日のAI使用はありません");
      for (const u of week) {
        console.log(`${shortModel(u.model).padEnd(16)} ${String(u.calls).padStart(4)}回 ${String(u.minutes).padStart(6)}分  入力${(u.inputTokens + u.cacheTokens).toLocaleString()} 出力${u.outputTokens.toLocaleString()}  API換算$${u.costUsd.toFixed(3)}`);
      }
      console.log("（サブスクの週の上限は数値が公開されていないため、残り何%かは出せません）");
      break;
    }
    case "judge": {
      const textFile = opt("text");
      if (!textFile) die("--text（募集文のファイル）が要ります");
      const text = fs.readFileSync(path.resolve(textFile), "utf8").replace(/^\uFEFF/, "");
      const started = new Date().toISOString();
      console.log("案件を判定しています…");
      const budget = Number(opt("budget"));
      const r = await judge.judgeLead({ text, title: opt("title"), url: opt("url"), budgetJpy: Number.isFinite(budget) && budget > 0 ? budget : null });
      reportJudge(r, started);
      break;
    }
    case "lead": {
      const target = argv.slice(1).find((a) => ["applied", "won", "lost", "archived"].includes(a));
      if (!target) die("applied（応募した）/ won（受注した）/ lost（落ちた）/ archived（やめた）のどれかを指定してください");
      const ref = positional && positional !== target ? positional : "last";
      const leads = agentDb.readLeads(undefined, 200);
      const lead = ref === "last" ? leads.find((l) => l.source === "manual") : leads.find((l) => l.id.startsWith(ref));
      if (!lead) die("案件が見つかりません");
      agentDb.updateLead(lead.id, { status: target });
      const label = { applied: "応募済み", won: "受注", lost: "不採用", archived: "見送り" }[target];
      console.log(`「${lead.title}」を ${label} にしました`);
      break;
    }
    case "profile": {
      const file = opt("file");
      if (!file) die("--file（経歴を書いたファイル）が要ります");
      const background = fs.readFileSync(path.resolve(file), "utf8").trim().slice(0, 5000);
      const saved = repo.saveProfile({ ...emptyProfile, ...(hustleDb.readProfile() ?? {}), background });
      fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
      fs.writeFileSync(PROFILE_FILE, `${JSON.stringify({ background: saved.background, weeklyHours: saved.weeklyHours }, null, 2)}\n`);
      console.log(`経歴を登録しました（${saved.background.length}文字）。次の提案文から使います。`);
      break;
    }
    default:
      console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n\/\*\*?/, "").replace(/^ \* ?/gm, ""));
      return;
  }
  if (flag("push")) await pushLibrary();
}

await main();
