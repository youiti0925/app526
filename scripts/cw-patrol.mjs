#!/usr/bin/env node
/**
 * クラウドワークス巡回 — あなたのPCで、あなたのログインのまま、新着とやり取りを見て回り、まとめをGメールに送る。
 *
 *   node scripts/cw-patrol.mjs setup       # 初回だけ: ログイン・見る画面の登録・Gメールの設定
 *   node scripts/cw-patrol.mjs run         # 巡回して、知らせることがあればGメールに送る（タスクスケジューラから呼ぶ）
 *   node scripts/cw-patrol.mjs run --always    # 新しいことが無くてもまとめを送る
 *   node scripts/cw-patrol.mjs queue                       # 応募の下書き一覧（一覧・承認済み）を表示する
 *   node scripts/cw-patrol.mjs queue-add <募集URL> --proposal 提案文.txt   # 人が確かめた提案文つきで一覧に足す
 *   node scripts/cw-patrol.mjs queue-redraft [番号…] [--force]       # 提案文が空の件の提案文を作り直す（--force: 入っている件も）
 *   node scripts/cw-patrol.mjs queue-set <番号> --proposal 提案文.txt  # その件の提案文をファイルの文に差し替える
 *   node scripts/cw-patrol.mjs page <募集IDまたはURL>…               # 募集の本文（判定に渡す部分）を表示する
 *   node scripts/cw-patrol.mjs queue-mark approved|sent|skipped 3 5   # 一覧の番号に印を付ける（承認 = approved）
 *   node scripts/cw-patrol.mjs fill --approved             # 承認した件だけ、入力済みの応募画面を開く（最大5件。「応募する」は自分で押す）
 *   node scripts/cw-patrol.mjs survey [--max 30] [--fresh]   # 登録した検索画面の募集の報酬だけを集める（判定・応募はしない）
 *   node scripts/cw-patrol.mjs add-keyword --defaults       # 探す言葉を足す（Claudeが納品できる仕事は全部。--list で一覧、言葉を並べて個別にも足せる）
 *   node scripts/cw-patrol.mjs explain <募集URLか番号>…       # 募集を1件ずつ読んで、なぜそう判定されるか（当たった語つき）を出す。最大8件
 *   node scripts/cw-patrol.mjs schedule    # 自動実行の登録をやり直す（電池でも動く・寝ていた分も回す設定つき）
 *   node scripts/cw-patrol.mjs test-mail   # Gメールに試しの1通を送る
 *   node scripts/cw-patrol.mjs fill <募集URL> --proposal 提案文.txt [--price 金額] [--days 日数]
 *   node scripts/cw-patrol.mjs fill --list 一覧.tsv   # 1行に「URL<TAB>提案文.txt<TAB>金額<TAB>日数」。1回に5件まで
 *       応募画面に提案文・金額・納期を入力した状態で開いて止める。「応募する」はあなたが押す
 *
 * 守ること（変えない）:
 *   - 見るだけ。応募・返信・メッセージ送信・ボタン操作はしない（ページを開いて文字を読むだけ）
 *     fill だけは応募画面の欄に入力するが、送信系のボタンは押さない（scripts/lib/cw-fill.mjs）
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
import { MAX_TABS, applyState, applyUrl, fillProposalForm, jobIdFromUrl, jobUrl, parseList, validateEntry } from "./lib/cw-fill.mjs";
import { WIDE_KEYWORDS, WIDE_WORD_LIST, keywordOf, rotate, searchUrlFrom } from "./lib/cw-searches.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist-e2e");
const HOME = process.env.CW_PATROL_HOME || path.join(os.homedir(), ".cw-patrol");
const CONFIG = path.join(HOME, "config.json");
const SEEN = path.join(HOME, "seen.json");
const BUDGET_LOG = path.join(HOME, "budget-log.jsonl");
const QUEUE_JSON = path.join(HOME, "queue.json");
const QUEUE_MD = path.join(HOME, "queue.md");
const LOCK = path.join(HOME, "running.lock");
const PROFILE = path.join(HOME, "browser-profile");

const MAX_THREADS = 15;
const MAX_JOBS = 20;
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

/**
 * ログインのときだけ、Edge を普通のブラウザとして開く。
 * Playwright が開いた（プログラムが操作する）ブラウザからの Google ログインは Google に拒否されるため。
 * 同じ browser-profile を使うので、ここでのログイン状態を巡回でもそのまま使える。
 * Windows 以外・試験用の偽画面のときは false を返し、呼び出し側は従来どおり Playwright で開く。
 */
function openPlainBrowser(url) {
  if (process.platform !== "win32" || process.env.CW_PATROL_FAKE_DIR) return false;
  fs.mkdirSync(PROFILE, { recursive: true });
  const args = [`--user-data-dir=${PROFILE}`, "--no-first-run", url];
  const exe = process.env.CW_PATROL_EXECUTABLE;
  const r = exe
    ? spawnSync("cmd", ["/c", "start", "", exe, ...args], { stdio: "ignore" })
    : spawnSync("cmd", ["/c", "start", "", "msedge", ...args], { stdio: "ignore" });
  return r.status === 0;
}

/** 巡回用のブラウザを開き、ログインできているかを確かめる（できていなければ null） */
async function openLoggedIn() {
  const b = await openBrowser({ headless: false });
  const dash = await readPage(b.page, "https://crowdworks.jp/dashboard").catch(() => null);
  if (dash && !isLoginPage(dash.finalUrl)) return { ...b, dash };
  await b.ctx.close();
  return null;
}

/** 既定のブラウザでページを開く（アプリ パスワードの作成ページなど） */
function openInDefaultBrowser(url) {
  if (process.platform === "win32") spawnSync("cmd", ["/c", "start", "", url], { stdio: "ignore" });
  else console.log(`   ブラウザで開いてください: ${url}`);
}

