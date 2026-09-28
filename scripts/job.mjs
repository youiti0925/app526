#!/usr/bin/env node
/**
 * 仕事ラインをコマンド1つで回す（画面もサーバーも立てない）。
 *
 * スマホの Claude アプリで「依頼を貼る専用の会話」から使う前提。
 * 会話の相手（Claude）が何度も動くと、その分だけ使用量が増えるので、
 * 1件の処理は「ファイルを置く → このコマンドを1回 → 結果を送る」で終わるようにしてある。
 *
 *   node scripts/job.mjs run --title "件名" --instructions 依頼.txt --csv 入力.csv \
 *       [--list NGリスト=ng.txt] [--public] [--deadline 2026-10-10] [--price 20000] [--push]
 *   node scripts/job.mjs approve [id|last] [--push]
 *   node scripts/job.mjs reject  [id|last] --note "理由" [--push]
 *   node scripts/job.mjs redo    [id|last] --note "直す点" [--push]
 *   node scripts/job.mjs resume  [id|last] [--push]     # 使用上限で止まった依頼の続き
 *   node scripts/job.mjs status
 *   node scripts/job.mjs usage
 *
 * --push: 手順書と使用量の記録（library/ だけ）を GitHub に保存する。
 *         依頼者のデータ（入力・納品物）は outbox/ と data/ に置き、どちらもコミットしない。
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist-e2e");
process.env.APP_DATA_DIR ||= path.join(ROOT, "data");
process.env.JOB_LIBRARY_DIR ||= path.join(ROOT, "library");

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
    lines.push(`納品用: ${path.relative(ROOT, path.join(dir, "納品.csv"))}`);
    lines.push(`確認メモ付き: ${path.relative(ROOT, path.join(dir, "確認メモ付き.csv"))}`);
  }
  if (job.status === "awaiting_approval") lines.push("次: 承認なら approve、直すなら redo --note \"直す点\"、出さないなら reject");
  if (job.status === "waiting_quota") lines.push(`次: ${job.retryAt ? new Date(job.retryAt).toLocaleString("ja-JP") : "しばらく"} 以降に resume`);
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

async function pushLibrary() {
  const lib = path.relative(ROOT, process.env.JOB_LIBRARY_DIR);
  if (!fs.existsSync(path.join(ROOT, lib))) return;
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
      const csvFile = opt("csv");
      if (!title || !instructionsFile || !csvFile) die("--title と --instructions（依頼文のファイル）と --csv（入力の表）が要ります");
      const read = (f) => fs.readFileSync(path.resolve(f), "utf8").replace(/^﻿/, "");
      const lists = {};
      for (const spec of opts("list")) {
        const eq = spec.indexOf("=");
        if (eq <= 0) die(`--list は 名前=ファイル の形で指定してください（${spec}）`);
        lists[spec.slice(0, eq)] = read(spec.slice(eq + 1)).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      }
      const job = jobsDb.createJob({
        title,
        instructions: read(instructionsFile),
        inputCsv: read(csvFile),
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
    default:
      console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n\/\*\*?/, "").replace(/^ \* ?/gm, ""));
      return;
  }
  if (flag("push")) await pushLibrary();
}

await main();
