#!/usr/bin/env node
/**
 * クラウドワークス巡回 — あなたのPCで、あなたのログインのまま、新着とやり取りを見て回り、まとめをGメールに送る。
 *
 *   node scripts/cw-patrol.mjs setup       # 初回だけ: ログイン・見る画面の登録・Gメールの設定
 *   node scripts/cw-patrol.mjs run         # 巡回して、知らせることがあればGメールに送る（タスクスケジューラから呼ぶ）
 *   node scripts/cw-patrol.mjs run --always    # 新しいことが無くてもまとめを送る
 *   node scripts/cw-patrol.mjs test-mail   # Gメールに試しの1通を送る
 *
 * 守ること（変えない）:
 *   - 見るだけ。応募・返信・メッセージ送信・ボタン操作はしない（ページを開いて文字を読むだけ）
 *   - 1回に開くページ数を絞り、ページごとに6〜12秒あける
 *   - パスワードはブラウザにあなたが入力する。このスクリプトもClaudeも受け取らない
 *   - 設定・ログイン状態・既読の記録は %USERPROFILE%\.cw-patrol に置き、リポジトリには入れない
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import Module from "node:module";
import { sendMail } from "./lib/smtp.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist-e2e");
const HOME = process.env.CW_PATROL_HOME || path.join(os.homedir(), ".cw-patrol");
const CONFIG = path.join(HOME, "config.json");
const SEEN = path.join(HOME, "seen.json");
const LOCK = path.join(HOME, "running.lock");
const PROFILE = path.join(HOME, "browser-profile");

const MAX_THREADS = 15;
const MAX_JOBS = 10;
const LOGIN_URL = "https://crowdworks.jp/login";

const argv = process.argv.slice(2);
const cmd = argv[0];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const politeWait = () => sleep(process.env.CW_PATROL_FAKE_DIR ? 100 : 6000 + Math.random() * 6000);
const log = (...a) => console.log(new Date().toLocaleTimeString("ja-JP"), ...a);

function die(msg) {
  console.error(`エラー: ${msg}`);
  process.exit(1);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// --- 部品の準備（job.mjs と同じコンパイル済みの判定を使う）--------------------------

function ensureBuilt() {
  // job.mjs status が、部品の導入とコンパイルを済ませる（最新の取り込みも）
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "job.mjs"), "status"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) die(`準備に失敗しました\n${(r.stderr || r.stdout).slice(-1500)}`);
}

function loadLib() {
  const original = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith("@/")) return original.call(this, path.join(DIST, request.slice(2)), ...rest);
    return original.call(this, request, ...rest);
  };
  const req = Module.createRequire(import.meta.url);
  return {
    cw: req(path.join(DIST, "lib/hustle/jobs/cw-thread.js")),
    core: req(path.join(DIST, "lib/hustle/jobs/patrol-core.js")),
  };
}

async function openBrowser({ headless }) {
  let pw;
  try {
    pw = await import("playwright-core");
  } catch {
    die("playwright-core が入っていません。リポジトリのフォルダで npm install を実行してください");
  }
  fs.mkdirSync(PROFILE, { recursive: true });
  const exe = process.env.CW_PATROL_EXECUTABLE;
  // Windows には Edge が入っているので、ブラウザを別に落とさずそれを使う
  const opts = exe ? { executablePath: exe } : { channel: process.env.CW_PATROL_BROWSER || "msedge" };
  const ctx = await pw.chromium.launchPersistentContext(PROFILE, { ...opts, headless, locale: "ja-JP", viewport: { width: 1280, height: 900 } });
  // 試験用: 本物のサイトに行かず、フォルダの中のHTMLを crowdworks.jp の代わりに返す
  const fakeDir = process.env.CW_PATROL_FAKE_DIR;
  if (fakeDir) {
    await ctx.route("https://crowdworks.jp/**", (route) => {
      const name = new URL(route.request().url()).pathname.replace(/^\/+|\/+$/g, "").replace(/\//g, "_") || "index";
      const file = path.join(fakeDir, `${name}.html`);
      return fs.existsSync(file)
        ? route.fulfill({ contentType: "text/html; charset=utf-8", body: fs.readFileSync(file, "utf8") })
        : route.fulfill({ status: 404, body: "not found" });
    });
  }
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { ctx, page };
}

async function readPage(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(2500);
  const finalUrl = page.url();
  const text = await page.evaluate(() => document.body?.innerText ?? "");
  const title = await page.title();
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.href));
  return { finalUrl, text, title, hrefs };
}

const isLoginPage = (url) => /\/login(\b|\/|\?|$)/.test(new URL(url).pathname + new URL(url).search);

// --- setup ---------------------------------------------------------------------------

async function setup() {
  ensureBuilt();
  // 募集の判定と提案文は、このPCの Claude Code（サブスク）で作る
  const claude = spawnSync("claude", ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
  if (claude.status !== 0) {
    console.log(
      "注意: Claude Code が見つかりません。募集の判定・提案文には要ります（やり取りの確認とGメールは無しでも動きます）。\n" +
        "  npm install -g @anthropic-ai/claude-code のあと、claude を一度起動してログインしてください。\n"
    );
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const config = readJson(CONFIG, { listUrls: [], searchUrls: [], me: "", mail: null });
  console.log("\n=== クラウドワークス巡回の設定（初回だけ）===\n");
  console.log("ブラウザ（Edge）が開きます。以下の手順で進めてください。パスワードはブラウザにだけ入力します。\n");

  const { ctx, page } = await openBrowser({ headless: false });
  try {
    await page.goto(LOGIN_URL);
    await rl.question("1) 開いたブラウザでクラウドワークスにログインしてください。終わったら、ここで Enter を押してください > ");

    await rl.question(
      "2) ブラウザで「マイページ」→「相談から契約まで」の一覧（応募・相談中のやり取りが並ぶ画面）を開いてください。\n   開けたら Enter > "
    );
    if (isLoginPage(page.url())) die("まだログインできていないようです。もう一度 setup からやり直してください");
    config.listUrls = [page.url()];
    console.log(`   登録しました: ${page.url()}\n`);

    config.searchUrls = [];
    for (let i = 1; i <= 3; i++) {
      const ans = await rl.question(
        `3-${i}) 仕事を探す画面で、探したい条件（例: データ入力、新着順）で検索してください。\n` +
          "     検索結果が出たら Enter（もう登録しないなら n と入力して Enter）> "
      );
      if (ans.trim().toLowerCase() === "n") break;
      config.searchUrls.push(page.url());
      console.log(`   登録しました: ${page.url()}\n`);
    }

    const me = await rl.question(`4) あなたのクラウドワークスのID（例: youitirou0925）> `);
    config.me = me.trim() || config.me || "youitirou0925";

    console.log(
      "\n5) まとめを送るGメールの設定です。\n" +
        "   Googleアカウントの「アプリ パスワード」が要ります（2段階認証をオンにしたうえで、\n" +
        "   https://myaccount.google.com/apppasswords で作る16文字。普段のパスワードではありません）。\n" +
        "   ここで入力したものは、このPCの " + CONFIG + " にだけ保存します。"
    );
    const user = (await rl.question("   Gメールのアドレス > ")).trim();
    const pass = (await rl.question("   アプリ パスワード（16文字・空白は無視）> ")).replace(/\s+/g, "");
    if (user && pass) config.mail = { user, pass, to: user };
  } finally {
    rl.close();
    await ctx.close();
  }
  writeJson(CONFIG, config);
  try {
    fs.chmodSync(CONFIG, 0o600);
  } catch {}
  console.log("\n設定を保存しました。試しのメールを送ります…");
  await testMail(config);
  console.log("\n次: scripts\\windows\\cw-patrol-register.cmd を実行すると、PCを使っている間3時間ごとに自動で巡回します。");
}

async function testMail(config = readJson(CONFIG, null)) {
  const { core } = loadLib();
  if (!config?.mail) die("Gメールが設定されていません。setup を実行してください");
  const message = core.buildMimeMessage({
    from: config.mail.user,
    to: config.mail.to,
    subject: "【CW巡回】設定の確認",
    body: "クラウドワークス巡回の設定ができました。知らせることがあると、このアドレスにまとめが届きます。",
  });
  await sendMail({ user: config.mail.user, pass: config.mail.pass, to: config.mail.to, message });
  console.log(`送りました（${config.mail.to}）。受信箱を確認してください`);
}

// --- run -----------------------------------------------------------------------------

function judgeJob(text, title, url) {
  const tmp = path.join(HOME, "tmp-job.txt");
  fs.writeFileSync(tmp, text);
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts", "job.mjs"), "judge", "--text", tmp, "--title", title, "--url", url],
    { cwd: ROOT, encoding: "utf8", timeout: 6 * 60_000, env: { ...process.env, JOB_AUTO_PULL: "0" } }
  );
  const out = `${r.stdout ?? ""}`.trim();
  const verdict = out.match(/結論: (\S+)/)?.[1] ?? "判定できず";
  if (r.status !== 0 && !out) return { verdict: "判定できず", detail: (r.stderr ?? "").slice(-500) };
  return { verdict, detail: out };
}

async function run() {
  const config = readJson(CONFIG, null);
  if (!config?.listUrls?.length) die("まだ設定されていません。先に setup を実行してください");

  // 同時に2つ動かない（ログオン時と3時間ごとが重なったとき）
  if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < 30 * 60_000) {
    log("前回の巡回がまだ動いているので、今回は休みます");
    return;
  }
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(LOCK, String(process.pid));

  try {
    ensureBuilt();
    const { cw, core } = loadLib();
    const seen = readJson(SEEN, core.emptySeen());
    const errors = [];
    const threads = [];
    const judged = [];
    let loginExpired = false;

    const { ctx, page } = await openBrowser({ headless: !argv.includes("--show") });
    try {
      // 1) やり取りの一覧 → 各やり取り
      const threadLinks = [];
      for (const url of config.listUrls) {
        log(`一覧を見ています: ${url}`);
        const p = await readPage(page, url);
        if (isLoginPage(p.finalUrl)) {
          loginExpired = true;
          break;
        }
        threadLinks.push(...core.collectLinks(p.hrefs).threads);
        await politeWait();
      }
      if (!loginExpired) {
        const uniq = [...new Map(threadLinks.map((l) => [l.key, l])).values()].slice(0, MAX_THREADS);
        for (const link of uniq) {
          try {
            log(`やり取りを読んでいます: ${link.url}`);
            const p = await readPage(page, link.url);
            if (isLoginPage(p.finalUrl)) {
              loginExpired = true;
              break;
            }
            const parsed = cw.parseCwThreads(p.text, config.me)[0];
            if (!/^相談から契約まで/.test(p.text.trim().split("\n").find((l) => l.trim()) ?? "")) {
              parsed.title = p.title.replace(/\s*[|｜].*$/, "").trim() || parsed.title;
            }
            const review = cw.reviewCwThread(parsed, new Date());
            const fp = core.threadFingerprint(review);
            const changed = seen.threads[link.key] !== fp;
            seen.threads[link.key] = fp;
            if (parsed.messages.length === 0) errors.push(`メッセージが読めませんでした: ${link.url}`);
            threads.push({ review, url: link.url, changed });
          } catch (e) {
            errors.push(`${link.url}: ${e.message}`);
          }
          await politeWait();
        }
      }

      // 2) 検索結果 → 新しい募集だけ判定
      if (!loginExpired) {
        const jobLinks = [];
        for (const url of config.searchUrls ?? []) {
          try {
            log(`新着を見ています: ${url}`);
            const p = await readPage(page, url);
            jobLinks.push(...core.collectLinks(p.hrefs).jobs);
          } catch (e) {
            errors.push(`${url}: ${e.message}`);
          }
          await politeWait();
        }
        const uniq = [...new Map(jobLinks.map((l) => [l.key, l])).values()];
        for (const link of core.newJobs(uniq, seen, MAX_JOBS)) {
          try {
            log(`募集を読んでいます: ${link.url}`);
            const p = await readPage(page, link.url);
            const title = p.title.replace(/\s*[|｜].*$/, "").trim() || "（題名不明）";
            seen.jobs[link.key] = new Date().toISOString();
            log(`判定しています: ${title}`);
            const j = judgeJob(p.text, title, link.url);
            judged.push({ title, url: link.url, verdict: j.verdict, detail: j.detail });
          } catch (e) {
            errors.push(`${link.url}: ${e.message}`);
          }
          await politeWait();
        }
      }
    } finally {
      await ctx.close();
    }

    writeJson(SEEN, seen);
    const report = core.buildReport({ threads, jobs: judged, errors, loginExpired });
    log(report.subject);
    if ((report.worthSending || argv.includes("--always")) && config.mail) {
      const message = core.buildMimeMessage({ from: config.mail.user, to: config.mail.to, subject: report.subject, body: report.body });
      await sendMail({ user: config.mail.user, pass: config.mail.pass, to: config.mail.to, message });
      log(`Gメールに送りました（${config.mail.to}）`);
    } else if (!config.mail) {
      log("Gメールが設定されていないので、まとめをここに出します（setup で設定できます）");
      console.log(`\n${report.subject}\n\n${report.body}\n`);
    } else {
      log("新しく知らせることは無いので、メールは送りません");
    }
  } finally {
    fs.rmSync(LOCK, { force: true });
  }
}

const commands = { setup, run, "test-mail": () => testMail() };
if (!commands[cmd]) {
  console.log("使い方: node scripts/cw-patrol.mjs setup | run [--always] [--show] | test-mail");
  process.exit(cmd ? 1 : 0);
}
await commands[cmd]();