/**
 * 自動で回す登録（管理者の権限は要らない形）:
 *   - 3時間ごと: タスクスケジューラ（自分のユーザーの1時間単位の予定は権限なしで作れる）
 *   - ログオン時: 自分の「スタートアップ」フォルダに、5分待ってから1回回す .cmd を置く
 */
function registerSchedule() {
  if (process.platform !== "win32") {
    console.log("（Windows 以外なので、自動実行の登録はしません）");
    return;
  }
  const runner = path.join(ROOT, "scripts", "windows", "cw-patrol-run.cmd");
  let ok = true;
  const r = spawnSync("schtasks", ["/Create", "/F", "/TN", "CWPatrol-Every3h", "/SC", "HOURLY", "/MO", "3", "/TR", runner], { encoding: "utf8" });
  if (r.status !== 0) {
    ok = false;
    console.log(`3時間ごとの登録に失敗しました（${(r.stderr || r.stdout).trim()}）`);
  } else {
    // 既定のままだと「バッテリー駆動中は始めない」「PCが寝ていた時間の分は飛ばす」ので、ノートPCでは動かないことがある。
    // 電源につないでいなくても動かし、寝ていて飛ばした分は起きたあとに1回回す（PCを起こすことはしない）。
    const ps =
      "$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2); " +
      "Set-ScheduledTask -TaskName 'CWPatrol-Every3h' -Settings $s | Out-Null";
    const s = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8" });
    if (s.status !== 0) console.log(`3時間ごとの設定（電池でも動かす・寝ていた分を回す）に失敗しました。スケジュールは登録済みですが、ノートPCでは動かないことがあります（${(s.stderr || s.stdout).trim().slice(0, 200)}）`);
  }
  const startup = path.join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
  try {
    fs.writeFileSync(
      path.join(startup, "cw-patrol.cmd"),
      `@echo off\r\nrem CrowdWorks patrol: run once 5 minutes after logon\r\ntimeout /t 300 /nobreak >nul\r\ncall "${runner}"\r\n`
    );
  } catch (e) {
    ok = false;
    console.log(`ログオン時の登録に失敗しました（${e.message}）`);
  }
  if (ok) console.log("自動実行を登録しました（ログオンの5分後と、3時間ごと）。止めるときは scripts\\windows\\cw-patrol-unregister.cmd");
}

