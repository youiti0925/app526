/**
 * クラウドワークスの「相談から契約まで」の画面テキストを読んで、返事待ち・危険信号・金額のミスを洗い出す。
 *
 * 入力は、ユーザー本人がログインした自分の画面から取り込んだテキスト（ブックマークレットか手動コピー）。
 * このコードは通信をしない。AIも使わない（ルールだけ）ので、使用量はかからない。
 * 詐欺ルールは相手（クライアント）の発言にだけ当てる。自分の発言には当てない。
 */
import { combineSignals, scoreScam, type ScamScoreResult } from "../scam-rules";
import type { ScamSignalHit } from "../types";

export interface CwMessage {
  from: string;
  /** 日本時間の ISO 文字列（+09:00）。読めなければ null */
  at: string | null;
  text: string;
  mine: boolean;
}

export interface CwOffer {
  min: number;
  max: number;
}

export interface CwThread {
  title: string;
  /** 画面の状態を示す文（条件確認中・否認など）。読めなければ空 */
  stage: string;
  messages: CwMessage[];
  postedOffer: CwOffer | null;
  myLatestOffer: number | null;
  noWorkNotice: boolean;
  /** 画面全体の文字（画面の注意書きの確認用。保存はしない） */
  rawText?: string;
}

export interface CwReview {
  thread: CwThread;
  /** 最後の発言から何日たったか。発言が無ければ null */
  daysSinceLast: number | null;
  /** 次に動くのは誰か */
  waiting: "me" | "client" | "none";
  scam: ScamScoreResult | null;
  flags: string[];
  actions: string[];
}

const DATE_LINE = /^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})$/;
const THREAD_HEAD = /^相談から契約まで[：:]/;
const NOTICE_LINES = [/^問題報告$/, /^違反報告をする$/, /^【取り込み】/];

function toIso(m: RegExpMatchArray): string {
  const p = (n: string) => n.padStart(2, "0");
  return `${m[1]}-${p(m[2])}-${p(m[3])}T${p(m[4])}:${m[5]}:00+09:00`;
}

const yen = (s: string) => Number(s.replace(/,/g, ""));

/** 貼り付けられた全体を、スレッドごとに分けて読む。見出しが無ければ全体を1つとして読む。 */
export function parseCwThreads(raw: string, myName: string): CwThread[] {
  const lines = raw.replace(/\r/g, "").split("\n");
  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (THREAD_HEAD.test(l.trim())) starts.push(i);
  });
  if (starts.length === 0) return [parseOne(lines, myName)];
  return starts.map((s, k) => parseOne(lines.slice(s, starts[k + 1] ?? lines.length), myName));
}

function parseOne(lines: string[], myName: string): CwThread {
  const first = lines.find((l) => l.trim()) ?? "";
  const title = first.trim().replace(THREAD_HEAD, "").trim() || "（題名が読めません）";
  const joined = lines.join("\n");

  // 画面の状態の文（「現在、…」で始まる行）
  const stageLine = lines.map((l) => l.trim()).find((l) => /^現在、/.test(l)) ?? "";
  const stage = stageLine || (/否認/.test(joined) ? "否認" : "");

  const posted = joined.match(/募集条件[\s\S]{0,40}?固定報酬[:：]\s*([\d,]+)円\s*[〜~～]\s*([\d,]+)円/);
  const mine = joined.match(/自分\s*[»>]\s*\S+\s*固定報酬[:：]\s*([\d,]+)円/);

  // メッセージ欄は「※現在やりとりしているメッセージは…」の行より後。無ければ全体から日時行を探す
  let from = lines.findIndex((l) => l.includes("現在やりとりしているメッセージは"));
  from = from >= 0 ? from + 1 : 0;

  const dateIdx: number[] = [];
  for (let i = from; i < lines.length; i++) if (DATE_LINE.test(lines[i].trim())) dateIdx.push(i);

  const speakerAt = (i: number): number => {
    for (let j = i - 1; j >= from; j--) if (lines[j].trim()) return j;
    return -1;
  };

  const messages: CwMessage[] = [];
  dateIdx.forEach((di, k) => {
    const sp = speakerAt(di);
    if (sp < 0) return;
    const nextSp = k + 1 < dateIdx.length ? speakerAt(dateIdx[k + 1]) : lines.length;
    const body = lines
      .slice(di + 1, Math.max(di + 1, nextSp))
      .filter((l) => !NOTICE_LINES.some((re) => re.test(l.trim())))
      .join("\n")
      .trim();
    const name = lines[sp].trim();
    messages.push({
      from: name,
      at: toIso(lines[di].trim().match(DATE_LINE)!),
      text: body,
      mine: name === myName,
    });
  });

  return {
    title,
    stage,
    messages,
    postedOffer: posted ? { min: yen(posted[1]), max: yen(posted[2]) } : null,
    myLatestOffer: mine ? yen(mine[1]) : null,
    noWorkNotice: /まだ業務を開始しないでください/.test(joined),
    rawText: joined,
  };
}

/**
 * 相手のメッセージが、クラウドワークスの外のチャット(チャットワーク・LINE など)へ誘っているか。
 * 募集文のほうは「連絡はチャットワークで」と普通に書かれるので、ここ(契約・応募後のメッセージ)にだけ当てる。
 */
const OFFPLATFORM_CHAT = [
  /chatwork\.com\/[A-Za-z0-9_\-]{3,}/i,
  /(チャットワーク|chatwork)[^。\n]{0,40}(コンタクト|追加|検索|登録|接続)/i,
  /(チャットワーク|chatwork)[^。\n]{0,20}(にて|で|から)[^。\n]{0,12}(ご?連絡|やり取り|やりとり|ご案内)/i,
  /(LINE|ライン|スカイプ|Skype|テレグラム|Telegram|ディスコード|Discord|WhatsApp)[^。\n]{0,30}(にて|で|へ|に)[^。\n]{0,12}(ご?連絡|やり取り|やりとり|ご案内|追加|登録)/i,
];

