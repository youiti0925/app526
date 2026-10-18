// クラウドワークス巡回の、通信しない部分と、メール送信の手順（偽のサーバー相手）。
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { classifyLink, collectLinks, newJobs, emptySeen, buildReport, budgetRecord, summarizeBudgets, jobBodyForJudging, pickJobsRoundRobin, buildMimeMessage, encodeHeader, threadFingerprint } from "../../dist-test/jobs/patrol-core.js";
import { parseCwThreads, reviewCwThread } from "../../dist-test/jobs/cw-thread.js";
import { sendMail } from "../../scripts/lib/smtp.mjs";

test("リンクを募集・やり取り・それ以外に分ける", () => {
  assert.equal(classifyLink("https://crowdworks.jp/public/jobs/13523505")?.key, "job:13523505");
  assert.equal(classifyLink("/public/jobs/13523505/")?.kind, "job");
  assert.equal(classifyLink("https://crowdworks.jp/messages/431869828?ref=x")?.key, "messages:431869828");
  assert.equal(classifyLink("https://crowdworks.jp/proposals/123")?.kind, "thread");
  assert.equal(classifyLink("https://crowdworks.jp/public/jobs/search?order=new"), null);
  assert.equal(classifyLink("https://evil.example/public/jobs/1"), null);
  const { jobs, threads } = collectLinks(["/public/jobs/1", "/public/jobs/1", "/messages/2", "/help"]);
  assert.equal(jobs.length, 1);
  assert.equal(threads.length, 1);
});

test("判定済みの募集は二度判定しない", () => {
  const seen = emptySeen();
  seen.jobs["job:1"] = "x";
  const out = newJobs(collectLinks(["/public/jobs/1", "/public/jobs/2", "/public/jobs/3"]).jobs, seen, 1);
  assert.deepEqual(out.map((l) => l.key), ["job:2"]);
});

const THREAD = `相談から契約まで：テスト募集
※現在やりとりしているメッセージは、契約終了後2年間経過すると自動的に削除されます。

taro_test
2026年10月05日 20:10
応募します。

問題報告
client_x
2026年10月06日 09:00
詳細はこちらへ https://lin.ee/abc
`;

test("まとめ: 返事が要る・危険・新着候補を並べ、新しいことが無ければ送らない", () => {
  const review = reviewCwThread(parseCwThreads(THREAD, "taro_test")[0], new Date("2026-10-08T00:00:00+09:00"));
  const r = buildReport({
    threads: [{ review, url: "https://crowdworks.jp/messages/1", changed: true }],
    jobs: [
      { title: "良い募集", url: "https://crowdworks.jp/public/jobs/9", verdict: "応募してよい", detail: "結論: 応募してよい\n--- 提案文 ---\n本文" },
      { title: "安い募集", url: "https://crowdworks.jp/public/jobs/8", verdict: "見送り", detail: "結論: 見送り" },
    ],
    errors: [],
    loginExpired: false,
  });
  assert.ok(r.subject.includes("今やること 1件") && r.subject.includes("応募候補 1件"));
  assert.ok(r.body.startsWith("【結論】今やること 1件"));
  assert.ok(r.body.includes("良い募集") && r.body.includes("本文"));
  // LINE誘導の相手は「返事をしなくてよい」側に、理由つきで1行
  assert.ok(r.body.includes("返事をしなくてよい相手 1件"));
  // 見送りの募集も、題名と理由を1行ずつ出す
  assert.ok(r.body.includes("見送り：安い募集"));
  assert.ok(r.body.includes("送信はしません"));
  assert.equal(r.worthSending, true);

  const quiet = buildReport({ threads: [{ review, url: "u", changed: false }], jobs: [], errors: [], loginExpired: false });
  assert.equal(quiet.worthSending, false);
  assert.ok(threadFingerprint(review).startsWith("2|client_x|"));
});