async function setup() {
  ensureBuilt();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const config = readJson(CONFIG, { listUrls: [], searchUrls: [], me: "", mail: null });
  console.log("\n=== クラウドワークス巡回の設定（初回だけ）===\n");
  console.log("Edge が開きます。パスワードは Edge にだけ入力します（この画面には入力しません）。\n");

  let ctx, page, dash;
  if (openPlainBrowser(LOGIN_URL)) {
    // Google ログインが通るよう、ふつうの Edge でログインしてもらい、閉じてから巡回用に開き直す
    for (;;) {
      await rl.question(
        "【1】開いた Edge でクラウドワークスにログインしてください（Googleでのログインも使えます）。\n" +
          "    ログインできたら、その Edge の窓を右上の × で閉じてから、ここで Enter > "
      );
      const b = await openLoggedIn().catch((e) => {
        console.log(`   Edge を開けませんでした（${e.message.split("\n")[0]}）。Edge の窓がすべて閉じているか確かめてください`);
        return null;
      });
      if (b) {
        ({ ctx, page, dash } = b);
        break;
      }
      console.log("   まだログインできていないようです。もう一度 Edge を開きます");
      openPlainBrowser(LOGIN_URL);
    }
  } else {
    ({ ctx, page } = await openBrowser({ headless: false }));
    await page.goto(LOGIN_URL);
    for (;;) {
      await rl.question("【1】開いた Edge でクラウドワークスにログインしてください。ログインできたら、ここで Enter > ");
      if (!isLoginPage(page.url())) break;
      console.log("   まだログイン画面のようです。ログインしてから Enter を押してください");
    }
  }
  try {
    // やり取りの一覧: マイページから自動で見つける。見つからなければ開いてもらう
    dash = dash ?? (await readPage(page, "https://crowdworks.jp/dashboard").catch(() => null));
    const found = dash && !isLoginPage(dash.finalUrl) ? loadLib().core.collectLinks(dash.hrefs).threads : [];
    if (found.length > 0) {
      config.listUrls = [dash.finalUrl];
      console.log(`   マイページから、やり取り ${found.length}件を見つけました\n`);
    } else {
      await rl.question("【1-2】Edge で「マイページ」→「相談から契約まで」の一覧を開いて、Enter > ");
      config.listUrls = [page.url()];
    }

    // 新着: 検索を1回してもらい、その画面を覚える
    await page.goto("https://crowdworks.jp/public/jobs").catch(() => {});
    config.searchUrls = [];
    for (let i = 1; i <= 3; i++) {
      const ans = await rl.question(
        i === 1
          ? "【2】Edge で、探したい言葉（例: データ入力）で検索し、並び順を「新着」にしてください。結果が出たら Enter > "
          : "    もう1つ登録するなら、別の言葉で検索して Enter。終わりならそのまま n と入力して Enter > "
      );
      if (i > 1 && ans.trim().toLowerCase() === "n") break;
      config.searchUrls.push(page.url());
    }
    config.me = config.me || "youitirou0925";
  } finally {
    await ctx.close();
  }

  console.log(
    "\n【3】まとめを送るGメールの設定です。Googleの「アプリ パスワード」のページを開きます。\n" +
      "   名前に CW巡回 と入れて「作成」→ 出てきた16文字を下に入力してください（普段のパスワードではありません）。\n" +
      "   ※ 2段階認証がオフだと作れません。そのときは、同じページの案内に従ってオンにしてください。\n" +
      `   入力したものは、このPCの ${CONFIG} にだけ保存します。`
  );
  openInDefaultBrowser("https://myaccount.google.com/apppasswords");
  try {
    const user = (await rl.question("   Gメールのアドレス > ")).trim();
    const pass = (await rl.question("   アプリ パスワード（16文字）> ")).replace(/\s+/g, "");
    if (user && pass) config.mail = { user, pass, to: user };
  } finally {
    rl.close();
  }
  writeJson(CONFIG, config);
  try {
    fs.chmodSync(CONFIG, 0o600);
  } catch {}

  if (config.mail) {
    console.log("\n試しのメールを送ります…");
    try {
      await testMail(config);
    } catch (e) {
      console.log(`メールを送れませんでした: ${e.message}\n   あとで scripts\\windows\\cw-patrol-setup.cmd をもう一度実行してください`);
    }
  }
  if (argv.includes("--register")) registerSchedule();
  console.log("\n設定が終わりました。このあとはPCをつけている間、自動で巡回します。");
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

/** 経歴（提案文に使う library/profile.json）の文章。読めなければ undefined（提案文の経歴チェックは飛ばす） */
function readBackground() {
  try {
    const bg = JSON.parse(fs.readFileSync(path.join(ROOT, "library", "profile.json"), "utf8")).background;
    return typeof bg === "string" ? bg : undefined;
  } catch {
    return undefined;
  }
}

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

/**
 * 公開されている募集（ココナラ・ままワークス）の自動収集を回し、応募候補と提案文をまとめに載せる。
 * 失敗してもCWの巡回は止めない（errors に理由を残す）。
 */
function runScan(errors) {
  if (process.env.CW_PATROL_FAKE_DIR || argv.includes("--no-scan")) return null;
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "job.mjs"), "scan", "--max", "25"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 40 * 60_000,
    env: { ...process.env, JOB_AUTO_PULL: "0" },
  });
  const out = `${r.stdout ?? ""}`.trim();
  const m = out.match(/応募候補(\d+)・確認してから(\d+)/);
  if (r.status !== 0 || !m) {
    errors.push(`公開募集の収集に失敗しました: ${(r.stderr || out).slice(-300)}`);
    return null;
  }
  const candidates = Number(m[1]) + Number(m[2]);
  if (candidates === 0) return { candidates: 0, body: "" };
  let body = out;
  const dirRel = out.match(/提案文の保存先: (.+)/)?.[1]?.trim();
  if (dirRel) {
    const dir = path.join(ROOT, dirRel);
    try {
      for (const f of fs.readdirSync(dir).sort()) {
        body += `\n\n―――― 提案文（${f}）\n${fs.readFileSync(path.join(dir, f), "utf8").trim()}`;
      }
    } catch {}
  }
  return { candidates, body };
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
  // 公開募集の収集は最大40分かかるので、動いているあいだはロックを新しく保つ
  const touch = setInterval(() => fs.utimesSync(LOCK, new Date(), new Date()), 60_000);

  try {
    ensureBuilt();
    const { cw, core } = loadLib();
    const seen = readJson(SEEN, core.emptySeen());
    const errors = [];
    const threads = [];
    const judged = [];
    const toJudge = [];
    const queueItems = [];
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
        const perSearch = [];
        // データ入力（category_id=267）の新着は件数が多く枠を使い切るので、最後に回す
        const ordered = [...(config.searchUrls ?? [])].sort((a, b) => Number(/category_id=267\b/.test(a)) - Number(/category_id=267\b/.test(b)));
        // 検索が多いので、巡回ごとに読み始める検索をずらす（前のほうの新着で枠が埋まり続けないように）
        const searchUrls = rotate(ordered, Math.floor(Date.now() / (3 * 3600_000)));
        for (const url of searchUrls) {
          try {
            log(`新着を見ています: ${url}`);
            const p = await readPage(page, url);
            perSearch.push(core.collectLinks(p.hrefs).jobs);
          } catch (e) {
            errors.push(`${url}: ${e.message}`);
          }
          await politeWait();
        }
        for (const link of core.pickJobsRoundRobin(perSearch, seen, MAX_JOBS)) {
          try {
            log(`募集を読んでいます: ${link.url}`);
            const p = await readPage(page, link.url);
            const title = p.title.replace(/\s*[|｜].*$/, "").trim() || "（題名不明）";
            seen.jobs[link.key] = new Date().toISOString();
            // 判定がおかしいときに見直せるよう、読んだ本文をPCの中にだけ残す（前回の分は上書き）
            fs.mkdirSync(path.join(HOME, "last-jobs"), { recursive: true });
            fs.writeFileSync(path.join(HOME, "last-jobs", `${String(toJudge.length + 1).padStart(2, "0")}.txt`), `${link.url}\n${title}\n\n${p.text}`);
            // 予算の記録（Excel/VBA の単価の前提を確かめるため。PCの中だけ）
            try {
              fs.appendFileSync(BUDGET_LOG, `${JSON.stringify(core.budgetRecord(link, title, p.text))}\n`);
            } catch {}
            toJudge.push({ title, url: link.url, link, text: core.jobBodyForJudging(p.text, title), pageText: p.text });
          } catch (e) {
            errors.push(`${link.url}: ${e.message}`);
          }
          await politeWait();
        }
      }
    } finally {
      await ctx.close();
    }

    // 判定は、ブラウザを閉じてから（Edge を開いたままだと PC のメモリが足りず、判定の Claude が落ちることがあった）
    // 時間が足りなくなっても困らないよう、発注の多い依頼者（優良）の募集から先に判定する
    toJudge.sort((a, b) => core.clientRank(a.pageText) - core.clientRank(b.pageText));
    for (const t of toJudge) {
      log(`判定しています: ${t.title}`);
      let j = judgeJob(t.text, t.title, t.url);
      if (/VirtualAlloc|ENOMEM|out of memory/i.test(j.detail)) {
        log("メモリ不足で判定が落ちました。少し待ってもう一度やります");
        await new Promise((r) => setTimeout(r, 30_000));
        j = judgeJob(t.text, t.title, t.url);
      }
      judged.push({ title: t.title, url: t.url, verdict: j.verdict, detail: j.detail });
      // 応募してよい／確認してから応募 は、依頼者の信頼度つきで「応募の下書き一覧」に足す（画面を開いて待たない）
      if (/^(応募してよい|確認してから応募)/.test(j.verdict)) {
        const item = core.buildQueueItem({
          link: t.link,
          applyUrl: applyUrl(jobIdFromUrl(t.url)),
          title: t.title,
          pageText: t.pageText,
          judged: { verdict: j.verdict, detail: j.detail },
          background: readBackground(),
        });
        // 関門・危険信号で見送りをすすめる募集(AIの判定と食い違ったとき)は、一覧に足さない
        if (!/^見送り/.test(item.verdict)) queueItems.push(item);
        else log(`一覧に足しませんでした（見送りをすすめます）: ${t.title}`);
      }
    }
    let queue = null;
    try {
      const before = readJson(QUEUE_JSON, core.emptyQueue());
      const after = core.addToQueue(before, queueItems);
      const knownNos = new Set(before.items.map((i) => i.no));
      const added = after.items.filter((i) => !knownNos.has(i.no));
      writeJson(QUEUE_JSON, after);
      fs.writeFileSync(QUEUE_MD, core.queueMarkdown(after));
      queue = { added, pendingTotal: after.items.filter((i) => i.status === "pending").length };
    } catch (e) {
      errors.push(`応募の下書き一覧を保存できませんでした: ${e.message}`);
    }

    writeJson(SEEN, seen);
    const scan = loginExpired ? null : runScan(errors);
    const report = core.buildReport({ threads, jobs: judged, errors, loginExpired, scan, queue });
    // 単価の記録（Excel/VBA の前提を確かめるため）をまとめの末尾に付ける
    try {
      const recs = fs.readFileSync(BUDGET_LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
      if (recs.length) report.body += `\n\n■ ${core.summarizeBudgets(recs)}`;
    } catch {}
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
    clearInterval(touch);
    fs.rmSync(LOCK, { force: true });
  }
}

