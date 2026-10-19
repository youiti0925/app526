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
  /** 画面に出ている「サービス外連絡申請が否認」の表示(その行と続く数行)。無ければ undefined */
  denialNotice?: string;
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
  /** 外のチャットへ誘われたときに、クラウドワークスの中で理由を聞く返信の下書き。送るのはあなた */
  draftReply?: string;
}

const DATE_LINE = /^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})$/;
const THREAD_HEAD = /^相談から契約まで[：:]/;
const NOTICE_LINES = [/^問題報告$/, /^違反報告をする$/, /^【取り込み】/];
/** メッセージ欄の下に出る画面の定型文(添付の容量・条件の提示ボタンなど)。ここから先は発言の本文ではない */
const UI_FOOTER = [/^計\s*[\d.,]+\s*[KMG]?B\s*[\/／]\s*[\d.,]+\s*[KMG]?B/i, /^新しい条件を提示する/, /^テンプレートを選択/];

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
    const rawBody = lines.slice(di + 1, Math.max(di + 1, nextSp));
    const cut = rawBody.findIndex((l) => UI_FOOTER.some((re) => re.test(l.trim())));
    const body = (cut >= 0 ? rawBody.slice(0, cut) : rawBody)
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

  const denialIdx = lines.findIndex((l) => /サービス外連絡申請[^\n]{0,30}否認/.test(l));
  const denialNotice =
    denialIdx >= 0
      ? lines
          .slice(denialIdx, denialIdx + 4)
          .map((l) => l.trim())
          .filter(Boolean)
          .join(" ／ ")
          .slice(0, 300)
      : undefined;

  return {
    title,
    stage,
    messages,
    postedOffer: posted ? { min: yen(posted[1]), max: yen(posted[2]) } : null,
    myLatestOffer: mine ? yen(mine[1]) : null,
    noWorkNotice: /まだ業務を開始しないでください/.test(joined),
    rawText: joined,
    ...(denialNotice ? { denialNotice } : {}),
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

/** 質問済みかどうかを見分ける目印。下書きの文に必ず入れる */
export const ASKED_MARK = "外部でのやり取りが必要な理由";

/** 誘われている外のサービスの名前(文から読む。読めなければ「外部のチャット」) */
export function offplatformServiceName(text: string): string {
  const t = text.normalize("NFKC");
  if (/チャットワーク|chatwork/i.test(t)) return "チャットワーク";
  if (/LINE|ライン|lin\.ee|line\.me/i.test(t)) return "LINE";
  if (/テレグラム|telegram|t\.me\//i.test(t)) return "Telegram";
  if (/ディスコード|discord/i.test(t)) return "Discord";
  if (/スカイプ|skype/i.test(t)) return "Skype";
  if (/timerex|calendly|spir|予約/i.test(t)) return "外部の予約サイト";
  return "外部のチャット";
}

/**
 * 外のチャットへ誘われたときに、クラウドワークスの中で理由を聞く文。AIは使わない。
 * denied: 画面にサービス外連絡申請の「否認」が出ているとき／afterPayment: 仮払いが済んでいるとき
 */
export function externalContactQuestion(opts: { service: string; denied: boolean; afterPayment: boolean }): string {
  const lines = ["お世話になっております。" + (opts.afterPayment ? "仮払いのご対応ありがとうございます。" : "ご連絡ありがとうございます。")];
  lines.push(
    opts.denied
      ? `${opts.service}でのご連絡とのことですが、サービス外連絡申請が「否認」と画面に表示されております。クラウドワークスの規約上、外部サービスの連絡先の追加はいたしかねます。`
      : `${opts.service}でのご連絡とのことですが、クラウドワークスの規約上、外部サービスの連絡先の追加はいたしかねます。`
  );
  lines.push(
    "お手数ですが、次の点を、このメッセージ内で教えていただけますでしょうか。",
    `1. ${ASKED_MARK}`,
    "2. クラウドワークスのメッセージ内では進められない理由",
    opts.denied ? "3. 申請が否認された理由について、ご存じの内容があれば" : "3. お仕事の内容・報酬・納期（先にこのメッセージ内でご提示いただけますと助かります）",
    "ご回答を確認のうえ、対応できるか判断いたします。よろしくお願いいたします。"
  );
  return lines.join("\n");
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
  let draftReply: string | undefined;
  if (off) {
    scam = combineSignals([...(scam?.signals ?? []), ...(scam?.signals.some((s) => s.id === off.id) ? [] : [off])]);
    const denied = /サービス外連絡申請[^\n]{0,30}否認/.test(thread.rawText ?? "");
    if (denied) {
      // 否認の理由が画面に書かれていればそのまま出す。無ければ、無いと言う(理由は事務局が開示しないとされる。公式ページでは確かめられていない)
      const shown = thread.denialNotice ?? "";
      const reasonOnScreen = /理由|ため|違反|規約|基準/.test(shown.replace(/サービス外連絡申請[^／]*否認[^／]*/, "").replace(/※[^／]*外部の連絡先[^／]*/, ""));
      flags.push(
        "依頼者のサービス外連絡申請は、クラウドワークスに否認されています。外のチャットへの誘いには応じないでください" +
          (reasonOnScreen ? `（画面の表示: ${shown}）` : "。否認の理由は画面に出ていません（事務局は理由の詳細を開示しないとされています。公式ページでは確かめられていません）")
      );
    }
    // 危険な相手には「返事するか決めてください」より、外へ出ないことを先に伝える
    for (let i = actions.length - 1; i >= 0; i--) if (actions[i].includes("まだ返していません")) actions.splice(i, 1);
    actions.push("チャットワークなどの連絡先は追加しない。クラウドワークスの中で理由を聞き、応じなければ違反報告する");

    // 理由を聞く質問は、まだ聞いていないときだけ下書きを作る。聞いたあとは、相手の返事を判定する
    const askIdx = thread.messages.reduce((acc, m, i) => (m.mine && m.text.includes(ASKED_MARK) ? i : acc), -1);
    if (askIdx < 0) {
      if (waiting === "me") {
        draftReply = externalContactQuestion({
          service: offplatformServiceName(clientText),
          denied,
          afterPayment: /仮払い/.test(clientText),
        });
        actions.push("外部が必要な理由を聞く返信の下書きを作りました。クラウドワークスのメッセージ欄に貼って送ってください");
      }
    } else {
      const after = thread.messages.slice(askIdx + 1).filter((m) => !m.mine);
      if (after.length === 0) {
        flags.push("外部が必要な理由を、クラウドワークスの中で質問済みです。相手の返事が来たら、巡回が読んで判定します");
      } else if (offplatformSignal(after.map((m) => m.text).join("\n"))) {
        flags.push("理由を質問したあとも、答えずに外のチャットへ誘っています。応じず、契約中なら「契約途中終了リクエスト」と「違反報告」をおすすめします");
      } else {
        flags.push("理由の質問に、相手の返事があります。外のチャットには誘っていません。内容を読んで、クラウドワークスの中で進められるか決めてください");
      }
    }
  }

  // 危険信号が強い相手には、「返事するか決めてください」と言わない(巡回のまとめで「返事をしなくてよい」と言うのと食い違うため)
  if (!off && scam?.verdict === "danger") {
    for (let i = actions.length - 1; i >= 0; i--) if (actions[i].includes("まだ返していません")) actions.splice(i, 1);
    actions.push("返信しない(辞退の一言も不要)。連絡先やリンクは開かない");
  }

  return { thread, daysSinceLast, waiting, scam, flags, actions, ...(draftReply ? { draftReply } : {}) };
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
