#!/usr/bin/env node
/**
 * ランサーズ巡回 — あなたのPCで、ログインなしで募集を見て回り、応募候補と提案文の一覧を作る。
 *
 *   node scripts/lancers-patrol.mjs run                 # 巡回して一覧を書く（判定と提案文は job.mjs judge）
 *   node scripts/lancers-patrol.mjs run --show          # 画面を見ながら
 *   node scripts/lancers-patrol.mjs run --no-judge      # 判定せずに集めるだけ
 *   node scripts/lancers-patrol.mjs market [--days 7] [--out フォルダ]  # 仕事の種類ごとの募集数と予算の集計
 *   node scripts/lancers-patrol.mjs run --keywords "エクセル,VBA" --out C:\Users\…\副業\ランサーズ応募候補
 *
 * 守ること（変えない）:
 *   - 見るだけ。ログイン・提案・質問・メッセージ・お気に入り・ボタン操作はしない（URLを開いて文字を読むだけ）
 *   - 1回に開くのは20ページまで、ページごとに6〜12秒あける。robots.txt で禁止のURLは開かない
 *   - 一覧は %USERPROFILE%\.lancers-patrol（既読の記録）と --out のフォルダに置き、リポジトリには入れない
 *
 * 検索語は Excel に限らず、記事作成・文字起こし・翻訳・データ入力・リサーチ・資料作成・プログラミングなど
 * Claude が納品物を作れる仕事全部（lib/lancers.mjs の DEFAULT_KEYWORDS）を、1回10語ずつ順番に回す。
 *
 * 一覧の並びは「応募してよい」→ 依頼者の点数の高い順（発注数＝リピートの多さを一番重く）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_KEYWORDS,
  rotateKeywords,
  MAX_DETAILS,
  MAX_PAGES,
  clientScore,
  detailUrl,
  extractDetailInPage,
  extractListInPage,
  formatMarket,
  summarizeMarket,
  formatList,
  normalizeDetail,
  normalizeListItem,
  onePerClient,
  searchUrl,
} from "./lib/lancers.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const HOME = process.env.LANCERS_PATROL_HOME || path.join(os.homedir(), ".lancers-patrol");
const SEEN = path.join(HOME, "seen.json");
const STATE = path.join(HOME, "state.json");
const MARKET_LOG = path.join(HOME, "market-log.jsonl");
const PROFILE = path.join(HOME, "browser-profile");

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fake = !!process.env.LANCERS_PATROL_FAKE_DIR;
const politeWait = () => sleep(fake ? 50 : 6000 + Math.random() * 6000);
const log = (...a) => console.log(new Date().toLocaleTimeString("ja-JP"), ...a);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function openBrowser(headless) {
  const pw = await import("playwright-core").catch(() => null);
  if (!pw) throw new Error("playwright-core が入っていません。リポジトリのフォルダで npm install を実行してください");
  fs.mkdirSync(PROFILE, { recursive: true });
  const exe = process.env.LANCERS_PATROL_EXECUTABLE;
  const opts = exe ? { executablePath: exe } : { channel: process.env.LANCERS_PATROL_BROWSER || "msedge" };
  const ctx = await pw.chromium.launchPersistentContext(PROFILE, { ...opts, headless, locale: "ja-JP", viewport: { width: 1280, height: 900 } });
  // 試験用: 本物のサイトに行かず、フォルダの中のHTMLを返す（list-<keyword>.html / detail-<id>.html）
  if (fake) {
    const dir = process.env.LANCERS_PATROL_FAKE_DIR;
    await ctx.route("https://www.lancers.jp/**", (route) => {
      const u = new URL(route.request().url());
      const name = u.pathname.startsWith("/work/search")
        ? `list-${u.searchParams.get("keyword")}`
        : u.pathname.startsWith("/work/detail/")
          ? `detail-${u.pathname.split("/").pop()}`
          : u.pathname.replace(/\W+/g, "_");
      const file = path.join(dir, `${name}.html`);
      return fs.existsSync(file)
        ? route.fulfill({ contentType: "text/html; charset=utf-8", body: fs.readFileSync(file, "utf8") })
        : route.fulfill({ status: 404, body: "not found" });
    });
  }
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { ctx, page };
}

function judgeJob(text, title, url) {
  fs.mkdirSync(HOME, { recursive: true });
  const tmp = path.join(HOME, "tmp-job.txt");
  fs.writeFileSync(tmp, text);
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "job.mjs"), "judge", "--text", tmp, "--title", title, "--url", url], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 6 * 60_000,
    env: { ...process.env, JOB_AUTO_PULL: "0" },
  });
  const out = `${r.stdout ?? ""}`.trim();
  if (r.status !== 0 && !out) return { verdict: "判定できず", detail: (r.stderr ?? "").slice(-500) };
  return { verdict: out.match(/結論: (\S+)/)?.[1] ?? "判定できず", detail: out };
}

async function run() {
  const keywords = (opt("--keywords") ?? "").split(/[,、]/).map((s) => s.trim()).filter(Boolean);
  const state = readJson(STATE, {});
  const rot = rotateKeywords(DEFAULT_KEYWORDS, state.keywordCursor ?? 0);
  const words = keywords.length ? keywords : rot.words;
  if (!keywords.length) {
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify({ ...state, keywordCursor: rot.next }));
  }
  log(`今回の検索語: ${words.join("・")}`);
  const outDir = opt("--out") ?? path.join(HOME, "lists");
  const seen = new Set(readJson(SEEN, []));
  let pages = 0;

  const { ctx, page } = await openBrowser(!flag("--show"));
  const found = new Map();
  try {
    for (const w of words) {
      if (pages >= MAX_PAGES) break;
      // 1ページ目が広告（テックエージェント）だけのときは、2ページ目まで見る
      let items = [];
      for (let p = 1; p <= 2 && pages < MAX_PAGES; p++) {
        if (pages > 0) await politeWait();
        await page.goto(searchUrl(w, p), { waitUntil: "domcontentloaded", timeout: 45_000 });
        pages++;
        const raw = await page.evaluate(extractListInPage);
        items = raw.map(normalizeListItem).filter(Boolean);
        if (items.length || !raw.length) break;
      }
      log(`「${w}」 ${items.length}件`);
      // 募集の数と予算を、仕事の種類（検索語）ごとに記録する（market で集計）
      fs.mkdirSync(HOME, { recursive: true });
      const at = new Date().toISOString();
      fs.appendFileSync(MARKET_LOG, items.map((it) => JSON.stringify({ id: it.id, keyword: w, price: it.price, at }) + "\n").join(""));
      for (const it of items) {
        if (seen.has(it.id) || found.has(it.id) || it.closed) continue;
        found.set(it.id, { ...it, keyword: w, score: clientScore(it) });
      }
    }

    // 依頼者の点数の高いものから詳細を読む
    // 1人の依頼者が枠を埋めないよう、依頼者1人につき1件まで
    const picked = onePerClient([...found.values()].sort((a, b) => b.score - a.score), Math.min(MAX_DETAILS, MAX_PAGES - pages));
    const results = [];
    for (const it of picked) {
      await politeWait();
      await page.goto(detailUrl(it.id), { waitUntil: "domcontentloaded", timeout: 45_000 });
      pages++;
      const d = normalizeDetail(await page.evaluate(extractDetailInPage));
      seen.add(it.id);
      if (d.closed) {
        log(`終了済み: ${it.title}`);
        continue;
      }
      const job = { ...it, ...d, verified: d.verified ?? it.verified, proposals: d.proposals ?? it.proposals };
      job.score = clientScore(job);
      results.push(job);
    }
    await ctx.close();

    for (const job of results) {
      if (flag("--no-judge")) {
        job.verdict = "判定なし";
        continue;
      }
      log(`判定: ${job.title}`);
      const j = judgeJob(job.text.slice(0, 12_000), job.title, detailUrl(job.id));
      job.verdict = j.verdict;
      job.detail = j.detail;
    }

    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(SEEN, JSON.stringify([...seen].slice(-3000)));
    fs.mkdirSync(outDir, { recursive: true });
    const md = formatList(results);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    fs.writeFileSync(path.join(outDir, `ランサーズ応募候補-${stamp}.md`), md);
    fs.writeFileSync(path.join(outDir, "ランサーズ応募候補-最新.md"), md);
    console.log(`開いたページ ${pages} / 新しい募集 ${found.size}件 / 詳細を読んだ ${picked.length}件 / 一覧に載せた ${results.length}件`);
    console.log(`一覧: ${path.join(outDir, "ランサーズ応募候補-最新.md")}`);
  } catch (e) {
    await ctx.close().catch(() => {});
    throw e;
  }
}

function market() {
  const days = Number(opt("--days") ?? 7);
  const records = fs.existsSync(MARKET_LOG)
    ? fs.readFileSync(MARKET_LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const md = formatMarket(summarizeMarket(records, { days }), days);
  const out = opt("--out");
  if (out) {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "ランサーズ募集の数と予算.md"), md);
  }
  console.log(md);
}

if (cmd === "market") {
  market();
} else if (cmd === "run") {
  run().catch((e) => {
    console.error(`エラー: ${e.message}`);
    process.exit(1);
  });
} else {
  console.log("使い方: node scripts/lancers-patrol.mjs run [--show] [--no-judge] [--keywords エクセル,VBA] [--out フォルダ] | market [--days 7] [--out フォルダ]");
  process.exit(cmd ? 2 : 0);
}
