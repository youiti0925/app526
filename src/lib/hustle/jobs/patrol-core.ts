/**
 * クラウドワークス巡回（あなたのPCで、あなたのログインのまま動く）の、通信しない部分。
 *
 * - どのリンクが「募集」か「やり取り」かを見分ける
 * - 前回から変わったもの・新しいものだけを選ぶ
 * - Gメールに送るまとめを組み立てる
 * 巡回そのもの（ブラウザ操作・メール送信）は scripts/cw-patrol.mjs。
 */
import type { CwReview } from "./cw-thread";

export type LinkKind = "job" | "thread";

export interface PatrolLink {
  kind: LinkKind;
  /** 重複を見分けるためのキー（例: job:13523505） */
  key: string;
  url: string;
}

const JOB_PATH = /^\/public\/jobs\/(\d+)\/?$/;
const THREAD_PATH = /^\/(proposals|messages|contracts|consultations)\/(\d+)\/?$/;

/** クラウドワークスのリンクを、募集・やり取り・それ以外に分ける。それ以外は null。 */
export function classifyLink(href: string): PatrolLink | null {
  let u: URL;
  try {
    u = new URL(href, "https://crowdworks.jp/");
  } catch {
    return null;
  }
  if (u.hostname !== "crowdworks.jp") return null;
  const job = u.pathname.match(JOB_PATH);
  if (job) return { kind: "job", key: `job:${job[1]}`, url: `https://crowdworks.jp/public/jobs/${job[1]}` };
  const th = u.pathname.match(THREAD_PATH);
  if (th) return { kind: "thread", key: `${th[1]}:${th[2]}`, url: `https://crowdworks.jp/${th[1]}/${th[2]}` };
  return null;
}

/** 重複を除いて、種類ごとに分ける（ページに出てきた順を保つ）。 */
export function collectLinks(hrefs: string[]): { jobs: PatrolLink[]; threads: PatrolLink[] } {
  const seen = new Set<string>();
  const jobs: PatrolLink[] = [];
  const threads: PatrolLink[] = [];
  for (const h of hrefs) {
    const l = classifyLink(h);
    if (!l || seen.has(l.key)) continue;
    seen.add(l.key);
    (l.kind === "job" ? jobs : threads).push(l);
  }
  return { jobs, threads };
}

export interface SeenState {
  /** 判定済みの募集（キー → 初めて見た日時） */
  jobs: Record<string, string>;
  /** やり取りの最後の発言（キー → 指紋）。変わったら知らせる */
  threads: Record<string, string>;
}

export const emptySeen = (): SeenState => ({ jobs: {}, threads: {} });

export function newJobs(links: PatrolLink[], seen: SeenState, max: number): PatrolLink[] {
  return links.filter((l) => !seen.jobs[l.key]).slice(0, max);
}

/** やり取りの「最後の発言」を表す指紋。発言が増えたり変わったりすると変わる。 */
export function threadFingerprint(r: CwReview): string {
  const last = r.thread.messages[r.thread.messages.length - 1];
  return last ? `${r.thread.messages.length}|${last.from}|${last.at ?? ""}` : "0";
}

export interface JudgedJob {
  title: string;
  url: string;
  /** 「応募してよい」「確認してから応募」「見送り」「判定できず」 */
  verdict: string;
  /** 判定の出力（理由・時給・提案文まで） */
  detail: string;
}

export interface PatrolReport {
  subject: string;
  body: string;
  /** 送る価値のある中身があるか（無ければメールを送らない） */
  worthSending: boolean;
}

export interface ReportInput {
  threads: { review: CwReview; url: string; changed: boolean }[];
  jobs: JudgedJob[];
  errors: string[];
  loginExpired: boolean;
  /** 公開募集（ココナラ・ままワークス）の自動収集の結果。応募候補の件数と、メールに載せる本文（提案文つき） */
  scan?: { candidates: number; body: string } | null;
}

const WANT = ["応募してよい", "確認してから応募"];

