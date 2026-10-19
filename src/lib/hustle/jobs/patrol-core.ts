/**
 * クラウドワークス巡回（あなたのPCで、あなたのログインのまま動く）の、通信しない部分。
 *
 * - どのリンクが「募集」か「やり取り」かを見分ける
 * - 前回から変わったもの・新しいものだけを選ぶ
 * - Gメールに送るまとめを組み立てる
 * 巡回そのもの（ブラウザ操作・メール送信）は scripts/cw-patrol.mjs。
 */
import type { CwReview } from "./cw-thread";
import { checkGates } from "../agent/gates";
import { explainDeliverability, getCapability, judgeDeliverability } from "../agent/deliverability";
import { scoreScam } from "../scam-rules";
import { PLATFORM_FEES } from "../payout";
import { readAiRestriction } from "../agent/ai-restriction";

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

// --- 受信箱（クラウドワークスの「メッセージ」一覧） -------------------------------------

export interface InboxRow {
  href: string;
  /** 一覧の1行ぶんの画面の文字 */
  text: string;
}

export interface InboxEntry extends PatrolLink {
  /** 契約／応募・スカウト／相談／辞退／見てみて（行の文字から読めたときだけ） */
  status: string;
  at: Date | null;
  text: string;
}

const INBOX_STATUS = ["契約", "応募・スカウト", "相談", "辞退", "見てみて"];

