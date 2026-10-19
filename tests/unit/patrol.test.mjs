// クラウドワークス巡回の、通信しない部分と、メール送信の手順（偽のサーバー相手）。
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { ruleChecks, setProposal, proposalChecks, cleanProposal, unbackedSkillClaims, classifyLink, collectLinks, newJobs, emptySeen, buildReport, budgetRecord, summarizeBudgets, reachLines, clientRank, explainJob, jobBodyForJudging, pickJobsRoundRobin, readClientInfo, readJobMeta, extractProposal, buildQueueItem, addToQueue, markQueue, sortQueue, emptyQueue, queueMarkdown, buildMimeMessage, encodeHeader, threadFingerprint, inboxRowInfo, selectInboxRows, messageNotes } from "../../dist-test/jobs/patrol-core.js";
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
  assert.ok(none.body.includes("公開募集（ココナラ・ままワークス）: 今回は応募候補なし"));
  assert.ok(!buildReport({ threads: [], jobs: [], errors: [], loginExpired: false, scan: null }).body.includes("今回は応募候補なし"));
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
  assert.equal(budgetRecord({ key: "job:12", url: "u" }, "資料作成", "固定報酬制 報酬 10,000円 Excelで表を作り、Excelで集計し、Excelでグラフにします").excelVba, false, "本文に数回出るだけでは当たりにしない");
  assert.equal(budgetRecord({ key: "job:12", url: "u" }, "資料作成", "固定報酬制 報酬 10,000円 資料を作ります。必要なスキル Excel VBA 関数").excelVba, true, "必要なスキルに出ていれば当たり");
  assert.equal(budgetRecord({ key: "job:12", url: "u" }, "資料作成", `固定報酬制 報酬 10,000円 ${"Excelで集計します。".repeat(6)}`).excelVba, true, "本文に何度も出る募集は当たり");
  assert.equal(budgetRecord({ key: "job:16", url: "u" }, "公務員試験の講師", "固定報酬制 ワーカーと相談する 必要なスキル 法律 数学 マクロ経済 ミクロ経済 マクロ経済学").excelVba, false, "マクロ経済はExcelのマクロではない");
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
  // 金額は支払い方式の表示のすぐ後ろだけから読む（本文の別の金額・相談・文字単価・小さなタスクを拾わない）
  const pick = (title, body) => budgetRecord({ key: `job:${title}`, url: "u" }, title, `${body}\n${"仕事の説明です。".repeat(40)}\nクライアント情報`);
  assert.equal(pick("相談", "固定報酬制 ワーカーと相談する\n報酬の目安 1,537円").budgetJpy, null);
  assert.equal(pick("文字単価", "固定報酬制 1.1円（文字単価）・900文字・10記事").budgetJpy, null);
  assert.equal(pick("本文の別の数字", "固定報酬制 12円\n時給換算で1,537円になります").budgetJpy, 12);
  assert.equal(pick("支払い方式なし", "アンケートです。謝礼 500円").budgetJpy, null);
  const small = pick("小さなタスク", "固定報酬制 12円");
  const text = summarizeBudgets([h, task, bad, a, small]);
  assert.ok(text.includes("すべて: 5件（報酬が読めた固定報酬 1件"), text);
  assert.ok(text.includes("時給の募集 1件（時給の下限の中央値 1,500円）"));
});

