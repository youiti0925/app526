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
import { getCapability, judgeDeliverability } from "../agent/deliverability";
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
  /** 応募の下書き一覧。今回増えた分と、承認待ちの合計 */
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
        `応募の下書き一覧に ${input.queue.added.length}件 足しました（承認待ちは全部で ${input.queue.pendingTotal}件）。依頼者の信頼度が高い順です。`,
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
  /** Claude が作業して納品できる募集か（関門と納品物の判定を通ったか）。古い記録には無い */
  delivers?: boolean;
  /** 納品できるときの仕事の種類（文章・文書／コード・スクリプト など）。納品できなければ null */
  genre?: string | null;
  /** 募集文にAIの使用の禁止・制限が書かれているか */
  aiRestricted?: boolean;
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
  for (const m of body.matchAll(/(固定報酬制|時間単価制|コンペ形式|タスク形式)/g)) {
    const mm = m as RegExpExecArray;
    if (/[(（]/.test(body[mm.index - 1] ?? "")) continue;
    first ??= mm;
    const section = body.slice(mm.index, mm.index + 90);
    if (new RegExp(AMOUNT).test(section) || /相談/.test(section)) return mm;
  }
  return first;
}

/** 「必要なスキル」の欄（次の見出しまでの短い範囲）。Excel の仕事かどうかは、題名とここを一番信用する */
function skillsOf(body: string): string {
  return body.match(/必要なスキル([\s\S]{0,100})/)?.[1] ?? "";
}

/** 読んだ募集から、予算と種類を1件分の記録にする。分類は、依頼者欄・おすすめより前の本文だけで行う。 */
export function budgetRecord(link: { key: string; url: string }, title: string, text: string, at: Date = new Date()): BudgetRecord {
  const body = jobBodyForJudging(text).normalize("NFKC").slice(0, 6000);
  const head = body.slice(0, 600);
  // 募集ページの先頭に出る「固定報酬制」「時間単価制」「コンペ形式」「タスク形式」の最初のものがその募集の支払い方式
  const PAY_TYPES: Record<string, BudgetRecord["payType"]> = { 固定報酬制: "固定報酬", 時間単価制: "時間単価", コンペ形式: "コンペ", タスク形式: "タスク" };
  const found = findPayLabel(body);
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
    // 題名か「必要なスキル」に出ていれば当たり。本文だけなら、飾りの語に引っ張られないよう多めに出たものだけ
    excelVba: mentions(EXCEL_VBA, `${title}\n${skillsOf(body)}`, body, 6),
    quality: mentions(QUALITY, `${title}\n${skillsOf(body)}`, body, 3),
    payType,
    ...deliveryOf(body),
  };
}

/**
 * 募集の本文から、Claude が作業して納品できるか・どんな種類の仕事か・AIの使用が禁止されていないかを
 * （AIを使わず、ルールだけで）読む。確認すれば通る関門（AIの禁止・納品形式など）は、納品できる側に数える。
 */
function deliveryOf(body: string): { delivers: boolean; genre: string | null; aiRestricted: boolean } {
  const d = judgeDeliverability(body);
  const gates = checkGates(body);
  const delivers = d.canDeliver && gates.hits.every((h) => h.negotiable);
  const first = d.canDeliver ? d.matched.map((id) => getCapability(id)).find((c) => c && !c.needsPaid) : undefined;
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
  status: QueueStatus;
  at: string;
}

export interface QueueState {
  nextNo: number;
  items: QueueItem[];
}

export const emptyQueue = (): QueueState => ({ nextNo: 1, items: [] });

/** 判定の出力の「--- 提案文 ---」から、提案文だけを取り出す。 */
export function extractProposal(detail: string): string {
  const m = detail.match(/--- 提案文 ---\n([\s\S]*?)(?:\n\s*※|\n使ったAI:|\n保存先:|\n次:|$)/);
  return m ? m[1].trim() : "";
}

const FEE_RATE = 0.22;