// --- fill（応募画面に入力して止める。送信はしない）----------------------------------

function optValue(name) {
  const i = argv.indexOf(`--${name}`);
  return i > 0 ? argv[i + 1] : undefined;
}

async function fill() {
  const listFile = optValue("list");
  let entries;
  if (argv.includes("--approved")) {
    // 承認した件だけ。提案文と金額は一覧から取る
    ensureBuilt();
    const { core } = loadLib();
    const state = readJson(QUEUE_JSON, core.emptyQueue());
    const approved = state.items.filter((i) => i.status === "approved");
    if (!approved.length) die("承認済みの件がありません（queue-mark approved 番号 で印を付けます）");
    fs.mkdirSync(path.join(HOME, "queue-proposals"), { recursive: true });
    entries = approved.map((i) => {
      const file = path.join(HOME, "queue-proposals", `${i.no}.txt`);
      fs.writeFileSync(file, core.cleanProposal(i.proposal));
      return { url: i.url, proposal: file, price: i.price ?? undefined, days: undefined, no: i.no };
    });
  } else if (listFile) {
    entries = parseList(fs.readFileSync(path.resolve(listFile), "utf8"));
  } else {
    const url = argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined;
    const price = optValue("price");
    const days = optValue("days");
    entries = [{ url, proposal: optValue("proposal"), price: price ? Number(price.replace(/[,円]/g, "")) : undefined, days: days ? Number(days) : undefined }];
  }
  if (!entries.length || !entries[0].url) die("使い方: node scripts/cw-patrol.mjs fill <募集URL> --proposal 提案文.txt [--price 金額] [--days 日数]  または  fill --list 一覧.tsv  または  fill --approved");
  if (entries.length > MAX_TABS) {
    log(`1回に開くのは ${MAX_TABS} 件までです。先頭の ${MAX_TABS} 件だけ開きます`);
    entries = entries.slice(0, MAX_TABS);
  }
  const ready = [];
  for (const e of entries) {
    if (!e.proposal) die(`提案文のファイルがありません: ${e.url}`);
    e.message = fs.readFileSync(path.resolve(e.proposal), "utf8").trim();
    const problems = validateEntry(e);
    if (problems.length && !argv.includes("--approved")) die(problems.join("\n"));
    if (problems.length) log(`飛ばします（${problems.join(" / ")}）`);
    else ready.push(e);
  }
  entries = ready;
  if (!entries.length) die("入力できる件がありません");

  if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < 30 * 60_000) die("巡回が動いています。終わってからもう一度実行してください");
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(LOCK, String(process.pid));
  // ブラウザを開いているあいだは巡回を休ませる（同じログイン状態のフォルダを2つで開けないため）
  const touch = setInterval(() => fs.utimesSync(LOCK, new Date(), new Date()), 60_000);
  try {
    const { ctx, page } = await openBrowser({ headless: argv.includes("--headless") });
    const opened = [];
    for (const [i, e] of entries.entries()) {
      const id = jobIdFromUrl(e.url);
      const tab = i === 0 ? page : await ctx.newPage();
      if (i > 0) await politeWait();
      try {
        const job = await readPage(tab, jobUrl(id));
        const state = applyState(job);
        if (!state.ok) {
          log(`飛ばします（${state.reason}）: ${jobUrl(id)}`);
          if (i > 0) await tab.close();
          continue;
        }
        await politeWait();
        await tab.goto(applyUrl(id), { waitUntil: "domcontentloaded", timeout: 45_000 });
        await tab.waitForTimeout(2500);
        if (isLoginPage(tab.url())) {
          log(`飛ばします（ログインが切れています）: ${jobUrl(id)}`);
          continue;
        }
        const r = await fillProposalForm(tab, { message: e.message, price: e.price, days: e.days });
        opened.push(id);
        log(`入力しました: ${jobUrl(id)}  → ${r.done.join("・")}${r.skipped.length ? `（入れていない: ${r.skipped.join("・")}）` : ""}`);
      } catch (err) {
        log(`入力できませんでした: ${jobUrl(id)}  ${err.message}`);
      }
    }
    if (!opened.length || argv.includes("--headless")) {
      if (!opened.length) log("入力できた応募画面はありません");
      await ctx.close();
      return;
    }
    log(`${opened.length} 件の応募画面を、入力した状態で開いています。送信はしていません。`);
    if (argv.includes("--approved")) log("金額・日数が空の欄は、画面で入れてください。送ったら `queue-mark sent 番号` で印を付けます");
    log("中身（提案文・金額・納期・源泉徴収のチェック）を確かめ、よければ自分で「応募する」を押してください。ブラウザを閉じると、このコマンドも終わります。");
    await new Promise((resolve) => ctx.on("close", resolve));
  } finally {
    clearInterval(touch);
    fs.rmSync(LOCK, { force: true });
  }
}