export function offplatformSignal(clientText: string): ScamSignalHit | null {
  const text = clientText.normalize("NFKC");
  for (const re of OFFPLATFORM_CHAT) {
    const m = text.match(re);
    if (m && m.index !== undefined) {
      const start = Math.max(0, m.index - 15);
      return {
        id: "thread_offplatform_chat",
        label: "メッセージで、クラウドワークスの外のチャット（チャットワーク・LINEなど）へ誘っている",
        weight: 9,
        why:
          "クラウドワークスでは、外部の連絡先の交換は事務局の「サービス外連絡申請」で承認された場合だけ認められています。" +
          "外のチャットに連れ出して、教材・サポート費・別サービスの勧誘や、記録の残らないやり取りに進む例が多い型です。\n" +
          "→ 連絡先は追加せず、クラウドワークスの中でやり取りするよう伝えてください。応じなければ「違反報告」ができます。",
        excerpt: text.slice(start, m.index + m[0].length + 15).replace(/\s+/g, " "),
      };
    }
  }
  return null;
}

const DAY_MS = 24 * 3600 * 1000;

/** now は日本時間で比べるための現在時刻（テストでは固定値を渡す）。 */
export function reviewCwThread(thread: CwThread, now: Date): CwReview {
  const flags: string[] = [];
  const actions: string[] = [];
  const last = thread.messages[thread.messages.length - 1];

  let daysSinceLast: number | null = null;
  let waiting: CwReview["waiting"] = "none";
  if (last) {
    waiting = last.mine ? "client" : "me";
    if (last.at) daysSinceLast = Math.max(0, Math.floor((now.getTime() - new Date(last.at).getTime()) / DAY_MS));
  }

  if (waiting === "me") {
    actions.push(
      `${last.from}さんの最後のメッセージにまだ返していません${daysSinceLast !== null ? `（${daysSinceLast}日前）` : ""}。返事するか、辞退するか決めてください`
    );
  } else if (waiting === "client" && daysSinceLast !== null && daysSinceLast >= 7) {
    actions.push(`あなたが送ってから${daysSinceLast}日、相手から返事がありません。動きがなければ見送りで構いません`);
  }

  // 自分の提示額が募集の上限を大きく超えている（入力ミスの疑い）
  if (thread.postedOffer && thread.myLatestOffer !== null && thread.myLatestOffer > thread.postedOffer.max * 2) {
    flags.push(
      `あなたの提示額（${thread.myLatestOffer.toLocaleString()}円）が募集の上限（${thread.postedOffer.max.toLocaleString()}円）の2倍を超えています。入力ミスなら、条件を直すか、メッセージで伝えてください`
    );
  }

  if (thread.noWorkNotice) {
    flags.push("画面に「まだ業務を開始しないでください」とあります。契約と仮払いが画面に出るまで、作業しないでください");
  }

  const clientText = thread.messages
    .filter((m) => !m.mine)
    .map((m) => m.text)
    .join("\n\n");
  let scam = clientText.trim().length >= 10 ? scoreScam(clientText) : null;
  const off = offplatformSignal(clientText);
  if (off) {
    scam = combineSignals([...(scam?.signals ?? []), ...(scam?.signals.some((s) => s.id === off.id) ? [] : [off])]);
    if (/サービス外連絡申請[^\n]{0,30}否認/.test(thread.rawText ?? "")) {
      flags.push("依頼者のサービス外連絡申請は、クラウドワークスに否認されています。外のチャットへの誘いには応じないでください");
    }
    // 危険な相手には「返事するか決めてください」より、外へ出ないことを先に伝える
    for (let i = actions.length - 1; i >= 0; i--) if (actions[i].includes("まだ返していません")) actions.splice(i, 1);
    actions.push("チャットワークなどの連絡先は追加しない。クラウドワークスの中で「ここでやり取りしたい」と1回だけ伝え、応じなければ違反報告する");
  }

  return { thread, daysSinceLast, waiting, scam, flags, actions };
}

/** 「安全」とは言わない。見つからなかっただけで、保証ではない。 */
export function scamLabel(scam: ScamScoreResult | null): string {
  if (!scam) return "相手の発言が少なく、判定できません";
  if (scam.verdict === "danger") return `危険（${scam.score}点）`;
  if (scam.verdict === "caution") return `注意（${scam.score}点）`;
  return "目立った危険信号は見つかりませんでした（安全の保証ではありません）";
}

export function formatCwReview(r: CwReview): string {
  const lines = [`■ ${r.thread.title}`];
  if (r.thread.stage) lines.push(`状態: ${r.thread.stage}`);
  const last = r.thread.messages[r.thread.messages.length - 1];
  if (last) {
    lines.push(
      `最後の発言: ${last.mine ? "あなた" : last.from}（${last.at ? last.at.slice(0, 16).replace("T", " ") : "日時不明"}${r.daysSinceLast !== null ? `・${r.daysSinceLast}日前` : ""}）`
    );
  } else {
    lines.push("メッセージが読めませんでした（画面全体をコピーできているか確認してください）");
  }
  lines.push(`危険信号: ${scamLabel(r.scam)}`);
  for (const s of r.scam?.signals.slice(0, 3) ?? []) {
    lines.push(`  ・${s.label}: ${s.why.split("\n")[0]}`);
  }
  for (const f of r.flags) lines.push(`⚠ ${f}`);
  for (const a of r.actions) lines.push(`→ ${a}`);
  return lines.join("\n");
}