export function buildQueueItem(args: {
  link: { key: string; url: string };
  applyUrl: string;
  title: string;
  /** 募集ページの全文（依頼者の欄を含む） */
  pageText: string;
  judged: { verdict: string; detail: string };
  /** 判定の出力ではなく、人が書いた提案文があるとき */
  proposal?: string;
  at?: Date;
}): Omit<QueueItem, "no" | "status"> {
  const rec = budgetRecord(args.link, args.title, args.pageText, args.at);
  const client = readClientInfo(args.pageText);
  const meta = readJobMeta(args.pageText);
  const proposal = (args.proposal ?? extractProposal(args.judged.detail)).trim();
  const checks: string[] = [];
  let verdict = args.judged.verdict;

  let payText = `${rec.payType}（金額は画面で確かめてください）`;
  let price: number | null = null;
  if (rec.hourlyJpy != null) {
    const lo = rec.hourlyJpy;
    const hi = rec.hourlyMaxJpy ?? lo;
    payText = `時給${lo.toLocaleString()}${hi !== lo ? `〜${hi.toLocaleString()}` : ""}円（手数料22%を引いて手取り約${Math.round(lo * (1 - FEE_RATE)).toLocaleString()}円〜）`;
    price = lo;
  } else if (rec.budgetJpy != null) {
    const lo = rec.budgetJpy;
    const hi = rec.budgetMaxJpy ?? lo;
    payText = `${rec.payType} ${lo.toLocaleString()}${hi !== lo ? `〜${hi.toLocaleString()}` : ""}円`;
    price = lo;
  } else {
    checks.push("金額が読めませんでした。画面で確かめてから金額を入れてください");
  }

  if (!proposal) checks.push("提案文が出ていません。書いてから送ってください");
  const left = proposal.match(/【要確認[^】]*】/g);
  if (left) checks.push(`提案文に【要確認】が${left.length}か所残っています（${left.slice(0, 2).join("、")}）。事実を確かめて直してから送る`);
  // AIの使用の禁止・制限は、一律に見送らず、禁止の範囲を載せて人が決める
  const ai = readAiRestriction(jobBodyForJudging(args.pageText));
  if (ai.restricted) {
    checks.unshift(`${ai.summary}。この範囲を、ゆうさん自身が手でやれるか決めてください（やれなければ見送り）。提案文が、その範囲を手作業で行う前提になっているかも読んで確かめる`);
    if (verdict.startsWith("応募してよい")) verdict = "確認してから応募";
  }
  if (client.tier === "注意") {
    checks.push(`依頼者の評価・完了率に注意（${client.summary}）`);
    if (verdict.startsWith("応募してよい")) verdict = "確認してから応募";
  }
  if (client.tier === "不明") checks.push("依頼者の欄が読めていません。画面で評価と募集実績を確かめる");
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
  return { nextNo, items: [...kept, ...added] };
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
  lines.push("", "提案文:", ...(i.proposal ? i.proposal.split("\n").map((l) => `> ${l}`) : ["> （なし）"]));
  return lines.join("\n");
}

/** ゆうさんが後から見る一覧（Markdown）。承認待ちを、依頼者の信頼度が高い順に並べる。 */
export function queueMarkdown(state: QueueState, at: Date = new Date()): string {
  const pending = sortQueue(state.items.filter((i) => i.status === "pending"));
  const approved = state.items.filter((i) => i.status === "approved");
  const jst = new Date(at.getTime() + 9 * 3_600_000).toISOString().replace("T", " ").slice(0, 16);
  const out = [
    `# 応募の下書き一覧（${jst} 時点）`,
    "",
    "承認のしかた: 送りたい件の番号を、スレッドに「承認 3 5」のように返します。承認した件だけ、PCで入力済みの応募画面を開きます（最大5件）。",
    "「応募する」を押すのはゆうさんです。承認のない件は、入力も送信もしません。送らない件は「見送り 2」と返すと一覧から外します。",
    "依頼者の並べ方: 募集実績が多く、評価と完了率が高い依頼者を上に出しています。",
    "",
    `承認待ち ${pending.length}件／承認済み（送信待ち） ${approved.length}件`,
  ];
  if (approved.length) out.push("", "# 承認済み（送信待ち）", ...approved.map((i) => `- 【${i.no}】${shortTitle(i.title)} ${i.applyUrl}`));
  if (pending.length) out.push("", "# 承認待ち", "", ...pending.flatMap((i) => [queueItemText(i), ""]));
  else out.push("", "承認待ちはありません。");
  return out.join("\n");
}