export function buildReport(input: ReportInput): PatrolReport {
  if (input.loginExpired) {
    return {
      subject: "【CW巡回】ログインが切れました",
      body:
        "クラウドワークスのログインが切れていて、巡回できませんでした。\n" +
        "PCで「cw-patrol-setup」をもう一度実行し、ログインし直してください（パスワードはあなたのPCのブラウザにだけ入力します）。\n",
      worthSending: true,
    };
  }

  const risky = input.threads.filter((t) => t.review.scam && t.review.scam.verdict !== "safe");
  const riskySet = new Set(risky);
  // 返事を考えるもの = 相手の番を待っている／提示額のミスがあり、かつ危険信号が出ていないやり取り
  const reply = input.threads.filter(
    (t) => !riskySet.has(t) && (t.review.waiting === "me" || t.review.flags.some((f) => f.includes("提示額")))
  );
  const picks = input.jobs.filter((j) => WANT.some((w) => j.verdict.startsWith(w)));
  const others = input.jobs.filter((j) => !picks.includes(j));
  const scanCandidates = input.scan?.candidates ?? 0;
  const todo = picks.length + reply.length + scanCandidates;

  const out: string[] = [];
  const section = (title: string) => out.push("", `■ ${title}`);

  // 1行目で結論が分かるように
  out.push(
    todo === 0
      ? "【結論】今やることはありません。"
      : `【結論】今やること ${todo}件（${[
          picks.length ? `CWの応募を考える ${picks.length}件` : "",
          scanCandidates ? `公開募集の応募を考える ${scanCandidates}件` : "",
          reply.length ? `返事を考える ${reply.length}件` : "",
        ]
          .filter(Boolean)
          .join("・")}）`
  );
  if (risky.length) out.push(`危険信号の出た相手 ${risky.length}件は、返事をしなくて大丈夫です（理由は下に）。`);

  if (picks.length) {
    section(`応募を考える ${picks.length}件（送るかどうかはあなたが決める。送信はしません）`);
    for (const j of picks) out.push("", `―――― ${j.title}`, j.url, j.detail.trim());
  }
  if (input.scan && scanCandidates > 0) {
    section(`公開募集（ココナラ・ままワークス）の応募候補 ${scanCandidates}件（送るかどうかはあなたが決める。送信はしません）`);
    out.push(input.scan.body.trim());
  } else if (input.scan) {
    out.push("", "公開募集（ココナラ・ままワークス）: 今回は応募候補なし（収集は動きました）");
  }
  if (reply.length) {
    section(`返事を考える ${reply.length}件`);
    for (const t of reply) {
      const last = t.review.thread.messages[t.review.thread.messages.length - 1];
      out.push(`・${t.review.thread.title}${t.changed ? "【新着】" : ""}`);
      if (last) out.push(`  最後の発言: ${last.from}さん${t.review.daysSinceLast !== null ? `（${t.review.daysSinceLast}日前）` : ""}`);
      for (const f of t.review.flags) out.push(`  - ${f}`);
      out.push(`  ${t.url}`);
    }
  }
  if (risky.length) {
    section(`返事をしなくてよい相手 ${risky.length}件（危険信号あり）`);
    for (const t of risky) {
      const why = t.review.scam?.signals[0]?.label ?? "危険信号あり";
      out.push(`・${shortTitle(t.review.thread.title)} … ${why}`);
    }
  }
  if (input.jobs.length) {
    section(`新着の募集 ${input.jobs.length}件の判定`);
    for (const j of others) out.push(`・${j.verdict}：${shortTitle(j.title)}`, `  ${jobReason(j)}`);
    if (!others.length) out.push("・すべて上の「応募を考える」に入れました");
  }
  if (input.errors.length) {
    section("うまく読めなかったもの（直すために使います）");
    for (const e of input.errors.slice(0, 10)) out.push(`・${e}`);
  }
  out.push(
    "",
    "※ 危険信号が出ていないことは、安全の保証ではありません。契約と仮払いが画面に出るまで作業しないでください。",
    "※ このメールはあなたのPCの巡回が送っています。応募・返信・送信はしません。"
  );

  const worthSending =
    reply.some((t) => t.changed) || picks.length > 0 || scanCandidates > 0 || risky.some((t) => t.changed);
  return {
    subject: todo === 0 ? "【CW巡回】今やること：なし" : `【CW巡回】今やること ${todo}件${picks.length + scanCandidates ? `（応募候補 ${picks.length + scanCandidates}件）` : ""}`,
    body: out.join("\n"),
    worthSending,
  };
}

/** 一覧で読みやすいよう、題名の飾り（【クラウドワークス】など）を落として短くする */
function shortTitle(title: string): string {
  const t = title
    .replace(/^(相談から契約まで|契約詳細)[：:]\s*/, "")
    .replace(/【(クラウドワークス|新着)】/g, "")
    .trim();
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
}

/** 判定の出力から、見送り・判定できずの理由を1行で取り出す */
export function jobReason(j: JudgedJob): string {
  const reason = j.detail.match(/^理由: (.+)$/m)?.[1];
  if (reason) return `理由: ${reason.slice(0, 100)}`;
  const tail = j.detail.trim().split("\n").filter((l) => l.trim()).slice(-2).join(" ").slice(0, 160);
  return tail ? `（理由が読めませんでした: ${tail}）` : "（判定の結果が空でした）";
}