test("ログインが切れたら、それだけを知らせる", () => {
  const r = buildReport({ threads: [], jobs: [], errors: [], loginExpired: true });
  assert.ok(r.subject.includes("ログインが切れました"));
  assert.equal(r.worthSending, true);
});

test("メール: 日本語の件名と本文を壊さずに組み立てる", () => {
  assert.equal(encodeHeader("abc"), "abc");
  const enc = encodeHeader("【CW巡回】");
  assert.ok(enc.startsWith("=?UTF-8?B?"));
  assert.equal(Buffer.from(enc.slice(10, -2), "base64").toString("utf8"), "【CW巡回】");
  const msg = buildMimeMessage({ from: "a@example.com", to: "a@example.com", subject: "件名", body: "一行目\n二行目" });
  const [head, body] = msg.split("\r\n\r\n");
  assert.ok(head.includes("Content-Transfer-Encoding: base64"));
  assert.equal(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8"), "一行目\r\n二行目");
});

test("SMTP: 決まった順にやり取りして1通送る（偽のサーバー）", async () => {
  const got = [];
  let data = "";
  const server = net.createServer((s) => {
    s.setEncoding("utf8");
    let inData = false;
    s.write("220 fake\r\n");
    let buf = "";
    s.on("data", (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            s.write("250 queued\r\n");
          } else data += line + "\n";
          continue;
        }
        got.push(line.split(" ")[0]);
        if (line.startsWith("EHLO")) s.write("250-fake\r\n250 AUTH PLAIN\r\n");
        else if (line.startsWith("AUTH PLAIN")) {
          const [, user, pass] = Buffer.from(line.slice(11), "base64").toString().split("\0");
          s.write(user === "me@example.com" && pass === "pw" ? "235 ok\r\n" : "535 bad\r\n");
        } else if (line.startsWith("MAIL") || line.startsWith("RCPT")) s.write("250 ok\r\n");
        else if (line === "DATA") {
          inData = true;
          s.write("354 go\r\n");
        } else if (line === "QUIT") s.end("221 bye\r\n");
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const connect = () => net.connect(port, "127.0.0.1");
  try {
    await sendMail({ user: "me@example.com", pass: "pw", to: "me@example.com", message: "Subject: x\r\n\r\n.dot line", connect });
    assert.deepEqual(got, ["EHLO", "AUTH", "MAIL", "RCPT", "DATA", "QUIT"]);
    assert.ok(data.includes("..dot line"));
    await assert.rejects(
      sendMail({ user: "me@example.com", pass: "wrong", to: "me@example.com", message: "x", connect }),
      /アプリ パスワード/
    );
  } finally {
    server.close();
  }
});

test("まとめ: 公開募集の応募候補があれば、結論の件数に足し、提案文を載せて送る", () => {
  const r = buildReport({
    threads: [],
    jobs: [],
    errors: [],
    loginExpired: false,
    scan: { candidates: 2, body: "1. 応募してよい｜データ入力\n―――― 提案文（01.txt）\nはじめまして" },
  });
  assert.ok(r.body.startsWith("【結論】今やること 2件（公開募集の応募を考える 2件）"));
  assert.ok(r.body.includes("はじめまして"));
  assert.ok(r.subject.includes("応募候補 2件"));
  assert.equal(r.worthSending, true);
  const none = buildReport({ threads: [], jobs: [], errors: [], loginExpired: false, scan: { candidates: 0, body: "" } });
  assert.equal(none.worthSending, false);
  assert.ok(none.body.startsWith("【結論】今やることはありません"));
});

test("予算の記録: Excel/VBA・品質の言葉と報酬の幅を読み、中央値などをまとめる", () => {
  const a = budgetRecord({ key: "job:1", url: "u1" }, "Excel VBAで検査成績書を自動化", "固定報酬制\n報酬\n20,000円 〜 40,000円\n品質管理の現場", new Date("2026-10-18T00:00:00Z"));
  assert.equal(a.excelVba, true);
  assert.equal(a.quality, true);
  assert.equal(a.budgetJpy, 20000);
  assert.equal(a.budgetMaxJpy, 40000);
  assert.equal(a.payType, "固定報酬");
  const b = budgetRecord({ key: "job:2", url: "u2" }, "スプレッドシートの集計", "固定報酬制 報酬 5,000円", new Date());
  const c = budgetRecord({ key: "job:3", url: "u3" }, "データ入力", "固定報酬制 報酬 3,000円", new Date());
  const text = summarizeBudgets([a, b, c, a]);
  assert.ok(text.includes("募集の予算の記録（3件）"));
  assert.ok(text.includes("Excel/VBA・マクロ・スプレッドシート: 2件") && text.includes("中央値 12,500円") && text.includes("上限が2万円以上 1件"));
  assert.ok(summarizeBudgets([]).includes("記録なし"));
});

test("予算の記録: おすすめ欄のExcelは数えず、時給は固定報酬と分け、上限<下限は読まない", () => {
  const filler = "3DCG動画の制作をお願いします。".repeat(30);
  const page = `固定報酬制\n報酬 30,000円\n${filler}\nクライアント情報\nおすすめの仕事\nExcel VBA マクロ スプレッドシート 品質管理 検査`;
  const a = budgetRecord({ key: "job:10", url: "u" }, "3DCG動画の制作", page);
  assert.equal(a.excelVba, false);
  assert.equal(a.quality, false);
  assert.equal(a.budgetJpy, 30000);
  // 本文に1回だけ出る飾りの語は数えない。題名に出る・本文に2回以上出る募集は数える
  assert.equal(budgetRecord({ key: "job:11", url: "u" }, "資料作成", "固定報酬制 報酬 10,000円 Excelが使える方歓迎").excelVba, false);
  assert.equal(budgetRecord({ key: "job:12", url: "u" }, "資料作成", "固定報酬制 報酬 10,000円 Excelで表を作り、Excelで集計します").excelVba, true);
  const h = budgetRecord({ key: "job:13", url: "u" }, "スプレッドシートの関数でレポート構築", "時間単価制\n時給\n1,500円 〜 2,000円\n週10時間");
  assert.equal(h.payType, "時間単価");
  assert.equal(h.budgetJpy, null);
  assert.equal(h.hourlyJpy, 1500);
  assert.equal(h.hourlyMaxJpy, 2000);
  const task = budgetRecord({ key: "job:14", url: "u" }, "地方創生マネージャー", "タスク形式\n報酬 3,000円");
  assert.equal(task.payType, "タスク");
  assert.equal(task.budgetJpy, null);
  const bad = budgetRecord({ key: "job:15", url: "u" }, "集計", "固定報酬制 報酬 100,000円 〜 3,000円");
  assert.equal(bad.budgetJpy, null);
  const text = summarizeBudgets([h, task, bad, a]);
  assert.ok(text.includes("時給の募集 1件（時給の下限の中央値 1,500円）"));
});

test("判定に渡す本文: 依頼者欄・おすすめ・ページ下部の定型文を落とす", () => {
  const body = "紙資料をExcelへ入力します。".repeat(30);
  const page = `${body}\nクライアント情報\n本人確認未提出\nおすすめの仕事\nアンケート\n個人情報保護方針`;
  const out = jobBodyForJudging(page);
  assert.ok(out.includes("Excelへ入力"));
  assert.ok(!out.includes("本人確認") && !out.includes("個人情報保護方針") && !out.includes("アンケート"));
});

test("募集の選び方: 検索ごとに交互に取り、1つの検索で枠が埋まらない", () => {
  const mk = (n, a) => Array.from({ length: n }, (_, i) => ({ kind: "job", key: `job:${a}${i}`, url: `u${a}${i}` }));
  const picked = pickJobsRoundRobin([mk(10, "a"), mk(10, "b"), mk(10, "c")], emptySeen(), 10);
  assert.equal(picked.length, 9);
  assert.deepEqual(picked.slice(0, 3).map((l) => l.key), ["job:a0", "job:b0", "job:c0"]);
});