test("支払い方式は、題名の「(時間単価制)の仕事」ではなく、金額のすぐ前の表示から読む", () => {
  const page = `スプレッドシートの関数でレポート構築(時間単価制)の仕事・求人【フルリモート】\n仕事の概要\n時間単価制 1,500円 〜 2,000円\n稼働時間/週 10時間/週\n${"本文です。".repeat(60)}\nクライアント情報`;
  const r = budgetRecord({ key: "job:20", url: "u" }, "スプレッドシートの関数でレポート構築", page);
  assert.equal(r.payType, "時間単価");
  assert.equal(r.hourlyJpy, 1500);
  assert.equal(r.hourlyMaxJpy, 2000);
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

// --- 依頼者の信頼度・応募の下書き一覧（本物の画面の並びで）-----------------------------------

const clientPage = (c, meta = "応募した人 56 人 契約した人 0 人 募集人数 1 人 気になる！リスト 12 人\n応募期限\n2026年10月30日") =>
  `固定報酬制 20,000円 〜 30,000円\n${meta}\n${"仕事の説明です。".repeat(40)}\nクライアント情報\nフォローする\n○○\n${c}\n○○の詳細を見る\nおすすめの仕事\nアンケート`;

test("依頼者の欄を読む: 募集実績が多く評価・完了率が高ければ優良", () => {
  const c = readClientInfo(clientPage("ありがとう 137 件\n本人確認済み\n発注ルールチェック未回答\n総合評価 4.7\n募集実績 375 件\nプロジェクト完了率 89 %\nマーケティングエージェンシー"));
  assert.equal(c.orders, 375);
  assert.equal(c.rating, 4.7);
  assert.equal(c.completionRate, 89);
  assert.equal(c.thanks, 137);
  assert.equal(c.identity, "済");
  assert.equal(c.tier, "優良");
  assert.ok(c.summary.includes("募集実績375件") && c.summary.includes("本人確認済み"));
  assert.ok(!c.raw.includes("おすすめの仕事"), "おすすめ欄は含めない");
});

test("依頼者の欄を読む: 実績が1件で評価なしは初めて、完了率が低めは優良にしない、評価が低ければ注意", () => {
  const first = readClientInfo(clientPage("ありがとう 0 件\n本人確認未提出\n発注ルールチェック未回答\n総合評価 -\n募集実績 1 件\nプロジェクト完了率 -"));
  assert.equal(first.tier, "初めて");
  assert.equal(first.rating, null);
  assert.equal(first.completionRate, null);
  assert.equal(first.identity, "未提出");
  const mid = readClientInfo(clientPage("ありがとう 12 件\n本人確認未提出\n総合評価 5.0\n募集実績 19 件\nプロジェクト完了率 64 %"));
  assert.equal(mid.tier, "普通");
  const bad = readClientInfo(clientPage("ありがとう 3 件\n本人確認済み\n総合評価 2.9\n募集実績 40 件\nプロジェクト完了率 80 %"));
  assert.equal(bad.tier, "注意");
  assert.equal(readClientInfo("依頼者の欄がない文章").tier, "不明");
});

test("募集の状況を読む: 応募人数・募集人数・応募期限", () => {
  const m = readJobMeta(clientPage("総合評価 4.7"));
  assert.deepEqual(m, { applicants: 56, openings: 1, deadline: "2026年10月30日" });
  assert.deepEqual(readJobMeta("何もない"), { applicants: null, openings: null, deadline: null });
});

test("判定の出力から提案文だけを取り出す", () => {
  const detail = "結論: 応募してよい\n理由: 実効時給 1,170円\n\n--- 提案文 ---\n募集を拝見しました。\nよろしくお願いします。\n\n※ 経歴が未登録です\n\n使ったAI: sonnet 3回";
  assert.equal(extractProposal(detail), "募集を拝見しました。\nよろしくお願いします。");
  assert.equal(extractProposal("提案文なし"), "");
});

test("応募の下書き一覧: 依頼者の信頼度順・要確認の印と注意を出し、承認した件だけ承認済みにする", () => {
  const mk = (id, title, client, extra = {}) =>
    buildQueueItem({
      link: { key: `job:${id}`, url: `https://crowdworks.jp/public/jobs/${id}` },
      applyUrl: `https://crowdworks.jp/proposals/new?job_offer_id=${id}`,
      title,
      pageText: clientPage(client, extra.meta),
      judged: { verdict: extra.verdict ?? "応募してよい", detail: `理由: テスト\n\n--- 提案文 ---\n${extra.proposal ?? "はじめまして"}\n\n使ったAI: x` },
    });
  const first = mk("1", "初めての依頼者の仕事", "総合評価 -\n募集実績 1 件\nプロジェクト完了率 -");
  const good = mk("2", "何度も発注している依頼者の仕事", "本人確認済み\n総合評価 4.8\n募集実績 80 件\nプロジェクト完了率 95 %", { proposal: "経験は【要確認: 年数】です" });
  const bad = mk("3", "評価の低い依頼者の仕事", "総合評価 2.5\n募集実績 30 件\nプロジェクト完了率 90 %");
  assert.equal(bad.verdict, "確認してから応募", "注意の依頼者は、応募してよいを確認してから応募に下げる");
  assert.ok(good.checks.some((c) => c.includes("【要確認】が1か所")));
  assert.ok(good.checks.some((c) => c.includes("応募56人")));
  assert.equal(good.price, 20000);

  let q = addToQueue(emptyQueue(), [first, good, bad]);
  assert.deepEqual(q.items.map((i) => i.no), [1, 2, 3]);
  q = addToQueue(q, [first]);
  assert.equal(q.items.length, 3, "同じ募集は足さない");
  assert.deepEqual(sortQueue(q.items).map((i) => i.id), ["2", "1", "3"], "優良 → 初めて → 注意");

  const m = markQueue(q, [2, 9], "approved");
  assert.deepEqual(m.changed, [2]);
  assert.deepEqual(m.missing, [9]);
  const md = queueMarkdown(m.state, new Date("2026-10-19T00:00:00Z"));
  assert.ok(md.includes("「承認 3 5」のように"));
  assert.ok(md.includes("一覧 2件／承認済み 1件"));
  assert.ok(!md.includes("待ち"), "一覧に「待ち」と書かない");
  assert.ok(md.includes("| 番号 | 案件 | 報酬 | 応募期限 | 依頼者 | AI禁止 | 判定 |"));
  assert.ok(md.indexOf("初めての依頼者") < md.indexOf("評価の低い依頼者"));
  assert.ok(md.includes("proposals/new?job_offer_id=2"));
  // 3週間たった未承認は外れ、承認済みは残る
  const old = addToQueue(m.state, [], new Date("2026-12-01T00:00:00Z"));
  assert.deepEqual(old.items.map((i) => i.id), ["2"]);
});

test("予算の記録: Claude が納品できる募集かと仕事の種類を、Excel に限らず記録する", () => {
  const article = budgetRecord(
    { key: "job:21", url: "u" },
    "【在宅】美容ブログ記事の作成（SEO）",
    "固定報酬制 報酬 6,000円\nSEOを意識したブログ記事を3本、各2000字で書いてください。キーワードは別途お渡しします。"
  );
  assert.equal(article.delivers, true);
  assert.equal(article.genre, "文章・文書");
  const py = budgetRecord({ key: "job:22", url: "u" }, "Pythonでスクレイピングツールの開発", "固定報酬制 報酬 30,000円\nPythonで価格を取得するスクリプトを作ってください。");
  assert.equal(py.delivers, true);
  assert.equal(py.genre, "コード・スクリプト");
  // 納品できないもの（電話・撮影）や、AIの利用を禁止しているものは、納品できる側に数えない
  const phone = budgetRecord({ key: "job:23", url: "u" }, "コールセンター業務", "固定報酬制 報酬 5,000円\nお客様への電話対応をお願いします。");
  assert.equal(phone.delivers, false);
  assert.equal(phone.genre, null);
  // AIの使用禁止は見送りにせず、納品できる側に数えたうえで印を付ける（ゆうさんが範囲を見て決める）
  const noAi = budgetRecord({ key: "job:24", url: "u" }, "ブログ記事の執筆", "固定報酬制 報酬 6,000円\nブログ記事を書いてください。ChatGPTなどの生成AIの使用は禁止です。");
  assert.equal(noAi.delivers, true);
  assert.equal(noAi.aiRestricted, true);
  assert.equal(article.aiRestricted, false);

  const text = summarizeBudgets([article, py, phone, noAi]);
  assert.match(text, /Claudeが納品できる募集: 3件 \/ 判定した4件/);
  assert.match(text, /文章・文書/);
  assert.match(text, /コード・スクリプト/);
});

test("判定の順番: 発注の多い依頼者（優良）の募集が先", () => {
  const good = "仕事の内容\nクライアント情報\nありがとう 20 件\n本人確認 済み\n総合評価 4.8\n募集実績 120 件\nプロジェクト完了率 95 %\n○○の詳細を見る";
  const first = "仕事の内容\nクライアント情報\nありがとう 0 件\n本人確認 済み\n総合評価 -\n募集実績 0 件\nプロジェクト完了率 -\n○○の詳細を見る";
  assert.ok(clientRank(good) < clientRank(first));
});

test("月の目標に何件要るか: 納品できる固定報酬の中央値から、手数料を引いて出す（件数が少ないうちは出さない）", () => {
  const rec = (n, budgetJpy, payType = "固定報酬", hourlyJpy = null) => ({
    at: "2026-10-19T00:00:00Z", key: `job:${n}`, title: "t", url: "u", budgetJpy, budgetMaxJpy: budgetJpy, hourlyJpy, hourlyMaxJpy: hourlyJpy,
    excelVba: false, quality: false, payType, delivers: true, genre: "文章・文書",
  });
  assert.deepEqual(reachLines([rec(1, 5000), rec(2, 5000)]), []);
  // 中央値5,000円 → 手取り3,900円 → 20万円には月52件（週13件）
  const lines = reachLines([1, 2, 3, 4, 5].map((n) => rec(n, 5000)));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /月20万円の目安/);
  assert.match(lines[0], /手取り約3,900円/);
  assert.match(lines[0], /月52件（週13件）/);
  assert.match(lines[0], /仮に10%なら、週130件の応募/);
  // 時給の募集は稼働時間で見る（時給1,500円 → 手取り1,170円 → 月171時間）
  const h = reachLines([1, 2, 3].map((n) => rec(n, null, "時間単価", 1500)));
  assert.match(h[0], /手取り約1,170円/);
  assert.match(h[0], /月171時間/);
});

test("応募の下書き一覧: AIの使用が禁止された募集は、禁止の範囲を載せ、「応募してよい」を「確認してから応募」に下げる", () => {
  const page = "固定報酬制 報酬 6,000円\nブログ記事を3本書いてください。ChatGPTなどの生成AIの使用は禁止です。\nクライアント情報\nありがとう 20 件\n本人確認 済み\n総合評価 4.8\n募集実績 120 件\nプロジェクト完了率 95 %\n○○の詳細を見る";
  const item = buildQueueItem({
    link: { key: "job:31", url: "https://crowdworks.jp/public/jobs/31" },
    applyUrl: "https://crowdworks.jp/proposals/new?job_offer_id=31",
    title: "ブログ記事の執筆",
    pageText: page,
    judged: { verdict: "応募してよい", detail: "結論: 応募してよい\n--- 提案文 ---\nはじめまして。記事を書きます。" },
  });
  assert.equal(item.verdict, "確認してから応募");
  assert.match(item.aiRestriction, /AI禁止あり/);
  assert.match(item.checks[0], /手でやれるか/);
  const text = queueMarkdown(addToQueue(emptyQueue(), [item]));
  assert.match(text, /〔AI禁止あり〕/);
  assert.match(text, /- AIの使用: AI禁止あり（全面に見えます）: 「ChatGPTなどの生成AIの使用は禁止です。」/);

  // 禁止が書かれていない募集には、何も足さない
  const plain = buildQueueItem({
    link: { key: "job:32", url: "https://crowdworks.jp/public/jobs/32" },
    applyUrl: "x",
    title: "記事",
    pageText: "固定報酬制 報酬 6,000円\nブログ記事を3本書いてください。",
    judged: { verdict: "応募してよい", detail: "結論: 応募してよい\n--- 提案文 ---\nはじめまして。" },
  });
  assert.equal(plain.aiRestriction, undefined);
  assert.equal(plain.verdict, "応募してよい");
});

test("文字単価の募集: 画面の「契約金額(目安)」を金額として読む（確定ではないと分かるように）", () => {
  const page = "固定報酬制 1.2円（文字単価）\n契約金額(目安): 1,320円\nブログ記事を書いてください（1,100字）。";
  const r = budgetRecord({ key: "job:41", url: "u" }, "ブログ記事（1,000字）", page);
  assert.equal(r.budgetJpy, 1320);
  assert.equal(r.budgetEstimated, true);
  // 全角のかっこ・改行をはさんだ形でも読む
  assert.equal(budgetRecord({ key: "job:42", url: "u" }, "t", "固定報酬制 0.8円\n契約金額（目安）\n40,000円\n記事").budgetJpy, 40000);
  // 目安が無く「相談」だけなら、金額は読まない
  const talk = budgetRecord({ key: "job:43", url: "u" }, "t", "固定報酬制 1.0円（文字単価）ワーカーと相談\n記事を書いてください");
  assert.equal(talk.budgetJpy, null);
  assert.equal(talk.budgetEstimated, undefined);
  // 普通の固定報酬は従来どおり（目安扱いにしない）
  const fixed = budgetRecord({ key: "job:44", url: "u" }, "t", "固定報酬制 5,000円\n記事を書いてください");
  assert.equal(fixed.budgetJpy, 5000);
  assert.equal(fixed.budgetEstimated, undefined);

  // 一覧: 目安の金額は応募画面に自動で入れない（price なし）。確かめる注意を付ける
  const item = buildQueueItem({
    link: { key: "job:41", url: "https://crowdworks.jp/public/jobs/41" },
    applyUrl: "x",
    title: "ブログ記事",
    pageText: page,
    judged: { verdict: "応募してよい", detail: "結論: 応募してよい\n--- 提案文 ---\nはじめまして。" },
  });
  assert.equal(item.price, null);
  assert.match(item.payText, /契約金額の目安 1,320円/);
  assert.ok(item.checks.some((c) => /文字単価からの目安/.test(c)));
});

test("応募の下書き一覧: 応募期限が今日・明日なら知らせる（日本時間の日付で数える）", () => {
  const make = (deadline, now) =>
    buildQueueItem({
      link: { key: "job:51", url: "https://crowdworks.jp/public/jobs/51" },
      applyUrl: "x",
      title: "t",
      pageText: `固定報酬制 5,000円\n応募期限 ${deadline}\n記事を書いてください`,
      judged: { verdict: "応募してよい", detail: "結論: 応募してよい\n--- 提案文 ---\nはじめまして。" },
      at: new Date(now),
    }).checks.join("|");
  // 2026-10-19 23:30 JST = 14:30 UTC
  assert.match(make("2026年10月19日", "2026-10-19T14:30:00Z"), /応募期限が今日です/);
  assert.match(make("2026年10月20日", "2026-10-19T14:30:00Z"), /応募期限が明日です/);
  assert.doesNotMatch(make("2026年10月30日", "2026-10-19T14:30:00Z"), /応募期限/);
  assert.match(make("2026年10月18日", "2026-10-19T14:30:00Z"), /過ぎています/);
});

test("explainJob: 判定の理由を、当たった語（前後つき）といっしょに出す", () => {
  const page =
    "固定報酬制 5,000円\n完全在宅（出社なし）です。電話連絡は一切ありません。\nデータの整理をお願いします。商品の一覧表を見て、必要な項目をExcelの表に整理してください。件数は約300件で、締め切りまでに順次ご提出いただきます。項目の名前や並び順は、お渡しする見本のとおりにそろえてください。分からない点があれば、メッセージでご質問ください。丁寧に進めていただける方を探しています。\nChatGPTなどの生成AIの使用は禁止です。\nクライアント情報\nありがとう 3 件\n本人確認 済み\n総合評価 4.5\n募集実績 20 件\nプロジェクト完了率 90 %\n○○の詳細を見る";
  const text = explainJob("データ整理", page);
  assert.match(text, /■ データ整理/);
  assert.match(text, /納品の判定: 出せる/);
  assert.match(text, /AIの使用: AI禁止あり/);
  assert.match(text, /関門: AIの使用の禁止・制限（確認すれば通る）/);
  assert.match(text, /← 「.*生成AIの使用は禁止/);
  // 否定文の「電話」「出社」は現地作業として数えない
  assert.doesNotMatch(text, /現地作業/);
  const phone = explainJob("電話受付", "固定報酬制 5,000円\nお客様からの電話対応をお願いします。");
  assert.match(phone, /納品の判定: 出せない/);
  assert.match(phone, /現地作業・電話〔physical〕 ← 「.*電話対応/);
});

test("本人の回答・体験が商品の募集（アンケート・買ってよかった・レビュー募集）は、納品できる側に数えない", async () => {
  const { scoreScam } = await import("../../dist-test/scam-rules.js");
  const pad = "ご協力いただいた回答は統計的に集計し、個人が特定されない形で編集・要約し、研究、記事、動画、プレスリリースなどで公開させていただくことがあります。アンケート完了コードを、コピー&ペーストしてください。必須項目にすべて入力した方のみ報酬をお支払いします。";
  const survey = `【18歳〜49歳の方限定】服に関するアンケート（選択36問＋記述3問/30円・約5分）\nタスク形式\n${pad}\nクライアント情報\n募集実績 1,649 件\n○○の詳細を見る`;
  const r1 = budgetRecord({ key: "job:61", url: "u" }, "【18歳〜49歳の方限定】服に関するアンケート（選択36問＋記述3問/30円・約5分）", survey);
  assert.equal(r1.delivers, false);
  assert.equal(scoreScam(survey).signals.some((s) => s.id === "effortless_claim"), false, "完了コードをコピー&ペーストする手順の説明を、楽して稼ぐ訴求と読まない");

  const exp =
    "【初心者歓迎・写真不要♪】2026年に買ってよかったものを教えてください！お気に入り商品レビュー募集\n固定報酬制 契約金額(目安): 400円 1記事あたりの文字数 800 文字\n" +
    "✅ 画像の提出は不要 ✅ 新しく商品を購入する必要なし ✅ 身近な商品やプチプラ商品でもOK。あなたが実際に使ってみて良かったと感じたものを、ご自由に書いてください。\nクライアント情報\n募集実績 8 件\n○○の詳細を見る";
  const r2 = budgetRecord({ key: "job:62", url: "u" }, "【初心者歓迎・写真不要♪】2026年に買ってよかったものを教えてください！お気に入り商品レビュー募集", exp);
  assert.equal(r2.delivers, false);
  const ids = scoreScam(exp).signals.map((s) => s.id);
  assert.ok(!ids.includes("inventory_purchase") && !ids.includes("no_legal_disclosure"), "「購入する必要なし」を買い取り前提と読まない");
  // 「在庫を買い取っていただく」は従来どおり拾う
  assert.ok(scoreScam("商品を仕入れ購入していただく必要があります。").signals.some((s) => s.id === "inventory_purchase"));

  // アンケートの作成・集計は回答する仕事ではない。納品できる側のまま
  const make = budgetRecord({ key: "job:63", url: "u" }, "アンケートの集計とグラフ作成", `アンケートの集計とグラフ作成\n固定報酬制 5,000円\n${pad.replace("アンケート完了コードを、コピー&ペーストしてください。", "")}回収済みのアンケート結果をExcelで集計し、グラフにまとめてください。`);
  assert.equal(make.delivers, true);
});

test("判定に渡す本文: ページ先頭のサイト共通メニュー・パンくずは、題名だけ残して落とす", () => {
  const menu = "オススメの仕事 仕事を探す youitirou0925さん 3 マイページ 気になる!リスト 相談から契約まで 契約一覧 報酬 メッセージ 支援サービス クライアントメニューに切り替える ▲ ご意見箱 翻訳ツール 画像生成";
  const crumbs = "仕事を探す\nデータ入力・事務の仕事・求人\nデータ入力の仕事・求人\n";
  const title = "Excelで売上データを整理する仕事";
  const body = `${title}\n仕事の概要\n固定報酬制 8,000円 〜 10,000円\n${"売上データをExcelで整理します。".repeat(20)}\nクライアント情報\n募集実績 20 件\n○○の詳細を見る`;
  const page = `${menu}\n${crumbs}${body}`;
  // 題名を渡さなくても、「仕事の概要」の直前の行が題名として残る
  const a = jobBodyForJudging(page);
  assert.ok(a.startsWith(title), a.slice(0, 80));
  assert.ok(!a.includes("ご意見箱") && !a.includes("データ入力の仕事・求人") && !a.includes("画像生成"));
  assert.ok(a.includes("固定報酬制 8,000円") && !a.includes("募集実績"));
  // 題名を渡したときは、それを先頭に置く
  const b = jobBodyForJudging(page, "渡された題名");
  assert.ok(b.startsWith("渡された題名\n仕事の概要"), b.slice(0, 40));
  // 「仕事の概要」が見つからないページは、これまでどおり（先頭を落とさない）
  const c = jobBodyForJudging(`${menu}\n${"本文です。".repeat(60)}\nクライアント情報\n募集実績 1 件`);
  assert.ok(c.includes("本文です") && !c.includes("募集実績"));
  // 直前の行がメニューのように長いときは、それを題名として残さない
  const d = jobBodyForJudging(`${menu}\n仕事の概要\n固定報酬制 5,000円\n${"本文です。".repeat(60)}`);
  assert.ok(!d.includes("ご意見箱"));
  // 判定（納品できる・種類）に、メニューの語（翻訳ツール・画像生成）が混ざらない
  const r = budgetRecord({ key: "job:65", url: "u" }, title, page);
  assert.equal(r.delivers, true);
  assert.notEqual(r.genre, "図解・ロゴ・チャート");
  assert.ok(!explainJob(title, page).includes("ご意見箱"));
});

test("タスク形式は「タスク 33円 / 件」の表示でも支払い方式をタスクと読む。プラットフォーム自身へのリンクは紹介リンクにしない", async () => {
  const { scoreScam } = await import("../../dist-test/scam-rules.js");
  const page = `マイページ\n仕事を探す\n【18歳〜49歳の方限定】服に関するアンケート\n仕事の概要\nタスク\n\n33円 / 件\n募集件数\n120件\n仕事の詳細\n${"回答をお願いします。".repeat(20)}\nクライアント情報\n○○の詳細を見る`;
  const r = budgetRecord({ key: "job:66", url: "u" }, "【18歳〜49歳の方限定】服に関するアンケート", page);
  assert.equal(r.payType, "タスク");
  assert.equal(r.budgetJpy, null);
  // CW自身のページへのリンクは紹介リンクではない。業者の紹介リンクは従来どおり拾う
  const own = "詳細はこちら https://tech.crowdworks.jp/job_offers/30966?ref=job_offers_show をご覧ください。";
  assert.ok(!scoreScam(own).signals.some((s) => s.id === "referral_signup"));
  assert.ok(scoreScam("登録はこちら https://example.com/signup?ref=abc123 から。").signals.some((s) => s.id === "referral_signup"));
});

test("提案文: 判定の出力の「--- 応募前に確認すること ---」以降（社内メモ）は提案文に入れない", () => {
  const detail = "結論: 確認してから応募\n\n--- 提案文 ---\n募集を拝見しました。\n\nよろしくお願いいたします。\n\n--- 応募前に確認すること ---\n# 応募前に確認すること\n権利の表明保証があります\n\n使ったAI: x";
  assert.equal(extractProposal(detail), "募集を拝見しました。\n\nよろしくお願いいたします。");
  assert.equal(cleanProposal("本文です。\n\n---\nメモ"), "本文です。");
  // 以前の記録に混ざっていた分も、一覧と応募画面への入力では落とす
  const item = { no: 1, id: "1", title: "t", url: "u", applyUrl: "a", verdict: "確認してから応募", reason: "", payType: "固定報酬", payText: "固定報酬 10,000円", price: 10000, applicants: 1, openings: 1, deadline: null, client: { tier: "普通", summary: "s", orders: 1, rating: null, completionRate: null, thanks: null, identity: "不明", raw: "" }, proposal: "本文です。\n\n--- 応募前に確認すること ---\n社内メモ", checks: [], status: "pending", at: "2026-10-19T00:00:00Z" };
  const md = queueMarkdown({ nextNo: 2, items: [item] });
  assert.ok(md.includes("> 本文です。") && !md.includes("社内メモ"));
});

test("提案文が経歴に無い道具の経験を言い切っていたら注意を出す（募集の言い換えや「経験はありません」は拾わない）", () => {
  const bg = "本業で約20年、精密部品の検査。Excel関数・VBAマクロ・Word・PowerPointを使っています。ウェブ会議に対応できます。";
  assert.deepEqual(unbackedSkillClaims("Googleスプレッドシート操作、ウェブ会議対応は可能です。", bg), ["Googleスプレッドシート"]);
  assert.deepEqual(unbackedSkillClaims("Googleスプレッドシートでの、集計レポートの新規構築のお仕事と理解しております。", bg), []);
  assert.deepEqual(unbackedSkillClaims("QUERY関数を使った経験はありません。Excel関数は使えます。", bg), []);
  assert.deepEqual(unbackedSkillClaims("Excel関数・VBAの経験があります。", bg), []);
  assert.deepEqual(unbackedSkillClaims("動画編集自体は新しい取り組みですが、丁寧に進めます。", bg), []);
  assert.deepEqual(unbackedSkillClaims("動画編集の経験があります。", undefined), [], "経歴が読めないときは調べない");
  // 一覧の注意にも出る
  const page = "固定報酬制 10,000円\n応募した人 3 人 契約した人 0 人 募集人数 1 人\n" + "仕事の説明です。".repeat(40) + "\nクライアント情報\n○○の詳細を見る";
  const it = buildQueueItem({
    link: { key: "job:1", url: "u" }, applyUrl: "a", title: "転記のお仕事", pageText: page,
    judged: { verdict: "応募してよい", detail: "理由: x\n\n--- 提案文 ---\nGoogleスプレッドシート操作は可能です。\n\n使ったAI: x" },
    background: bg,
  });
  assert.ok(it.checks.some((c) => c.includes("経歴に書かれていない") && c.includes("Googleスプレッドシート")));

  // 「AIを使って習得し」は注意。経歴にある「AIを使った、〜アプリの作成」は事実なので注意しない
  const mk = (proposal) => buildQueueItem({ link: { key: "job:2", url: "u" }, applyUrl: "a", title: "t", pageText: page, judged: { verdict: "応募してよい", detail: `理由: x\n\n--- 提案文 ---\n${proposal}\n\n使ったAI: x` } });
  assert.ok(mk("公式のヘルプとAIを使って習得し、お見せします。").checks.some((c) => c.includes("AIを使って作業・習得")));
  assert.ok(!mk("・AIを使った、業務を支えるアプリ（RPAアプリ）の作成").checks.some((c) => c.includes("AIを使って作業・習得")));
});

test("提案文の差し替え: 番号・状態・ほかの注意は残し、提案文から決まる注意だけ付け直す", () => {
  const base = { no: 7, id: "7", title: "t", url: "u", applyUrl: "a", verdict: "確認してから応募", reason: "", payType: "固定報酬", payText: "固定報酬 10,000円", price: 10000, applicants: 60, openings: 1, deadline: null, client: { tier: "優良", summary: "s", orders: 300, rating: 4.7, completionRate: 90, thanks: null, identity: "済", raw: "" }, proposal: "", checks: ["応募60人・募集1人（競争が激しい）", "提案文が出ていません。書いてから送ってください"], status: "approved", at: "2026-10-19T00:00:00Z" };
  const out = setProposal(base, "募集を拝見しました。Excel関数とVBAで対応します。\n\n--- メモ ---\n社内", "Excel関数・VBA");
  assert.equal(out.no, 7);
  assert.equal(out.status, "approved");
  assert.equal(out.proposal, "募集を拝見しました。Excel関数とVBAで対応します。");
  assert.deepEqual(out.checks, ["応募60人・募集1人（競争が激しい）"], "提案文の注意は消え、ほかの注意は残る");
  const bad = setProposal(base, "【要確認: 年数】です。", "Excel");
  assert.ok(bad.checks.some((c) => c.startsWith("提案文に【要確認】")) && bad.checks.some((c) => c.startsWith("応募60人")));
  assert.deepEqual(proposalChecks("本文です。", undefined), []);
});

test("一覧の注意に関門・危険信号を載せる。交渉で外せないものがあれば見送りをすすめ、機械が見送りにした件は理由つきで別に載せる", () => {
  const page = (body) => `固定報酬制 5,000円 〜 10,000円\n応募した人 10 人 契約した人 0 人 募集人数 3 人\n応募期限 2026年10月29日\n${body}\n${"仕事の説明です。".repeat(30)}\nクライアント情報\n募集実績 300 件\n総合評価 4.8\nプロジェクト完了率 95 %\n○○の詳細を見る`;
  const judged = { verdict: "確認してから応募", detail: "理由: テスト" };
  const mk = (body, extra = {}) => buildQueueItem({ link: { key: "job:50", url: "u" }, applyUrl: "a", title: "テストの仕事", pageText: page(body), judged: extra.judged ?? judged });

  // 士業の独占業務(補助金の事業計画書)は、交渉で外せないので見送りをすすめる
  const sub = mk("補助金コンサル業務の事業計画作成業務を依頼します。");
  assert.equal(sub.verdict, "見送り");
  assert.ok(sub.checks[0].startsWith("見送りをすすめます") && sub.checks[0].includes("士業の独占業務"));
  // 確認すれば通る関門(平日昼の会議)は、注意に載せて「確認してから応募」のまま
  const hours = mk("以下のうち1つに参加必須です。木曜 13:00〜16:00 金曜 13:00〜16:00");
  assert.equal(hours.verdict, "確認してから応募");
  assert.ok(hours.checks.some((c) => c.includes("平日の日中に参加が必須の予定")));
  // 関門に当たらない普通の募集には、関門の注意が付かない
  const plain = mk("Excelでデータを集計してください。");
  assert.deepEqual(ruleChecks("テストの仕事", page("Excelでデータを集計してください。")), { lines: [], blocking: [] });
  assert.equal(plain.verdict, "確認してから応募");
  assert.ok(!plain.checks.some((c) => c.includes("見送りをすすめます")));

  // 上位の判定が出なかったことが一覧に出る
  const nj = mk("Excelでデータを集計してください。", { judged: { verdict: "確認してから応募", detail: "理由: x\nルールで判定しきれず、Claudeの判定も得られませんでした（生成に失敗しました）。募集文を読んで人が判断してください" } });
  assert.ok(nj.checks[0].includes("Claudeの判定も得られませんでした") && nj.checks[0].includes("ルールだけの判定"));

  // 機械が見送りにした件は、理由つきで「見送りにした案件」に載る(一覧の件数には数えない)
  let q = addToQueue(emptyQueue(), [plain, { ...sub, id: "51" }]);
  q = { ...q, items: q.items.map((i) => (i.id === "51" ? { ...i, status: "skipped", skipReason: "士業の独占業務(補助金の事業計画書)" } : i)) };
  const md = queueMarkdown(q, new Date("2026-10-19T00:00:00Z"));
  assert.ok(md.includes("一覧 1件／承認済み 0件"));
  assert.ok(md.includes("# 見送りにした案件") && md.includes("士業の独占業務(補助金の事業計画書)"));
});

test("パンくず（…の仕事・求人）は判定の本文に入れない。仕事の種類は題名に当たったものを先にする", () => {
  const crumbs = "マイページ\n仕事を探す\nシステム開発の仕事・求人\n保守・運用・更新の仕事・求人\n";
  const body = "⭐【VBA】ECシステムの構築・開発業務案件⭐\n仕事の概要\n固定報酬制 500,000円 〜 1,000,000円\n毎月の稼働時間：160時間程度の常駐型です。\n" + "詳細な作業内容は面談でご説明します。".repeat(8) + "\nクライアント情報\n募集実績 4,103 件\n○○の詳細を見る";
  const out = jobBodyForJudging(crumbs + body);
  assert.ok(!out.includes("システム開発の仕事・求人") && !out.includes("マイページ"));
  assert.ok(out.includes("【VBA】ECシステム"));
  // パンくずが無いページは、そのまま
  assert.equal(jobBodyForJudging(body).startsWith("⭐【VBA】"), true);

  // 題名が「サムネイル作成」なら、本文の端に翻訳の語があっても、仕事の種類は図解・ロゴ・チャート側
  const thumb = budgetRecord(
    { key: "job:64", url: "u" },
    "【主婦の方大歓迎！】Youtubeサムネイル作成のお仕事",
    "【主婦の方大歓迎！】Youtubeサムネイル作成のお仕事\n固定報酬制 5,000円\nYouTube動画のサムネイル制作をお願いいたします。自然な日本語に翻訳できる方歓迎。\n" + "ご要望は都度チャットでお伝えします。".repeat(10) + "\nクライアント情報\n募集実績 338 件\n○○の詳細を見る"
  );
  assert.equal(thumb.genre, "図解・ロゴ・チャート");
});

// --- 受信箱 ---

const NOW = new Date("2026-10-19T18:00:00+09:00");

test("受信箱の行から、状態と日時を読む(今年の月日・年つき・読めない)", () => {
  const a = inboxRowInfo("テスト企画\n【初心者歓迎】データ入力\nお疲れ様です。…\n契約\n10/19 12:37", NOW);
  assert.equal(a.status, "契約");
  assert.equal(a.at.toISOString(), "2026-10-19T03:37:00.000Z");
  const b = inboxRowInfo("某社 ポイ活アプリ 突然のメッセージ失礼いたします 相談 2023/07/26", NOW);
  assert.equal(b.status, "相談");
  assert.equal(b.at.getUTCFullYear(), 2023);
  // 年末に見る1月の行は、来年ではなく今年(または去年)の日付にする
  const c = inboxRowInfo("応募・スカウト\n12/30 09:00", new Date("2027-01-02T10:00:00+09:00"));
  assert.equal(c.at.getUTCFullYear(), 2026);
  assert.deepEqual(inboxRowInfo("読めない行", NOW), { status: "", at: null });
});

test("受信箱から読むやり取りを選ぶ: 辞退と古いものは外し、新しい順、同じ相手は1回", () => {
  const rows = [
    { href: "https://crowdworks.jp/messages/100", text: "A社\n応募・スカウト\n10/15 18:12" },
    { href: "https://crowdworks.jp/messages/101", text: "B社\n辞退\n10/18 10:00" },
    { href: "https://crowdworks.jp/messages/102", text: "C社\n契約\n10/19 12:37" },
    { href: "https://crowdworks.jp/messages/102", text: "C社 (同じ行のもう1つのリンク)" },
    { href: "https://crowdworks.jp/messages/103", text: "D社\n相談\n2023/07/26" },
    { href: "https://crowdworks.jp/messages/104", text: "E社\n契約\n2023/07/26" },
    { href: "https://crowdworks.jp/help", text: "ヘルプ" },
  ];
  const out = selectInboxRows(rows, NOW, 10);
  assert.deepEqual(out.map((e) => e.key), ["messages:102", "messages:100", "messages:104"]);
  assert.equal(out[0].status, "契約");
  assert.deepEqual(selectInboxRows(rows, NOW, 1).map((e) => e.key), ["messages:102"]);
});

const DANGER_CONTRACT = `契約詳細：【初心者歓迎】選んで入力するだけのデータ入力
サービス外連絡申請が否認されました。
taro_test
2026年10月04日 21:32
お世話になります。応募します。

テスト企画
2026年10月19日 12:37
仮払いが完了いたしました。詳しいお仕事内容はチャットワークにてご連絡します。
（チャットワークのコンタクトURL: chatwork.com/tester24）
`;

test("返事や確認が要るメッセージだけを取り出し、危険なものを先に並べる。一覧とメールにも内容の冒頭を出す", () => {
  const mk = (text, url, changed = true) => ({ review: reviewCwThread(parseCwThreads(text, "taro_test")[0], NOW), url, changed, inboxStatus: "契約" });
  const danger = mk(DANGER_CONTRACT, "https://crowdworks.jp/contracts/1");
  const plain = mk(THREAD, "https://crowdworks.jp/proposals/2");
  const ok = mk(DANGER_CONTRACT.replace(/テスト企画\n[\s\S]*$/, "taro_test\n2026年10月19日 12:37\nよろしくお願いします。\n"), "https://crowdworks.jp/contracts/3");
  const notes = messageNotes([plain, ok, danger]);
  assert.ok(notes.length >= 1);
  const n1 = notes.find((n) => n.url === "https://crowdworks.jp/contracts/1");
  assert.equal(n1.kind, "danger");
  assert.ok(n1.gist.includes("チャットワーク"));
  assert.ok(n1.advice.includes("連絡先は追加しない"));
  // 危険なものが先、返事を考えるものは後
  const order = notes.map((n) => n.kind);
  assert.deepEqual(order, [...order].sort((a, b) => ({ danger: 0, reply: 1, caution: 2 })[a] - ({ danger: 0, reply: 1, caution: 2 })[b]));
  assert.ok(!notes.some((n) => n.url === "https://crowdworks.jp/contracts/3"), "自分の発言で終わっているものは出さない");

  const md = queueMarkdown({ nextNo: 1, items: [], messages: notes }, NOW);
  assert.ok(md.includes("受信箱で返事や確認が要るメッセージ"));
  assert.ok(md.includes("危険（返信せず離れる）"));
  assert.ok(md.includes("https://crowdworks.jp/contracts/1"));
  assert.ok(!md.includes("待ち"));
  // 一覧に足すだけの操作(addToQueue)でも、受信箱の欄は消えない
  assert.equal(addToQueue({ nextNo: 1, items: [], messages: notes }, []).messages.length, notes.length);

  const report = buildReport({ threads: [danger], jobs: [], errors: [], loginExpired: false });
  assert.ok(report.body.includes("内容: 仮払いが完了"), "危険な相手も、内容の冒頭と対応をメールに出す");
  assert.ok(report.body.includes("連絡先は追加しない"));
  assert.ok(report.worthSending);
});