/** 検索画面のURLを足す（Edge で検索して新着順にした画面のURLを渡す）。設定のそれ以外は触らない。 */
function addSearch() {
  const url = argv[1];
  if (!url || !/^https:\/\/crowdworks\.jp\//.test(url)) die("使い方: node scripts/cw-patrol.mjs add-search <クラウドワークスの検索結果のURL>");
  const config = readJson(CONFIG, null);
  if (!config) die("まだ設定されていません。先に setup を実行してください");
  config.searchUrls = [...new Set([...(config.searchUrls ?? []), url])];
  writeJson(CONFIG, config);
  console.log(`検索画面を登録しました（全${config.searchUrls.length}件）`);
}

/**
 * 募集を1件ずつ読んで、判定の理由（納品の判定・関門・詐欺・AIの使用・報酬・依頼者）を、当たった語つきで出す。
 * 誤判定の見直し用。判定にAIは使わない。見るだけ・ゆっくり（巡回と同じ）。
 *   node scripts/cw-patrol.mjs explain 13537642 13539833 …
 */
async function explain() {
  const ids = argv.slice(1).filter((a) => !a.startsWith("--")).map((a) => jobIdFromUrl(a)).filter(Boolean);
  if (!ids.length) die("使い方: node scripts/cw-patrol.mjs explain <募集URLか番号>…（最大8件）");
  if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < 30 * 60_000) die("巡回が動いています。終わってからもう一度実行してください");
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(LOCK, String(process.pid));
  const touch = setInterval(() => fs.utimesSync(LOCK, new Date(), new Date()), 60_000);
  try {
    ensureBuilt();
    const { core } = loadLib();
    const { ctx, page } = await openBrowser({ headless: !argv.includes("--show") });
    try {
      for (const id of [...new Set(ids)].slice(0, 8)) {
        const url = jobUrl(id);
        try {
          const p = await readPage(page, url);
          if (isLoginPage(p.finalUrl)) die("ログインが切れています。setup でログインし直してください");
          const title = p.title.replace(/\s*[|｜].*$/, "").trim() || "（題名不明）";
          console.log(`\n${url}\n${core.explainJob(title, p.text)}`);
        } catch (e) {
          console.log(`\n${url}\n読めませんでした: ${e.message}`);
        }
        await politeWait();
      }
    } finally {
      await ctx.close();
    }
  } finally {
    clearInterval(touch);
    fs.rmSync(LOCK, { force: true });
  }
}

/**
 * 言葉から検索画面を作って登録する。Claude が作業して納品できる仕事は全部見る（Excel/VBA・品質に絞らない）。
 *   node scripts/cw-patrol.mjs add-keyword <言葉>… | --defaults | --list
 *   --defaults: 既定の言葉（文章・文字起こし・翻訳・データ・資料・Web・プログラミング・マニュアル・Excel）を全部
 * 登録する前に1度だけ開いて、募集が見つかった検索だけを登録する（見つからなければ URL の形が違うので、登録しないで知らせる）。
 */
