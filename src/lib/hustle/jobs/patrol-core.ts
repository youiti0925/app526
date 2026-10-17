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

  const reply = input.threads.filter((t) => t.review.waiting === "me");
  const risky = input.threads.filter((t) => t.review.scam && t.review.scam.verdict !== "safe");
  const flagged = input.threads.filter((t) => t.review.flags.some((f) => f.includes("提示額")));
  const picks = input.jobs.filter((j) => WANT.some((w) => j.verdict.startsWith(w)));
  const skipped = input.jobs.length - picks.length;

  const out: string[] = [];
  const section = (title: string) => out.push("", `■■ ${title}`);

  if (reply.length) {
    section(`返事が要るもの ${reply.length}件`);
    for (const t of reply) {
      const last = t.review.thread.messages[t.review.thread.messages.length - 1];
      out.push(
        `・${t.review.thread.title}${t.changed ? "【新着】" : ""}`,
        `  ${last?.from ?? ""}さん ${last?.at?.slice(0, 16).replace("T", " ") ?? ""}${t.review.daysSinceLast !== null ? `（${t.review.daysSinceLast}日前）` : ""}`,
        `  ${t.url}`
      );
    }
  }
  if (risky.length || flagged.length) {
    section("危険信号・ミスの疑い");
    for (const t of [...new Set([...risky, ...flagged])]) {
      out.push(`・${t.review.thread.title}`, `  ${t.url}`);
      for (const s of t.review.scam?.signals.slice(0, 2) ?? []) out.push(`  - ${s.label}`);
      for (const f of t.review.flags) out.push(`  - ${f}`);
    }
  }
  if (picks.length) {
    section(`新着の応募候補 ${picks.length}件（送るかどうかはあなたが決める。送信はしません）`);
    for (const j of picks) out.push("", `―――― ${j.title}`, j.url, j.detail.trim());
  }
  if (input.jobs.length) out.push("", `新着 ${input.jobs.length}件を判定（見送り・判定できず ${skipped}件）`);
  if (input.errors.length) {
    section("うまく読めなかったもの");
    for (const e of input.errors.slice(0, 10)) out.push(`・${e}`);
  }
  out.push(
    "",
    "※「目立った危険信号なし」は安全の保証ではありません。契約と仮払いが画面に出るまで作業しないでください。",
    "※ このメールはあなたのPCの巡回が送っています。応募・返信・送信はしません。"
  );

  const changedReply = reply.filter((t) => t.changed).length;
  const worthSending = changedReply > 0 || picks.length > 0 || risky.some((t) => t.changed) || flagged.some((t) => t.changed);
  return {
    subject: `【CW巡回】返事が要る${reply.length}件・新着候補${picks.length}件${risky.length ? `・危険${risky.length}件` : ""}`,
    body: out.join("\n").replace(/^\n+/, ""),
    worthSending,
  };
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