/** 受信箱の1行から、状態と日時を読む。読めないものは空・null。 */
export function inboxRowInfo(text: string, now: Date = new Date()): { status: string; at: Date | null } {
  const lines = text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const status =
    INBOX_STATUS.find((st) => lines.some((l) => l === st || l === `${st}！`)) ??
    INBOX_STATUS.find((st) => lines.some((l) => l.length <= 12 && l.includes(st))) ??
    INBOX_STATUS.find((st) => new RegExp(`(?:^|\\s)${st}！?(?:\\s|$)`).test(lines.join(" "))) ??
    "";
  const joined = lines.join(" ");
  const p = (n: string) => n.padStart(2, "0");
  let at: Date | null = null;
  const full = joined.match(/(\d{4})[\/年](\d{1,2})[\/月](\d{1,2})日?(?:\s+(\d{1,2}):(\d{2}))?/);
  if (full) {
    at = new Date(`${full[1]}-${p(full[2])}-${p(full[3])}T${p(full[4] ?? "0")}:${full[5] ?? "00"}:00+09:00`);
  } else {
    const short = joined.match(/(?<![\d\/])(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
    if (short) {
      const jstYear = new Date(now.getTime() + 9 * 3_600_000).getUTCFullYear();
      const make = (y: number) => new Date(`${y}-${p(short[1])}-${p(short[2])}T${p(short[3])}:${short[4]}:00+09:00`);
      at = make(jstYear);
      if (at.getTime() > now.getTime() + 2 * 86_400_000) at = make(jstYear - 1);
    }
  }
  if (at && Number.isNaN(at.getTime())) at = null;
  return { status, at };
}

/**
 * 受信箱の行から、読むやり取りを選ぶ。辞退した相手と、古いもの(60日より前。契約中は除く)は読まない。
 * 新しい順に max 件。
 */
export function selectInboxRows(rows: InboxRow[], now: Date = new Date(), max = 15): InboxEntry[] {
  const seen = new Set<string>();
  const out: InboxEntry[] = [];
  for (const r of rows) {
    const link = classifyLink(r.href);
    if (!link || link.kind !== "thread" || seen.has(link.key)) continue;
    seen.add(link.key);
    const info = inboxRowInfo(r.text, now);
    if (info.status === "辞退") continue;
    if (info.status !== "契約" && info.at && now.getTime() - info.at.getTime() > 60 * 86_400_000) continue;
    out.push({ ...link, ...info, text: r.text });
  }
  out.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
  return out.slice(0, max);
}

export interface MessageNote {
  key: string;
  title: string;
  url: string;
  /** danger: 返信せず離れる／caution: 注意して確認／reply: 返事を考える */
  kind: "danger" | "caution" | "reply";
  status: string;
  from: string;
  at: string | null;
  daysAgo: number | null;
  /** 相手の最後の発言の冒頭 */
  gist: string;
  /** 危険信号の名前(上位2つ) */
  why: string;
  /** すすめる対応 */
  advice: string;
  /** 画面の注意(否認の表示とその理由の有無など) */
  notes: string;
  /** 外のチャットの理由を聞く、クラウドワークス内の返信の下書き(あれば) */
  draft?: string;
  /** 前回の巡回から変わった(新着) */
  fresh: boolean;
}

const collapse = (t: string, n: number) => {
  const c = t.replace(/\s+/g, " ").trim();
  return c.length > n ? `${c.slice(0, n)}…` : c;
};

/** 受信箱・やり取りの読み取り結果から、返事や確認が要るものを取り出す(巡回のたびに作り直す)。 */
export function messageNotes(threads: ReportInput["threads"]): MessageNote[] {
  const notes: MessageNote[] = [];
  for (const t of threads) {
    const r = t.review;
    const scam = r.scam;
    const kind: MessageNote["kind"] | null =
      scam?.verdict === "danger" ? "danger" : scam?.verdict === "caution" ? "caution" : r.waiting === "me" || r.flags.some((f) => f.includes("提示額")) ? "reply" : null;
    if (!kind) continue;
    const lastClient = [...r.thread.messages].reverse().find((m) => !m.mine);
    notes.push({
      key: t.url,
      title: shortTitle(r.thread.title),
      url: t.url,
      kind,
      status: t.inboxStatus ?? "",
      from: lastClient?.from ?? "",
      at: lastClient?.at ?? null,
      daysAgo: r.daysSinceLast,
      gist: collapse(lastClient?.text ?? "", 160),
      why: (scam?.signals ?? []).slice(0, 2).map((s) => s.label).join(" / "),
      advice: r.actions.slice(0, 2).join(" ／ "),
      notes: r.flags.filter((f) => !f.includes("まだ業務を開始しないでください")).slice(0, 2).join(" ／ "),
      ...(r.draftReply ? { draft: r.draftReply } : {}),
      fresh: t.changed,
    });
  }
  const rank = { danger: 0, reply: 1, caution: 2 } as const;
  return notes.sort((a, b) => rank[a.kind] - rank[b.kind]);
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
  threads: { review: CwReview; url: string; changed: boolean; inboxStatus?: string }[];
  jobs: JudgedJob[];
  errors: string[];
  loginExpired: boolean;
  /** 公開募集（ココナラ・ままワークス）の自動収集の結果。応募候補の件数と、メールに載せる本文（提案文つき） */
  scan?: { candidates: number; body: string } | null;
  /** 応募の下書き一覧。今回増えた分と、一覧の合計 */
  queue?: { added: QueueItem[]; pendingTotal: number } | null;
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
  const noteMap = new Map(messageNotes(input.threads).map((n) => [n.url, n]));
  const noteOf = (t: ReportInput["threads"][number]) => noteMap.get(t.url);

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
    if (input.queue?.added.length) {
      out.push(
        `応募の下書き一覧に ${input.queue.added.length}件 足しました（一覧は全部で ${input.queue.pendingTotal}件）。依頼者の信頼度が高い順です。`,
        "承認のしかた: 送りたい件の番号を、スレッドに「承認 3 5」のように返します。承認した件だけ入力済みの画面を開き、「応募する」はあなたが押します。"
      );
      for (const i of sortQueue(input.queue.added)) out.push("", queueItemText(i));
    } else {
      for (const j of picks) out.push("", `―――― ${j.title}`, j.url, j.detail.trim());
    }
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
      const gist = noteOf(t)?.gist;
      if (gist) out.push(`  内容: ${gist}`);
      for (const f of t.review.flags) out.push(`  - ${f}`);
      out.push(`  ${t.url}`);
    }
  }
  if (risky.length) {
    section(`返事をしなくてよい相手 ${risky.length}件（危険信号あり）`);
    for (const t of risky) {
      const why = t.review.scam?.signals[0]?.label ?? "危険信号あり";
      out.push(`・${shortTitle(t.review.thread.title)}${t.changed ? "【新着】" : ""} … ${why}`);
      if (t.review.scam?.verdict === "danger") {
        const gist = noteOf(t)?.gist;
        if (gist) out.push(`  内容: ${gist}`);
        for (const f of t.review.flags) out.push(`  - ${f}`);
        for (const a of t.review.actions) out.push(`  → ${a}`);
        if (t.review.draftReply) out.push("  返信の下書き:", ...t.review.draftReply.split("\n").map((l) => `    ${l}`));
        out.push(`  ${t.url}`);
      }
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
  /** Claude が作業して納品できる募集か（関門と納品物の判定を通ったか）。古い記録には無い */
  delivers?: boolean;
  /** 納品できるときの仕事の種類（文章・文書／コード・スクリプト など）。納品できなければ null */
  genre?: string | null;
  /** 募集文にAIの使用の禁止・制限が書かれているか */
  aiRestricted?: boolean;
  /** 金額が「契約金額(目安)」（文字単価などから画面が計算した額）から読んだものか。確定した額ではない */
  budgetEstimated?: boolean;
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

/**
 * 支払い方式の表示を探す。ページの題名にも「…(時間単価制)の仕事・求人」と出てくるので、
 * 括弧の中のものは飛ばし、すぐ後ろに金額（か「相談」）があるものを選ぶ。なければ最初のもの。
 */
function findPayLabel(body: string): RegExpExecArray | null {
  let first: RegExpExecArray | null = null;
  for (const m of body.matchAll(/(固定報酬制|時間単価制|コンペ形式|タスク形式|タスク(?=\s*[0-9,.]+\s*円\s*[\/／]\s*件))/g)) {
    const mm = m as RegExpExecArray;
    if (/[(（]/.test(body[mm.index - 1] ?? "")) continue;
    first ??= mm;
    const section = body.slice(mm.index, mm.index + 90);
    if (new RegExp(AMOUNT).test(section) || /相談/.test(section)) return mm;
  }
  return first;
}

/** 「契約金額(目安): 1,320円」の金額。文字単価の募集で、画面が総額の目安を出している。なければ null */
function readEstimatedContract(body: string): number | null {
  const m = body.match(/契約金額\s*[(（]?\s*目安\s*[)）]?\s*[:：]?\s*([0-9][0-9,]*)\s*円/);
  return m ? yen(m[1]) : null;
}

/** 「必要なスキル」の欄（次の見出しまでの短い範囲）。Excel の仕事かどうかは、題名とここを一番信用する */
function skillsOf(body: string): string {
  return body.match(/必要なスキル([\s\S]{0,100})/)?.[1] ?? "";
}

/**
 * 1件の募集が、なぜそう判定されたかを人が読める形で出す（誤判定の見直し用）。AIは使わない。
 * 当たった語は前後15文字つきで出すので、定型文・否定文・語の一部に当たっていないかを読んで確かめられる。
 */
export function explainJob(title: string, text: string): string {
  const body = jobBodyForJudging(text, title).normalize("NFKC").slice(0, 6000);
  const rec = budgetRecord({ key: "job:0", url: "" }, title, text);
  const d = judgeDeliverability(body);
  const g = checkGates(body);
  const scam = scoreScam(body);
  const ai = readAiRestriction(body);
  const client = readClientInfo(text);
  const meta = readJobMeta(text);
  const money =
    rec.hourlyJpy != null ? `時給${rec.hourlyJpy}〜${rec.hourlyMaxJpy}円` : rec.budgetJpy != null ? `${rec.budgetJpy}〜${rec.budgetMaxJpy}円${rec.budgetEstimated ? "（契約金額の目安）" : ""}` : "金額は読めず";
  const lines = [
    `■ ${title}`,
    `報酬: ${rec.payType} ${money}`,
    `依頼者: ${client.tier}｜${client.summary}｜応募${meta.applicants ?? "?"}人・募集${meta.openings ?? "?"}人・期限 ${meta.deadline ?? "?"}`,
    `納品の判定: ${d.canDeliver ? "出せる" : "出せない"}${d.canDeliver ? "" : `（${d.note}）`}`,
    ...explainDeliverability(body).map((m) => `  - ${m.label}〔${m.route}〕 ← 「${m.matched}」`),
    `関門: ${g.passed ? "通った" : `${g.hits.map((h) => h.label).join("・")}${g.negotiable ? "（確認すれば通る）" : "（交渉では外せない）"}`}`,
    ...g.hits.map((h) => `  - ${h.label} ← 「${h.matched}」`),
    `詐欺: ${scam.score}点（${scam.verdict}）`,
    ...scam.signals.map((sg) => `  - ${sg.label}（重み${sg.weight}） ← ${sg.excerpt}`),
    `AIの使用: ${ai.restricted ? ai.summary : "禁止の記載なし"}`,
    `記録: 納品できる=${rec.delivers} 種類=${rec.genre ?? "—"}`,
    `判定に渡す本文の頭: ${body.slice(0, 160).replace(/\s+/g, " ")}`,
  ];
  return lines.join("\n");
}

/** 読んだ募集から、予算と種類を1件分の記録にする。分類は、依頼者欄・おすすめより前の本文だけで行う。 */
export function budgetRecord(link: { key: string; url: string }, title: string, text: string, at: Date = new Date()): BudgetRecord {
  const body = jobBodyForJudging(text, title).normalize("NFKC").slice(0, 6000);
  const head = body.slice(0, 600);
  // 募集ページの先頭に出る「固定報酬制」「時間単価制」「コンペ形式」「タスク形式」の最初のものがその募集の支払い方式
  const PAY_TYPES: Record<string, BudgetRecord["payType"]> = { 固定報酬制: "固定報酬", 時間単価制: "時間単価", コンペ形式: "コンペ", タスク形式: "タスク", タスク: "タスク" };
  const found = findPayLabel(body);
  const payType: BudgetRecord["payType"] = found
    ? PAY_TYPES[found[1]]
    : /コンペ/.test(head) ? "コンペ" : /タスク形式/.test(head) ? "タスク" : /時間単価|時給/.test(head) ? "時間単価" : /固定報酬/.test(head) ? "固定報酬" : "不明";

  let budgetJpy: number | null = null;
  let budgetMaxJpy: number | null = null;
  let hourlyJpy: number | null = null;
  let hourlyMaxJpy: number | null = null;
  let budgetEstimated = false;
  // 支払い方式の表示が見つからない募集（アンケートなど）は、金額を当てずっぽうで読まない
  if (found && (payType === "時間単価" || payType === "固定報酬")) {
    const amount = readPayAmount(body, found.index);
    if (amount && payType === "時間単価") {
      hourlyJpy = amount.min;
      hourlyMaxJpy = amount.max;
    } else if (amount) {
      budgetJpy = amount.min;
      budgetMaxJpy = amount.max;
    } else if (payType === "固定報酬") {
      // 文字単価（1.2円など）の募集は、画面が「契約金額(目安)」として総額の目安を出している
      const est = readEstimatedContract(body);
      if (est !== null) {
        budgetJpy = est;
        budgetMaxJpy = est;
        budgetEstimated = true;
      }
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
    // 題名か「必要なスキル」に出ていれば当たり。本文だけなら、飾りの語に引っ張られないよう多めに出たものだけ
    excelVba: mentions(EXCEL_VBA, `${title}\n${skillsOf(body)}`, body, 6),
    quality: mentions(QUALITY, `${title}\n${skillsOf(body)}`, body, 3),
    payType,
    ...(budgetEstimated ? { budgetEstimated } : {}),
    ...deliveryOf(body, title),
  };
}

/**
 * 募集の本文から、Claude が作業して納品できるか・どんな種類の仕事か・AIの使用が禁止されていないかを
 * （AIを使わず、ルールだけで）読む。確認すれば通る関門（AIの禁止・納品形式など）は、納品できる側に数える。
 */
function deliveryOf(body: string, title = ""): { delivers: boolean; genre: string | null; aiRestricted: boolean } {
  const d = judgeDeliverability(body);
  const gates = checkGates(body);
  const delivers = d.canDeliver && gates.hits.every((h) => h.negotiable);
  // 仕事の種類は、題名に当たった能力を先に見る（本文の端の語に引っ張られないように）
  const free = d.canDeliver ? d.matched.map((id) => getCapability(id)).filter((c) => c && !c.needsPaid) : [];
  const byTitle = title ? free.find((c) => c && explainDeliverability(title).some((m) => m.id === c.id)) : undefined;
  const first = byTitle ?? free[0];
  return { delivers, genre: delivers ? (first?.label ?? null) : null, aiRestricted: readAiRestriction(body).restricted };
}

const median = (xs: number[]): number => {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};

/**
 * 「月の目標を、納品できる募集だけで稼ぐには何件要るか」。思い込みでなく、集めた募集の金額から出す。
 * 手数料は固定報酬の実効率で引く。応募の通過率はまだ測っていないので、数字は仮置きだと分かるように書く。
 */
export function reachLines(delivering: BudgetRecord[], targetJpy = 200_000): string[] {
  const fee = PLATFORM_FEES.find((f) => f.id === "crowdworks")?.feeRate ?? 0.22;
  const prices = delivering
    .filter((r) => r.payType === "固定報酬" && r.budgetJpy !== null && r.budgetJpy >= 1000)
    .map((r) => r.budgetJpy as number);
  const hourly = delivering.filter((r) => r.payType === "時間単価" && r.hourlyJpy != null).map((r) => r.hourlyJpy as number);
  const lines: string[] = [];
  if (prices.length >= 5) {
    const mid = median(prices);
    const net = Math.round(mid * (1 - fee));
    const need = Math.ceil(targetJpy / net);
    const perWeek = Math.ceil(need / 4.3);
    const top = [...prices].sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(prices.length / 4)));
    const topMid = median(top);
    const topNet = Math.round(topMid * (1 - fee));
    lines.push(
      `月${(targetJpy / 10_000).toLocaleString()}万円の目安（納品できる固定報酬${prices.length}件の中央値 ${mid.toLocaleString()}円 → 手取り約${net.toLocaleString()}円）: 月${need}件（週${perWeek}件）の受注が要る。` +
        `金額が上位4分の1の募集だけなら中央値 ${topMid.toLocaleString()}円（手取り約${topNet.toLocaleString()}円）で月${Math.ceil(targetJpy / topNet)}件。` +
        `応募の通過率はまだ測っていない（仮に10%なら、週${Math.ceil(perWeek / 0.1)}件の応募）`
    );
  }
  if (hourly.length >= 3) {
    const mid = median(hourly);
    const net = Math.round(mid * (1 - fee));
    lines.push(
      `時給の募集（納品できるもの${hourly.length}件）: 下限の中央値 ${mid.toLocaleString()}円 → 手取り約${net.toLocaleString()}円。月${(targetJpy / 10_000).toLocaleString()}万円には月${Math.ceil(targetJpy / net)}時間の稼働が要る（今の枠は週10時間 = 月約43時間）`
    );
  }
  return lines;
}

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
  // Claude が作業して納品できる募集（関門と納品物の判定を通ったもの）。Excel に絞らず、種類ごとに見る
  const known = latest.filter((r) => r.delivers !== undefined);
  const delivering = known.filter((r) => r.delivers);
  const genres = [...new Set(delivering.map((r) => r.genre ?? "その他"))];
  const deliveryLines = known.length
    ? [
        `Claudeが納品できる募集: ${delivering.length}件 / 判定した${known.length}件`,
        group("納品できる募集（すべて）", delivering),
        ...genres.map((g) => group(`　${g}`, delivering.filter((r) => (r.genre ?? "その他") === g))),
      ]
    : [];
  return [
    `募集の予算の記録（${latest.length}件）`,
    ...deliveryLines,
    ...reachLines(delivering),
    group("Excel/VBA・マクロ・スプレッドシート", latest.filter((r) => r.excelVba)),
    group("そのうち品質・検査・測定・工程の言葉あり", latest.filter((r) => r.excelVba && r.quality)),
    group("すべて", latest),
  ].join("\n");
}

/**
 * 募集ページの全文から、判定に渡す本文を作る。
 * 「クライアント情報」より後（依頼者の欄・おすすめの仕事・ページ下部の定型リンク）は、仕事の中身ではなく、
 * 「本人確認未提出」「個人情報保護方針」などの飾りが判定を狂わせるので落とす。
 * 先頭も同じ。本物のページは、長いサイトのメニュー（オススメの仕事・仕事を探す・マイページ・ご意見箱…）と
 * パンくずが先に来て、そのあとに題名と「仕事の概要」が来る。「仕事の概要」より前は、題名だけ残して落とす。
 */
export function jobBodyForJudging(text: string, title?: string): string {
  const trimmed = text.replace(/^[\s\S]*?(?=^[ \t]*仕事の(?:概要|詳細)[ \t]*$)/m, (before) => {
    const t = titleBefore(before, title);
    return t ? `${t}\n` : "";
  });
  const cut = trimmed.search(/\n\s*(クライアント情報|依頼者情報|おすすめの仕事|この仕事に似た)/);
  const head = cut > 200 ? trimmed.slice(0, cut) : trimmed;
  return stripBreadcrumb(head).replace(/個人情報保護方針|プライバシーポリシー|特定商取引法に基づく表記/g, "");
}

/**
 * 「仕事の概要」より前の部分から残す題名。渡された題名があればそれ、無ければ直前の1行
 * （メニューやパンくずの行は題名ではないので、長すぎる行・メニューの語を含む行・「…の仕事・求人」だけの行は残さない）。
 */
function titleBefore(before: string, title?: string): string {
  const given = title?.trim();
  if (given) return given;
  const last = before.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
  if (last.length > 120 || /マイページ|ご意見箱|クライアントメニュー|気になる!?リスト|^[^\n]{1,40}の仕事・求人$/.test(last)) return "";
  return last;
}

/**
 * ページ上部のパンくず（マイページ ＞ 仕事を探す ＞ システム開発の仕事・求人 ＞ …の仕事・求人）を落とす。
 * 仕事のカテゴリ名なので、募集の中身ではない（実データで、データ入力のパンくずが「データ処理」、
 * システム開発のパンくずが「コード・スクリプト」の根拠に使われていた）。
 * 先頭15行のうち、最後の「…の仕事・求人」だけの短い行までを落とす。
 */
function stripBreadcrumb(text: string): string {
  const lines = text.split("\n");
  let last = -1;
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    if (/^\s*[^\n]{1,40}の仕事・求人\s*$/.test(lines[i])) last = i;
  }
  return last < 0 ? text : lines.slice(last + 1).join("\n");
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

// --- 依頼者の信頼度・募集の状況（本物の画面で確かめた並び）-----------------------------------
// 依頼者の欄は「クライアント情報」で始まり「○○の詳細を見る」で終わり、項目は
//   ありがとう N 件 → 本人確認（済み／未提出） → 発注ルールチェック → 総合評価（数字か「-」）
//   → 募集実績 N 件 → プロジェクト完了率 N %（か「-」）
// の順に並ぶ。発注回数として使うのは「募集実績」（「ありがとう」は評価に近い数）。

export interface ClientInfo {
  /** 募集実績（これまでに募集した件数）。読めなければ null */
  orders: number | null;
  rating: number | null;
  /** プロジェクト完了率（%）。「-」なら null */
  completionRate: number | null;
  thanks: number | null;
  identity: "済" | "未提出" | "不明";
  /** 優良 = 何度も発注していて評価・完了率も良い。初めて = 実績が少ない。注意 = 評価か完了率が低い */
  tier: "優良" | "普通" | "初めて" | "注意" | "不明";
  /** 人が読む1行 */
  summary: string;
  /** 欄の文字（読み違いを後から見直せるように、先頭だけ残す） */
  raw: string;
}

const TIER_RANK: Record<ClientInfo["tier"], number> = { 優良: 0, 普通: 1, 初めて: 2, 不明: 3, 注意: 4 };

export function readClientInfo(text: string): ClientInfo {
  const t = text.normalize("NFKC");
  const at = t.search(/クライアント情報|依頼者情報/);
  const rest = at >= 0 ? t.slice(at) : "";
  const end = rest.search(/の詳細を見る|おすすめの仕事|この仕事に似た/);
  const sec = (end > 0 ? rest.slice(0, end) : rest).slice(0, 900);
  const num = (re: RegExp): number | null => {
    const m = sec.match(re);
    if (!m) return null;
    const v = parseFloat(m[1].replace(/,/g, ""));
    return Number.isFinite(v) ? v : null;
  };
  const orders = num(/募集実績\s*([0-9][0-9,]*)\s*件/);
  const rating = num(/総合評価\s*([0-5](?:\.[0-9]+)?)/);
  const completionRate = num(/プロジェクト完了率\s*([0-9]{1,3}(?:\.[0-9]+)?)\s*%/);
  const thanks = num(/ありがとう\s*([0-9][0-9,]*)\s*件/);
  const identity: ClientInfo["identity"] = /本人確認\s*未/.test(sec) ? "未提出" : /本人確認\s*(?:提出)?済/.test(sec) ? "済" : "不明";

  let tier: ClientInfo["tier"] = "不明";
  if (sec) {
    if ((rating !== null && rating < 3.5) || (completionRate !== null && completionRate < 50)) tier = "注意";
    else if (orders !== null && orders >= 10 && (rating === null || rating >= 4.3) && (completionRate === null || completionRate >= 80)) tier = "優良";
    else if (orders !== null && orders >= 3) tier = "普通";
    else if (orders !== null) tier = "初めて";
  }
  const parts = [
    orders !== null ? `募集実績${orders.toLocaleString()}件` : "募集実績は読めず",
    rating !== null ? `総合評価${rating}` : "評価なし",
    completionRate !== null ? `完了率${completionRate}%` : "完了率なし",
    identity === "済" ? "本人確認済み" : identity === "未提出" ? "本人確認未提出" : "",
  ].filter(Boolean);
  return { orders, rating, completionRate, thanks, identity, tier, summary: sec ? parts.join("・") : "依頼者の欄が読めませんでした", raw: sec.replace(/\s+/g, " ").slice(0, 300) };
}

export interface JobMeta {
  applicants: number | null;
  openings: number | null;
  /** 応募期限（画面の表示のまま） */
  deadline: string | null;
}

export function readJobMeta(text: string): JobMeta {
  const t = text.normalize("NFKC");
  const n = (re: RegExp): number | null => {
    const m = t.match(re);
    return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
  };
  return {
    applicants: n(/応募した人\s*([0-9][0-9,]*)\s*人/),
    openings: n(/募集人数\s*([0-9][0-9,]*)\s*人/),
    deadline: t.match(/応募期限\s*(20[0-9]{2}年[0-9]{1,2}月[0-9]{1,2}日)/)?.[1] ?? null,
  };
}

// --- 応募の下書き一覧（ゆうさんが後からまとめて見て、承認した件だけ進める）--------------------------

export type QueueStatus = "pending" | "approved" | "sent" | "skipped";

export interface QueueItem {
  /** 一覧の番号。承認は「承認 3」のように、この番号で返す */
  no: number;
  /** 募集の番号（URLの数字） */
  id: string;
  title: string;
  url: string;
  applyUrl: string;
  verdict: string;
  reason: string;
  payType: BudgetRecord["payType"];
  /** 人が読む報酬の1行 */
  payText: string;
  /** 応募画面に入れる金額（時給なら時給の下限、固定報酬なら下限）。読めなければ null */
  price: number | null;
  applicants: number | null;
  openings: number | null;
  deadline: string | null;
  client: ClientInfo;
  proposal: string;
  /** 募集文にAIの使用の禁止・制限があるとき、禁止の範囲を抜き出した1行。なければ無い */
  aiRestriction?: string;
  /** 送る前に見ること */
  checks: string[];
  /** 機械が見送りにしたときの理由（人が「見送り」にした件には無い）。一覧の「見送りにした案件」に載る */
  skipReason?: string;
  status: QueueStatus;
  at: string;
}

export interface QueueState {
  nextNo: number;
  items: QueueItem[];
  /** 受信箱の確認結果(返事や確認が要るもの)。巡回のたびに作り直す */
  messages?: MessageNote[];
}

export const emptyQueue = (): QueueState => ({ nextNo: 1, items: [] });

/** 判定の出力の「--- 提案文 ---」から、提案文だけを取り出す。 */
export function extractProposal(detail: string): string {
  const m = detail.match(/--- 提案文 ---\n([\s\S]*?)(?:\n\s*---\s|\n\s*※|\n使ったAI:|\n保存先:|\n次:|$)/);
  return m ? cleanProposal(m[1]) : "";
}

/**
 * 提案文の本体だけにする。判定の出力は提案文のあとに「--- 応募前に確認すること ---」などの節が続くので、
 * 次の「---」の線から後ろ（相手に送ってはいけない社内メモ）は落とす。
 */
export function cleanProposal(text: string): string {
  return text.split(/\n\s*---(?:\s|$)/)[0].trim();
}

/** 提案文で「できる」と言いがちな道具・分野。経歴に無いのに経験があるように書いていないかを調べる */
const SKILL_TERMS = [
  "Googleスプレッドシート", "スプレッドシート", "Final Cut", "Premiere", "After Effects", "DaVinci", "Photoshop", "Illustrator", "Canva",
  "WordPress", "Python", "JavaScript", "GAS", "SQL", "Notion", "Slack", "Chatwork", "Figma", "SEO", "TOEIC", "英語", "翻訳", "動画編集", "ライティング", "デザイン",
];

/**
 * 提案文が、経歴（プロフィール）に書かれていない道具・分野の経験や対応を、あるように書いていないか。
 * 「Googleスプレッドシート操作は可能です」のような言い切りだけ拾う（募集の言い換えや、「経験はありません」は拾わない）。
 * 経歴が読めないとき（background が無い）は調べない。
 */
export function unbackedSkillClaims(proposal: string, background: string | undefined): string[] {
  if (background === undefined || !proposal) return [];
  const bg = background.normalize("NFKC").toLowerCase();
  const found: string[] = [];
  for (const sentence of proposal.normalize("NFKC").split(/(?<=[。！？\n])/)) {
    if (/ありません|ございません|なし|ない|未経験|初めて|新しい取り組み|不慣れ/.test(sentence)) continue;
    for (const term of SKILL_TERMS) {
      const t = term.normalize("NFKC");
      if (bg.includes(t.toLowerCase())) continue;
      const claim = new RegExp(`${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^。、,\n]{0,8}(操作|経験|可能|できます|使え|使用|使って|対応可|得意|スキル|実績|習熟)`, "i");
      if (claim.test(sentence) && !found.includes(term)) found.push(term);
    }
  }
  // 「Googleスプレッドシート」と「スプレッドシート」の二重表示を避ける
  return found.filter((t) => !found.some((o) => o !== t && o.includes(t)));
}

const FEE_RATE = 0.22;

/** 「2026年10月19日」形式の期限まであと何日か（日本時間の日付で数える）。読めなければ null */
function daysLeft(deadline: string | null, now: Date): number | null {
  const m = deadline?.match(/^(20[0-9]{2})年([0-9]{1,2})月([0-9]{1,2})日$/);
  if (!m) return null;
  const end = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const jst = new Date(now.getTime() + 9 * 3_600_000);
  const today = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
  return Math.round((end - today) / 86_400_000);
}

/**
 * 募集の本文をルールで見た結果を、「送る前に見ること」の行にする（AIは使わない）。
 * 関門（機密・表明保証・士業の独占業務・平日昼の拘束・成果報酬のみ…。AIの使用の禁止は別に扱う）と、詐欺の危険信号。
 * blocking は交渉では外せないもの（これがあれば見送りをすすめる）。
 */
export function ruleChecks(title: string, pageText: string): { lines: string[]; blocking: string[] } {
  const body = jobBodyForJudging(pageText, title).normalize("NFKC").slice(0, 6000);
  const lines: string[] = [];
  const blocking: string[] = [];
  for (const h of checkGates(body).hits) {
    if (h.id === "ai_prohibited") continue;
    lines.push(`${h.label}（募集文: 「${h.matched}」）。${h.ask}`);
    if (!h.negotiable) blocking.push(h.label);
  }
  const scam = scoreScam(body);
  if (scam.verdict !== "safe") {
    lines.push(`危険信号 ${scam.score}点（${scam.signals.map((sg) => sg.label).join("／")}）`);
    if (scam.verdict === "danger") blocking.push("詐欺・搾取の危険信号が強い");
  }
  return { lines, blocking };
}

/** 「送る前に見ること」のうち、提案文の中身から決まるものの先頭の言葉（提案文を差し替えるときに入れ替える） */
const PROPOSAL_CHECK_PREFIXES = ["提案文が出ていません", "提案文に、AIを使って", "提案文に、経歴に書かれていない", "提案文に【要確認】"];

/** 提案文の中身から決まる「送る前に見ること」。提案文が空・AIの使用・経歴に無い経験・【要確認】の残り */
export function proposalChecks(proposal: string, background?: string): string[] {
  const out: string[] = [];
  if (!proposal) out.push("提案文が出ていません。書いてから送ってください");
  // ゆうさんの方針: 提案文に「AIを使って作業・習得する」とは書かない（経歴にある「AIを使った〜の作成」は事実なのでよい）
  if (/AI(を|も|で)(使って|活用して|利用して|使い)/.test(proposal.normalize("NFKC"))) {
    out.push("提案文に、AIを使って作業・習得すると読める文があります。AIの使用は書かない方針なので、消してから送る");
  }
  const unbacked = unbackedSkillClaims(proposal, background);
  if (unbacked.length) out.push(`提案文に、経歴に書かれていない経験があるように読める箇所があります（${unbacked.join("・")}）。使ったことがなければ消してから送る`);
  const left = proposal.match(/【要確認[^】]*】/g);
  if (left) out.push(`提案文に【要確認】が${left.length}か所残っています（${left.slice(0, 2).join("、")}）。事実を確かめて直してから送る`);
  return out;
}

/** 一覧の件の提案文だけを差し替える（番号・状態・その他の注意はそのまま。提案文から決まる注意は付け直す） */
export function setProposal(item: QueueItem, proposal: string, background?: string): QueueItem {
  const next = cleanProposal(proposal);
  const kept = item.checks.filter((c) => !PROPOSAL_CHECK_PREFIXES.some((p) => c.startsWith(p)));
  return { ...item, proposal: next, checks: [...kept, ...proposalChecks(next, background)] };
}

export function buildQueueItem(args: {
  link: { key: string; url: string };
  applyUrl: string;
  title: string;
  /** 募集ページの全文（依頼者の欄を含む） */
  pageText: string;
  judged: { verdict: string; detail: string };
  /** 判定の出力ではなく、人が書いた提案文があるとき */
  proposal?: string;
  /** 経歴（プロフィール）の文章。あれば、提案文が経歴に無い経験を書いていないか調べる */
  background?: string;
  at?: Date;
}): Omit<QueueItem, "no" | "status"> {
  const rec = budgetRecord(args.link, args.title, args.pageText, args.at);
  const client = readClientInfo(args.pageText);
  const meta = readJobMeta(args.pageText);
  const proposal = cleanProposal(args.proposal ?? extractProposal(args.judged.detail));
  const checks: string[] = [];
  let verdict = args.judged.verdict;

  let payText = `${rec.payType}（金額は画面で確かめてください）`;
  let price: number | null = null;
  if (rec.hourlyJpy != null) {
    const lo = rec.hourlyJpy;
    const hi = rec.hourlyMaxJpy ?? lo;
    payText = `時給${lo.toLocaleString()}${hi !== lo ? `〜${hi.toLocaleString()}` : ""}円（手数料22%を引いて手取り約${Math.round(lo * (1 - FEE_RATE)).toLocaleString()}円〜）`;
    price = lo;
  } else if (rec.budgetJpy != null && rec.budgetEstimated) {
    // 文字単価の募集。画面の「契約金額(目安)」で、確定した額ではない。応募画面の金額欄は人が確かめて入れる
    payText = `${rec.payType} 契約金額の目安 ${rec.budgetJpy.toLocaleString()}円（文字単価から画面が計算した額。確定ではありません）`;
    checks.push("金額は文字単価からの目安です。応募画面の金額（文字単価や総額）を確かめて入れる");
  } else if (rec.budgetJpy != null) {
    const lo = rec.budgetJpy;
    const hi = rec.budgetMaxJpy ?? lo;
    payText = `${rec.payType} ${lo.toLocaleString()}${hi !== lo ? `〜${hi.toLocaleString()}` : ""}円`;
    price = lo;
  } else {
    checks.push("金額が読めませんでした。画面で確かめてから金額を入れてください");
  }

  checks.push(...proposalChecks(proposal, args.background));
  // AIの使用の禁止・制限は、一律に見送らず、禁止の範囲を載せて人が決める
  const ai = readAiRestriction(jobBodyForJudging(args.pageText, args.title));
  if (ai.restricted) {
    checks.unshift(`${ai.summary}。この範囲を、ゆうさん自身が手でやれるか決めてください（やれなければ見送り）。提案文が、その範囲を手作業で行う前提になっているかも読んで確かめる`);
    if (verdict.startsWith("応募してよい")) verdict = "確認してから応募";
  }
  // 関門・危険信号(AIの使用の禁止以外)。交渉では外せないものがあれば見送りをすすめる
  const rules = ruleChecks(args.title, args.pageText);
  checks.push(...rules.lines);
  if (rules.lines.length && verdict.startsWith("応募してよい")) verdict = "確認してから応募";
  if (rules.blocking.length) {
    verdict = "見送り";
    checks.unshift(`見送りをすすめます: ${rules.blocking.join("・")}`);
  }
  // 上位の判定(Claude)が出なかった・反映できなかったときは、そのことを一覧に出す(ルールだけの判定になっている)
  const noJudge = args.judged.detail.match(/^(ルールで判定しきれず、Claudeの判定も得られませんでした[^\n]*|Claudeの判定を反映できませんでした[^\n]*)$/m)?.[1];
  if (noJudge) checks.unshift(`${noJudge.slice(0, 200)}。ルールだけの判定です。募集文を読んで決める`);
  if (client.tier === "注意") {
    checks.push(`依頼者の評価・完了率に注意（${client.summary}）`);
    if (verdict.startsWith("応募してよい")) verdict = "確認してから応募";
  }
  if (client.tier === "不明") checks.push("依頼者の欄が読めていません。画面で評価と募集実績を確かめる");
  const left2 = daysLeft(meta.deadline, args.at ?? new Date());
  if (left2 !== null && left2 <= 1) checks.push(left2 < 0 ? `応募期限（${meta.deadline}）を過ぎています` : `応募期限が${left2 === 0 ? "今日" : "明日"}です（${meta.deadline}）。送るなら早めに`);
  if (meta.applicants !== null && meta.applicants >= 50) checks.push(`応募${meta.applicants}人${meta.openings ? `・募集${meta.openings}人` : ""}（競争が激しい）`);
  const reason = args.judged.detail.match(/^理由: (.+)$/m)?.[1]?.slice(0, 120) ?? "";
  return {
    id: args.link.key.replace(/^job:/, ""),
    title: args.title,
    url: args.link.url,
    applyUrl: args.applyUrl,
    verdict,
    reason,
    payType: rec.payType,
    payText,
    price,
    applicants: meta.applicants,
    openings: meta.openings,
    deadline: meta.deadline,
    client,
    proposal,
    ...(ai.restricted ? { aiRestriction: ai.summary } : {}),
    checks,
    at: (args.at ?? new Date()).toISOString(),
  };
}

/** 一覧に足す。同じ募集は足さない（承認済み・送信済みの印を消さないため）。 */
export function addToQueue(state: QueueState, items: Omit<QueueItem, "no" | "status">[], now: Date = new Date()): QueueState {
  const known = new Set(state.items.map((i) => i.id));
  let nextNo = state.nextNo;
  const added: QueueItem[] = [];
  for (const it of items) {
    if (known.has(it.id)) continue;
    known.add(it.id);
    added.push({ ...it, no: nextNo++, status: "pending" });
  }
  // 3週間たった未承認・見送りは一覧から外す（承認済みと送信済みは残す）
  const cutoff = now.getTime() - 21 * 86_400_000;
  const kept = state.items.filter((i) => i.status === "approved" || i.status === "sent" || new Date(i.at).getTime() >= cutoff);
  return { ...state, nextNo, items: [...kept, ...added] };
}

export function markQueue(state: QueueState, nos: number[], status: QueueStatus): { state: QueueState; changed: number[]; missing: number[] } {
  const want = new Set(nos);
  const changed: number[] = [];
  const items = state.items.map((i) => {
    if (!want.has(i.no)) return i;
    changed.push(i.no);
    return { ...i, status };
  });
  return { state: { ...state, items }, changed, missing: nos.filter((n) => !changed.includes(n)) };
}

/** 依頼者の信頼度の順（優良が先）。判定の順番を決めるのに使う */
export function clientRank(pageText: string): number {
  return TIER_RANK[readClientInfo(pageText).tier];
}

/** 並べ替え: 依頼者の信頼度 → 判定 → 報酬の大きさ → 応募の少なさ */
export function sortQueue(items: QueueItem[]): QueueItem[] {
  const pay = (i: QueueItem) => i.price ?? 0;
  return [...items].sort(
    (a, b) =>
      TIER_RANK[a.client.tier] - TIER_RANK[b.client.tier] ||
      Number(b.verdict.startsWith("応募してよい")) - Number(a.verdict.startsWith("応募してよい")) ||
      pay(b) - pay(a) ||
      (a.applicants ?? 0) - (b.applicants ?? 0)
  );
}

export function queueItemText(i: QueueItem): string {
  const lines = [
    `## 【${i.no}】${shortTitle(i.title)}　〔依頼者: ${i.client.tier}〕${i.aiRestriction ? "〔AI禁止あり〕" : ""}`,
    `- 応募画面: ${i.applyUrl}`,
    `- 募集ページ: ${i.url}`,
    `- 報酬: ${i.payText}`,
    `- 応募状況: ${i.applicants !== null ? `${i.applicants}人が応募` : "応募人数は読めず"}${i.openings ? `・募集${i.openings}人` : ""}${i.deadline ? `・応募期限 ${i.deadline}` : ""}`,
    `- 依頼者: ${i.client.summary}`,
    `- 判定: ${i.verdict}${i.reason ? ` — ${i.reason}` : ""}`,
  ];
  if (i.aiRestriction) lines.push(`- AIの使用: ${i.aiRestriction}`);
  if (i.price !== null) lines.push(`- 応募画面に入れる金額: ${i.price.toLocaleString()}円`);
  if (i.checks.length) lines.push(`- 送る前に見ること:`, ...i.checks.map((c) => `  - ${c}`));
  lines.push("", "提案文:", ...(cleanProposal(i.proposal) ? cleanProposal(i.proposal).split("\n").map((l) => `> ${l}`) : ["> （なし）"]));
  return lines.join("\n");
}

/** 一覧の表の1行ぶんの文字から、表を壊す「|」と改行を外す */
const cell = (t: string): string => t.replace(/[|\n]/g, " ").trim();

/** 一覧の表の1行（番号・案件・報酬・期限・依頼者・AI禁止・判定） */
function queueRow(i: QueueItem): string {
  const pay = i.payText.split("。")[0];
  const c = i.client;
  const client = `${c.tier}｜評価${c.rating ?? "—"}｜募集実績${c.orders ?? "—"}件｜完了率${c.completionRate ?? "—"}${c.completionRate !== null ? "%" : ""}`;
  return `| ${i.no} | ${cell(shortTitle(i.title))} | ${cell(pay.length > 60 ? `${pay.slice(0, 60)}…` : pay)} | ${i.deadline ?? "—"} | ${cell(client)} | ${i.aiRestriction ? "あり" : "なし"} | ${cell(i.verdict)} |`;
}

/**
 * ゆうさんが好きなときに見る一覧（Markdown）。承認の返事の有無に関わらず、巡回と下書きづくりは止まらない。
 * 最初に1件1行の表、その下に1件ずつの全文（URL・報酬・期限・依頼者・AI禁止・提案文）。依頼者の信頼度が高い順。
 */
export function queueMarkdown(state: QueueState, at: Date = new Date()): string {
  const pending = sortQueue(state.items.filter((i) => i.status === "pending"));
  const approved = state.items.filter((i) => i.status === "approved");
  const jst = new Date(at.getTime() + 9 * 3_600_000).toISOString().replace("T", " ").slice(0, 16);
  const out = [
    `# 応募の下書き一覧（${jst} 時点）`,
    "",
    "使い方: 送りたい件の番号を、スレッドに「承認 3 5」のように返すと、PCで入力済みの応募画面を開きます（最大5件）。「応募する」を押すのはゆうさんです。",
    "送らない件は「見送り 2」と返すと一覧から外します。返事がなくても、巡回と下書きづくりは続き、この一覧に足されていきます。",
    "並べ方: 募集実績が多く、評価と完了率が高い依頼者を上に出しています。",
    "",
    `一覧 ${pending.length}件／承認済み ${approved.length}件${state.messages?.length ? `／受信箱で返事や確認が要るメッセージ ${state.messages.length}件（次の項）` : ""}`,
  ];
  if (state.messages?.length) {
    const label = { danger: "危険（返信せず離れる）", caution: "注意（確認してから）", reply: "返事を考える" } as const;
    out.push("", "# 受信箱で返事や確認が要るメッセージ（巡回のたびに作り直します）", "");
    for (const [i, m] of state.messages.entries()) {
      out.push(
        `## 【M${i + 1}】${m.from ? `${m.from}｜` : ""}${m.title}${m.fresh ? "　【新着】" : ""}`,
        "",
        `- 見立て: ${label[m.kind]}${m.status ? `／状態: ${m.status}` : ""}${m.why ? `／${m.why}` : ""}`,
        `- 画面: ${m.url}`,
        `- 相手の最後の発言: ${m.at ? m.at.slice(0, 16).replace("T", " ") : "日時不明"}${m.daysAgo !== null ? `（${m.daysAgo}日前）` : ""}`,
        `- 内容の冒頭: ${m.gist || "（読めませんでした）"}`,
        ...(m.notes ? [`- 画面の注意: ${m.notes}`] : []),
        ...(m.advice ? [`- 対応: ${m.advice}`] : []),
        ...(m.draft ? ["- 返信の下書き（クラウドワークスのメッセージ欄に貼る。送るのはゆうさんです）:", "", ...m.draft.split("\n").map((l) => `> ${l}`)] : []),
        ""
      );
    }
  }
  if (approved.length) out.push("", "# 承認済み（応募画面を開いてあります。「応募する」を押すだけ）", ...approved.map((i) => `- 【${i.no}】${shortTitle(i.title)} ${i.applyUrl}`));
  if (pending.length) {
    out.push(
      "",
      "# 一覧（1件1行）",
      "",
      "| 番号 | 案件 | 報酬 | 応募期限 | 依頼者 | AI禁止 | 判定 |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...pending.map(queueRow),
      "",
      "# 1件ずつ（URL・報酬・提案文の全文）",
      "",
      ...pending.flatMap((i) => [queueItemText(i), ""])
    );
  } else out.push("", "一覧に載っている案件はありません。");
  const machineSkipped = state.items.filter((i) => i.status === "skipped" && i.skipReason);
  if (machineSkipped.length) {
    out.push(
      "",
      "# 見送りにした案件（理由つき。見送りの理由に納得できなければ「承認 番号」で一覧に戻せます）",
      "",
      "| 番号 | 案件 | 理由 |",
      "| --- | --- | --- |",
      ...machineSkipped.map((i) => `| ${i.no} | ${cell(shortTitle(i.title))}（${i.url}） | ${cell(i.skipReason ?? "").slice(0, 300)} |`)
    );
  }
  return out.join("\n");
}