async function addKeyword() {
  const config = readJson(CONFIG, null);
  if (!config) die("まだ設定されていません。先に setup を実行してください");
  if (argv.includes("--list")) {
    for (const g of WIDE_KEYWORDS) console.log(`${g.group}: ${g.words.join(" / ")}`);
    console.log(`\n登録済みの検索画面: ${(config.searchUrls ?? []).length}件`);
    for (const u of config.searchUrls ?? []) console.log(`- ${keywordOf(u) ?? "（言葉なし）"}  ${u}`);
    return;
  }
  const given = argv.slice(1).filter((a) => !a.startsWith("--"));
  const words = argv.includes("--defaults") ? WIDE_WORD_LIST : given;
  if (!words.length) die("使い方: node scripts/cw-patrol.mjs add-keyword <言葉>… | --defaults | --list");
  if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < 30 * 60_000) die("巡回が動いています。終わってからもう一度実行してください");
  const have = new Set((config.searchUrls ?? []).map((u) => keywordOf(u)).filter(Boolean));
  const todo = [...new Set(words)].filter((w) => !have.has(w));
  if (!todo.length) return console.log("すべて登録済みです");
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(LOCK, String(process.pid));
  const touch = setInterval(() => fs.utimesSync(LOCK, new Date(), new Date()), 60_000);
  try {
    ensureBuilt();
    const { core } = loadLib();
    const { ctx, page } = await openBrowser({ headless: !argv.includes("--show") });
    const added = [];
    const failed = [];
    try {
      for (const word of todo) {
        const url = searchUrlFrom(config.searchUrls, word);
        log(`検索を確かめています: ${word}`);
        try {
          const p = await readPage(page, url);
          if (isLoginPage(p.finalUrl)) die("ログインが切れています。setup でログインし直してください");
          const n = core.collectLinks(p.hrefs).jobs.length;
          if (n > 0) {
            config.searchUrls = [...new Set([...(config.searchUrls ?? []), url])];
            writeJson(CONFIG, config);
            added.push(`${word}（${n}件）`);
          } else {
            failed.push(`${word}（募集が見つかりません。0件の言葉か、検索画面のURLの形が違います: ${url}）`);
          }
        } catch (e) {
          failed.push(`${word}: ${e.message}`);
        }
        await politeWait();
      }
    } finally {
      await ctx.close();
    }
    console.log(`\n登録した検索: ${added.length}件\n${added.map((a) => `- ${a}`).join("\n")}`);
    if (failed.length) console.log(`\n登録しなかった検索: ${failed.length}件\n${failed.map((a) => `- ${a}`).join("\n")}`);
    console.log(`\n登録済みの検索画面は全${config.searchUrls.length}件です`);
  } finally {
    clearInterval(touch);
    fs.rmSync(LOCK, { force: true });
  }
}

/**
 * 募集の予算だけを集める（判定・応募はしない）。登録した検索画面の募集を、既読かどうかに関係なく読んで記録する。
 * Excel/VBA の案件の報酬が実際いくらかを、短時間で確かめるために使う。見るだけ・ゆっくり（巡回と同じ）。
 *   node scripts/cw-patrol.mjs survey [--max 30] [--fresh] [--show]
 *   --fresh: これまでの記録（budget-log.jsonl）を budget-log.old.jsonl に退避してから集める
 */
async function survey() {
  const config = readJson(CONFIG, null);
  if (!config?.searchUrls?.length) die("検索画面が登録されていません。add-search で登録してください");
  if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < 30 * 60_000) die("巡回が動いています。終わってからもう一度実行してください");
  const max = Math.min(Math.max(Number(optValue("max")) || 30, 1), 60);
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(LOCK, String(process.pid));
  const touch = setInterval(() => fs.utimesSync(LOCK, new Date(), new Date()), 60_000);
  try {
    ensureBuilt();
    const { core } = loadLib();
    if (argv.includes("--fresh") && fs.existsSync(BUDGET_LOG)) fs.renameSync(BUDGET_LOG, path.join(HOME, "budget-log.old.jsonl"));
    const { ctx, page } = await openBrowser({ headless: !argv.includes("--show") });
    const records = [];
    try {
      const urls = config.searchUrls.filter((u) => !/category_id=267\b/.test(u));
      const perSearch = [];
      for (const url of urls) {
        log(`検索結果を見ています: ${url}`);
        const p = await readPage(page, url);
        if (isLoginPage(p.finalUrl)) die("ログインが切れています。setup でログインし直してください");
        perSearch.push(core.collectLinks(p.hrefs).jobs);
        await politeWait();
      }
      const picked = core.pickJobsRoundRobin(perSearch, core.emptySeen(), max, Math.ceil(max / Math.max(urls.length, 1)));
      log(`${picked.length} 件の募集を読みます（1件ごとに間をあけます）`);
      for (const link of picked) {
        try {
          const p = await readPage(page, link.url);
          const title = p.title.replace(/\s*[|｜].*$/, "").trim() || "（題名不明）";
          const rec = core.budgetRecord(link, title, p.text);
          fs.appendFileSync(BUDGET_LOG, `${JSON.stringify(rec)}\n`);
          records.push(rec);
          const body = core.jobBodyForJudging(p.text, title).normalize("NFKC");
          const at = body.search(/(固定報酬制|時間単価制|コンペ形式|タスク形式)/);
          const pay = at >= 0 ? body.slice(at, at + 90).replace(/\s+/g, " ") : "（報酬の欄が見つかりません）";
          const client = core.readClientInfo(p.text);
          const meta = core.readJobMeta(p.text);
          const money = rec.hourlyJpy != null ? `時給${rec.hourlyJpy}〜${rec.hourlyMaxJpy}` : rec.budgetJpy != null ? `${rec.budgetJpy}〜${rec.budgetMaxJpy}` : "報酬不明";
          console.log(`- ${rec.payType} ${money}円 ${rec.delivers ? `[Claudeが納品可: ${rec.genre ?? "その他"}]` : "[納品できない/要確認]"}${rec.excelVba ? "[Excel/VBA]" : ""}${rec.quality ? "[品質]" : ""} ${title.slice(0, 40)}\n    ${link.url}\n    画面の表示: ${pay}\n    依頼者: ${client.tier}｜${client.summary}｜応募${meta.applicants ?? "?"}人・募集${meta.openings ?? "?"}人`);
        } catch (e) {
          log(`読めませんでした: ${link.url}  ${e.message}`);
        }
        await politeWait();
      }
    } finally {
      await ctx.close();
    }
    console.log(`\n${core.summarizeBudgets(records)}`);
  } finally {
    clearInterval(touch);
    fs.rmSync(LOCK, { force: true });
  }
}

/** 応募の下書き一覧を表示する（ゆうさんが後から見る用。queue.md にも同じものがある） */
function queueShow() {
  ensureBuilt();
  const { core } = loadLib();
  const state = readJson(QUEUE_JSON, core.emptyQueue());
  console.log(core.queueMarkdown(state));
}