/** UTF-8 の件名を、メールのヘッダーに書ける形にする。 */
export function encodeHeader(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

/** プレーンテキストのメール本文を組み立てる（改行は CRLF、本文は base64）。 */
export function buildMimeMessage(m: { from: string; to: string; subject: string; body: string; date?: Date }): string {
  const b64 = Buffer.from(m.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64");
  const lines = b64.match(/.{1,76}/g) ?? [""];
  return [
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Subject: ${encodeHeader(m.subject)}`,
    `Date: ${(m.date ?? new Date()).toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    ...lines,
  ].join("\r\n");
}

// --- 募集の予算の記録（単価の前提を確かめるため）-----------------------------------------

export interface BudgetRecord {
  at: string;
  key: string;
  title: string;
  url: string;
  /** 固定報酬の下限（読めなければ null。時間単価・タスク形式でも null）。「10,000円〜30,000円」なら10,000 */
  budgetJpy: number | null;
  /** 固定報酬の上限。幅が無ければ下限と同じ */
  budgetMaxJpy: number | null;
  /** 時間単価の募集の時給（下限・上限）。固定報酬では null */
  hourlyJpy?: number | null;
  hourlyMaxJpy?: number | null;
  /** 題名か本文に Excel・VBA・マクロ・スプレッドシートが出てくるか */
  excelVba: boolean;
  /** 品質・検査・測定・工程の言葉が出てくるか */
  quality: boolean;
  payType: "固定報酬" | "時間単価" | "コンペ" | "タスク" | "不明";
}

// 「マクロ経済」は Excel のマクロではない
const EXCEL_VBA = /(excel|エクセル|vba|マクロ(?!経済)|スプレッドシート)/gi;
const QUALITY = /(品質管理|品質保証|検査|測定|工程能力|工程管理|不良|成績書|管理図|cpk)/gi;
const yen = (s: string): number => parseInt(s.replace(/,/g, ""), 10);

/**
 * 題名に出ていれば当たり。本文だけなら、「Excel・PowerPoint等のスキル」のような飾りで出ただけの募集を拾わないよう、
 * 本文に min 回以上出たものを当たりにする。
 */
function mentions(re: RegExp, title: string, body: string, min: number): boolean {
  return new RegExp(re.source, "i").test(title) || (body.match(new RegExp(re.source, "gi")) ?? []).length >= min;
}

const AMOUNT = "(?<![0-9.,])([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(\\.[0-9]+)?\\s*円";
const RANGE_TAIL = `(?:\\s*[〜~～-]\\s*${AMOUNT})?`;

/**
 * 支払い方式の表示（「固定報酬制」「時間単価制」…）のすぐ後ろだけから金額を読む。
 * ページの別の場所にある金額（本文の例示・時給の換算・おすすめの仕事）は拾わない。
 * 「ワーカーと相談」が金額より先に出れば相談（金額なし）、小数（1.1円＝文字単価）は単価なので金額なし。
 */
function readPayAmount(body: string, labelAt: number): { min: number; max: number } | null {
  const section = body.slice(labelAt, labelAt + 90);
  const m = new RegExp(`${AMOUNT}${RANGE_TAIL}`).exec(section);
  if (!m) return null;
  const talk = section.search(/相談/);
  if (talk >= 0 && talk < m.index) return null;
  // m[1]=下限 m[2]=下限の小数 m[3]=上限 m[4]=上限の小数
  if (m[2] || m[4]) return null;
  const min = yen(m[1]);
  const max = m[3] ? yen(m[3]) : min;
  return max >= min ? { min, max } : null;
}

/** 読んだ募集から、予算と種類を1件分の記録にする。分類は、依頼者欄・おすすめより前の本文だけで行う。 */
export function budgetRecord(link: { key: string; url: string }, title: string, text: string, at: Date = new Date()): BudgetRecord {
  const body = jobBodyForJudging(text).normalize("NFKC").slice(0, 6000);
  const head = body.slice(0, 600);
  // 募集ページの先頭に出る「固定報酬制」「時間単価制」「コンペ形式」「タスク形式」の最初のものがその募集の支払い方式
  const PAY_TYPES: Record<string, BudgetRecord["payType"]> = { 固定報酬制: "固定報酬", 時間単価制: "時間単価", コンペ形式: "コンペ", タスク形式: "タスク" };
  const found = /(固定報酬制|時間単価制|コンペ形式|タスク形式)/.exec(body);
  const payType: BudgetRecord["payType"] = found
    ? PAY_TYPES[found[1]]
    : /コンペ/.test(head) ? "コンペ" : /タスク形式/.test(head) ? "タスク" : /時間単価|時給/.test(head) ? "時間単価" : /固定報酬/.test(head) ? "固定報酬" : "不明";

  let budgetJpy: number | null = null;
  let budgetMaxJpy: number | null = null;
  let hourlyJpy: number | null = null;
  let hourlyMaxJpy: number | null = null;
  // 支払い方式の表示が見つからない募集（アンケートなど）は、金額を当てずっぽうで読まない
  if (found && (payType === "時間単価" || payType === "固定報酬")) {
    const amount = readPayAmount(body, found.index);
    if (amount && payType === "時間単価") {
      hourlyJpy = amount.min;
      hourlyMaxJpy = amount.max;
    } else if (amount) {
      budgetJpy = amount.min;
      budgetMaxJpy = amount.max;
    }
  }
  return {
    at: at.toISOString(),
    key: link.key,
    title: title.slice(0, 80),
    url: link.url,
    budgetJpy,
    budgetMaxJpy,
    hourlyJpy,
    hourlyMaxJpy,
    excelVba: mentions(EXCEL_VBA, title, body, 3),
    quality: mentions(QUALITY, title, body, 2),
    payType,
  };
}

const median = (xs: number[]): number => {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};

/** 記録をまとめる。同じ募集は最新の1件だけ数える。報酬は固定報酬だけを数え、時給は別に出す。 */
export function summarizeBudgets(records: BudgetRecord[]): string {
  const latest = [...new Map(records.map((r) => [r.key, r])).values()];
  const group = (label: string, rs: BudgetRecord[]): string => {
    // 1,000円未満（アンケートなどの小さなタスク）は、受注の単価の話に混ぜない
    const priced = rs.filter((r) => r.budgetJpy !== null && r.budgetJpy >= 1000 && r.payType !== "時間単価" && r.payType !== "タスク" && r.payType !== "コンペ");
    if (!rs.length) return `${label}: 記録なし`;
    const hourly = rs.filter((r) => r.hourlyJpy != null);
    const hourlyText = hourly.length ? `／時給の募集 ${hourly.length}件（時給の下限の中央値 ${median(hourly.map((r) => r.hourlyJpy as number)).toLocaleString()}円）` : "";
    if (!priced.length) return `${label}: ${rs.length}件（報酬が読めた固定報酬 0件）${hourlyText}`;
    const mins = priced.map((r) => r.budgetJpy as number);
    const over20k = priced.filter((r) => (r.budgetMaxJpy ?? r.budgetJpy ?? 0) >= 20_000).length;
    return `${label}: ${rs.length}件（報酬が読めた固定報酬 ${priced.length}件・下限の中央値 ${median(mins).toLocaleString()}円・最小 ${Math.min(...mins).toLocaleString()}円・最大 ${Math.max(...mins).toLocaleString()}円・上限が2万円以上 ${over20k}件）${hourlyText}`;
  };
  return [
    `募集の予算の記録（${latest.length}件）`,
    group("Excel/VBA・マクロ・スプレッドシート", latest.filter((r) => r.excelVba)),
    group("そのうち品質・検査・測定・工程の言葉あり", latest.filter((r) => r.excelVba && r.quality)),
    group("すべて", latest),
  ].join("\n");
}

/**
 * 募集ページの全文から、判定に渡す本文を作る。
 * 「クライアント情報」より後（依頼者の欄・おすすめの仕事・ページ下部の定型リンク）は、仕事の中身ではなく、
 * 「本人確認未提出」「個人情報保護方針」などの飾りが判定を狂わせるので落とす。
 */
export function jobBodyForJudging(text: string): string {
  const cut = text.search(/\n\s*(クライアント情報|依頼者情報|おすすめの仕事|この仕事に似た)/);
  const head = cut > 200 ? text.slice(0, cut) : text;
  return head.replace(/個人情報保護方針|プライバシーポリシー|特定商取引法に基づく表記/g, "");
}

/** 検索結果から読む募集を、検索ごとに少しずつ交互に選ぶ（1つの検索で枠が埋まらないように）。 */
export function pickJobsRoundRobin(perSearch: PatrolLink[][], seen: SeenState, max: number, perSearchMax = 3): PatrolLink[] {
  const queues = perSearch.map((links) => newJobs(links, seen, perSearchMax));
  const out: PatrolLink[] = [];
  const keys = new Set<string>();
  for (let i = 0; i < perSearchMax && out.length < max; i++) {
    for (const q of queues) {
      const l = q[i];
      if (l && !keys.has(l.key) && out.length < max) {
        keys.add(l.key);
        out.push(l);
      }
    }
  }
  return out;
}
