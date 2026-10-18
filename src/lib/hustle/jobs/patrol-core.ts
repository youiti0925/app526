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
  const todo = picks.length + reply.length;

  const out: string[] = [];
  const section = (title: string) => out.push("", `■ ${title}`);

  // 1行目で結論が分かるように
  out.push(
    todo === 0
      ? "【結論】今やることはありません。"
      : `【結論】今やること ${todo}件${picks.length ? `（応募を考える ${picks.length}件` : "（"}${picks.length && reply.length ? "・" : ""}${reply.length ? `返事を考える ${reply.length}件` : ""}）`
  );
  if (risky.length) out.push(`危険信号の出た相手 ${risky.length}件は、返事をしなくて大丈夫です（理由は下に）。`);

  if (picks.length) {
    section(`応募を考える ${picks.length}件（送るかどうかはあなたが決める。送信はしません）`);
    for (const j of picks) out.push("", `―――― ${j.title}`, j.url, j.detail.trim());
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
    reply.some((t) => t.changed) || picks.length > 0 || risky.some((t) => t.changed);
  return {
    subject: todo === 0 ? "【CW巡回】今やること：なし" : `【CW巡回】今やること ${todo}件${picks.length ? `（応募候補 ${picks.length}件）` : ""}`,
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