/** 一覧の番号に印を付ける: queue-mark approved|sent|skipped 3 5 */
function queueMark() {
  const status = argv[1];
  const nos = argv.slice(2).map((a) => Number(a)).filter((n) => Number.isInteger(n) && n > 0);
  if (!["approved", "sent", "skipped"].includes(status) || !nos.length) die("使い方: node scripts/cw-patrol.mjs queue-mark approved|sent|skipped <番号> [<番号>…]");
  ensureBuilt();
  const { core } = loadLib();
  const r = core.markQueue(readJson(QUEUE_JSON, core.emptyQueue()), nos, status);
  writeJson(QUEUE_JSON, r.state);
  fs.writeFileSync(QUEUE_MD, core.queueMarkdown(r.state));
  console.log(`${status} にしました: ${r.changed.join("・") || "なし"}${r.missing.length ? `（一覧にない番号: ${r.missing.join("・")}）` : ""}`);
}

/**
 * 人が確かめて書き直した提案文つきで、募集を一覧に足す（ページを1回だけ読む。応募画面は開かない）。
 *   queue-add <募集URL> --proposal 提案文.txt [--verdict "応募してよい"] [--reason "理由"]
 * 同じ募集がすでに一覧にあるときは、提案文を差し替える。
 */
async function queueAdd() {
  const url = argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined;
  const id = url ? jobIdFromUrl(url) : null;
  const proposalFile = optValue("proposal");
  if (!id || !proposalFile) die("使い方: node scripts/cw-patrol.mjs queue-add <募集URL> --proposal 提案文.txt [--verdict \"応募してよい\"] [--reason \"理由\"]");
  const proposal = fs.readFileSync(path.resolve(proposalFile), "utf8").trim();
  if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < 30 * 60_000) die("巡回が動いています。終わってからもう一度実行してください");
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(LOCK, String(process.pid));
  try {
    ensureBuilt();
    const { core } = loadLib();
    const { ctx, page } = await openBrowser({ headless: !argv.includes("--show") });
    let p;
    try {
      p = await readPage(page, jobUrl(id));
    } finally {
      await ctx.close();
    }
    if (isLoginPage(p.finalUrl)) die("ログインが切れています。setup でログインし直してください");
    const title = p.title.replace(/\s*[|｜].*$/, "").trim() || "（題名不明）";
    const verdict = optValue("verdict") ?? "応募してよい";
    const item = core.buildQueueItem({
      link: { key: `job:${id}`, url: jobUrl(id) },
      applyUrl: applyUrl(id),
      title,
      pageText: p.text,
      judged: { verdict, detail: `理由: ${optValue("reason") ?? "人が確かめた提案文つき"}` },
      background: readBackground(),
      proposal,
    });
    let state = readJson(QUEUE_JSON, core.emptyQueue());
    // すでにあれば取り除いて足し直す（番号は新しくなる）
    state = { ...state, items: state.items.filter((i) => i.id !== item.id) };
    state = core.addToQueue(state, [item]);
    writeJson(QUEUE_JSON, state);
    fs.writeFileSync(QUEUE_MD, core.queueMarkdown(state));
    const added = state.items.find((i) => i.id === item.id);
    console.log(`一覧に足しました: 【${added.no}】${title}（依頼者: ${item.client.tier}・${item.client.summary}）`);
  } finally {
    fs.rmSync(LOCK, { force: true });
  }
}

/**
 * 一覧にあるのに提案文が空の件（または番号で指した件）に、提案文を作り直して入れる。番号と状態はそのまま。
 *   queue-redraft [番号…]      番号なしなら、提案文が空の「一覧」の件すべて
 * 募集のページを読み直して判定をやり直す（応募画面は開かない・送信しない）。
 */
async function queueRedraft() {
  ensureBuilt();
  const { core } = loadLib();
  const state0 = readJson(QUEUE_JSON, core.emptyQueue());
  const nos = argv.slice(1).filter((a) => /^[0-9]+$/.test(a)).map(Number);
  const picked = state0.items.filter((i) => i.status === "pending" && (nos.length ? nos.includes(i.no) : !core.cleanProposal(i.proposal)));
  // 提案文が入っている件は、人や前の判定が整えたものを上書きしてしまわないよう、--force のときだけ作り直す
  const targets = argv.includes("--force") ? picked : picked.filter((i) => !core.cleanProposal(i.proposal));
  for (const i of picked) if (!targets.includes(i)) console.log(`- 【${i.no}】提案文が入っているので作り直しません（作り直すなら --force）`);
  if (!targets.length) {
    console.log("提案文を作り直す件はありません");
    return;
  }
  if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < 30 * 60_000) die("巡回が動いています。終わってからもう一度実行してください");
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(LOCK, String(process.pid));
  try {
    const pages = [];
    const { ctx, page } = await openBrowser({ headless: !argv.includes("--show") });
    try {
      for (const t of targets) {
        const p = await readPage(page, t.url);
        if (isLoginPage(p.finalUrl)) die("ログインが切れています。setup でログインし直してください");
        pages.push({ t, p, title: p.title.replace(/\s*[|｜].*$/, "").trim() || t.title });
        await politeWait();
      }
    } finally {
      await ctx.close();
    }
    // 判定はブラウザを閉じてから（メモリのため）
    let state = readJson(QUEUE_JSON, core.emptyQueue());
    for (const { t, p, title } of pages) {
      log(`提案文を作り直しています: ${title}`);
      const j = judgeJob(core.jobBodyForJudging(p.text, title), title, t.url);
      const item = core.buildQueueItem({
        link: { key: `job:${t.id}`, url: t.url },
        applyUrl: t.applyUrl,
        title,
        pageText: p.text,
        judged: { verdict: j.verdict, detail: j.detail },
        background: readBackground(),
      });
      const reasonLine = j.detail.match(/^理由: (.+)$/m)?.[1] ?? "";
      if (/^見送り/.test(j.verdict) || /^見送り/.test(item.verdict)) {
        // 今のルールと再判定で見送りになった。一覧から外し、理由(ルールが見つけたこと＋Claudeの理由)を「見送りにした案件」に載せる
        const ruleNote = item.checks.filter((c) => !c.startsWith("提案文")).slice(0, 4).join(" / ");
        const why = [ruleNote, reasonLine ? `Claudeの判定: ${reasonLine}` : ""].filter(Boolean).join(" ｜ ");
        state = { ...state, items: state.items.map((i) => (i.id === t.id ? { ...i, status: "skipped", skipReason: why.slice(0, 400) || "再判定で見送り" } : i)) };
        console.log(`- 【${t.no}】${title.slice(0, 40)}: 見送りにしました\n    理由: ${why}`);
        continue;
      }
      state = { ...state, items: state.items.map((i) => (i.id === t.id ? { ...item, no: i.no, status: i.status } : i)) };
      console.log(`- 【${t.no}】${title.slice(0, 40)}: ${core.cleanProposal(item.proposal) ? "提案文を入れました" : "提案文は出ませんでした（判定: " + j.verdict + (reasonLine ? "。理由: " + reasonLine : "") + "）"}`);
    }
    writeJson(QUEUE_JSON, state);
    fs.writeFileSync(QUEUE_MD, core.queueMarkdown(state));
  } finally {
    fs.rmSync(LOCK, { force: true });
  }
}

/**
 * 一覧の件の提案文を、ファイルの文に差し替える（番号と状態は変わらない。募集ページは読まない）。
 *   queue-set <番号> --proposal 提案文.txt
 */
function queueSet() {
  const no = Number(argv[1]);
  const file = optValue("proposal");
  if (!Number.isInteger(no) || !file) die("使い方: node scripts/cw-patrol.mjs queue-set <番号> --proposal 提案文.txt");
  ensureBuilt();
  const { core } = loadLib();
  const state = readJson(QUEUE_JSON, core.emptyQueue());
  const target = state.items.find((i) => i.no === no);
  if (!target) die(`一覧に【${no}】がありません`);
  const text = fs.readFileSync(path.resolve(file), "utf8").trim();
  const next = { ...state, items: state.items.map((i) => (i.no === no ? core.setProposal(i, text, readBackground()) : i)) };
  writeJson(QUEUE_JSON, next);
  fs.writeFileSync(QUEUE_MD, core.queueMarkdown(next));
  const done = next.items.find((i) => i.no === no);
  console.log(`【${no}】の提案文を差し替えました（${done.proposal.length}字）。提案文に関する注意: ${done.checks.filter((c) => c.startsWith("提案文")).join(" / ") || "なし"}`);
}

/**
 * 募集ページを読んで、判定に渡す本文（メニュー・依頼者欄を除いたもの）をそのまま表示する。読むだけ・ゆっくり。
 *   page <募集IDまたはURL>… [--max 4000]
 * 提案文を人（または別の会話）が書くときに、募集の中身を確かめる用。
 */
async function pageShow() {
  const ids = argv.slice(1).filter((a) => !a.startsWith("--") && !/^[0-9]{1,5}$/.test(a)).map((a) => jobIdFromUrl(a)).filter(Boolean);
  if (!ids.length) die("使い方: node scripts/cw-patrol.mjs page <募集IDまたはURL>… [--max 4000]");
  const max = Number(optValue("max")) || 4000;
  if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < 30 * 60_000) die("巡回が動いています。終わってからもう一度実行してください");
  ensureBuilt();
  const { core } = loadLib();
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(LOCK, String(process.pid));
  try {
    const { ctx, page } = await openBrowser({ headless: !argv.includes("--show") });
    try {
      for (const id of ids) {
        const p = await readPage(page, jobUrl(id));
        if (isLoginPage(p.finalUrl)) die("ログインが切れています。setup でログインし直してください");
        const title = p.title.replace(/\s*[|｜].*$/, "").trim() || "（題名不明）";
        console.log(`\n===== ${id} ${title}\n${jobUrl(id)}\n${core.jobBodyForJudging(p.text, title).slice(0, max)}`);
        await politeWait();
      }
    } finally {
      await ctx.close();
    }
  } finally {
    fs.rmSync(LOCK, { force: true });
  }
}

/** 記録した募集の予算をまとめて表示する */
function budgets() {
  ensureBuilt();
  let text = "";
  try {
    text = fs.readFileSync(BUDGET_LOG, "utf8");
  } catch {
    console.log("まだ記録がありません（巡回で募集を読むと貯まります）");
    return;
  }
  const records = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  console.log(loadLib().core.summarizeBudgets(records));
}

const commands = { setup, run, fill, "add-search": addSearch, "add-keyword": addKeyword, explain, budgets, survey, queue: queueShow, "queue-mark": queueMark, "queue-add": queueAdd, "queue-redraft": queueRedraft, "queue-set": queueSet, page: pageShow, schedule: () => registerSchedule(), "test-mail": () => testMail() };
if (!commands[cmd]) {
  console.log("使い方: node scripts/cw-patrol.mjs setup | run [--always] [--show] | fill <募集URL> --proposal 提案文.txt [--price 金額] [--days 日数] | fill --list 一覧.tsv | add-search <検索結果のURL> | budgets | survey [--max 30] [--fresh] | queue | queue-add <募集URL> --proposal 提案文.txt | queue-redraft [番号…] [--force] | queue-set <番号> --proposal 提案文.txt | page <募集ID>… | queue-mark approved|sent|skipped 番号… | fill --approved | schedule | test-mail");
  process.exit(cmd ? 1 : 0);
}
await commands[cmd]();
