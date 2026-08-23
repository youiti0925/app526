/**
 * 契約の形の読み取り。
 *
 * なぜ要るか:
 * 実データで、月額150万円・想定稼働140時間/月 の準委任案件を
 * 「1案件の報酬150万円 ÷ 想定14〜21時間」と計算して、
 * 実効時給 57,119〜85,679円 という数字を出してしまった。
 *
 * 月額の契約と、1件いくらの請負は、まったく別物として扱う必要がある。
 *   - 月額: 時給 = 月額 ÷ 月の稼働時間。稼働時間は先方が決めている。
 *   - 請負: 時給 = 報酬 ÷ こちらの見積り工数。
 *
 * さらに月額契約は、週に何時間出せるかで受けられるかどうかが決まる。
 * 週10時間しか出せない人に月140時間の案件を勧めても意味がない。
 * 金額を見る前に、ここで落とす。
 */

export type EngagementKind =
  | "monthly" // 月額（準委任・常駐・週◯日）
  | "fixed" // 1件いくら（請負）
  | "hourly" // 時給
  | "unknown";

export const ENGAGEMENT_LABELS: Record<EngagementKind, string> = {
  monthly: "月額契約",
  fixed: "1件いくらの請負",
  hourly: "時給",
  unknown: "契約の形が読み取れない",
};

export interface Engagement {
  kind: EngagementKind;
  /** 月額（円）。kind が monthly のときに入る。 */
  monthlyJpy: number | null;
  /** 時給（円）。kind が hourly のときに入る。 */
  hourlyJpy: number | null;
  /** 月の想定稼働時間。読めたぶんだけ。 */
  monthlyHours: number | null;
  /** 週の想定稼働日数 */
  daysPerWeek: number | null;
  /** 出社・常駐が要るか */
  onsite: "required" | "partial" | "remote" | "unknown";
  /** 何を読んだか。人に見せる。 */
  basis: string;
}

const WEEKS_PER_MONTH = 4.3;

const toNum = (s: string): number => Number(s.replace(/[,，\s]/g, ""));

/**
 * 金額は「単位」から読む。ラベルからではない。
 *
 * 実データのページはこう並んでいた:
 *   単価税抜 / 95 / 〜 / 115 / 万円/月
 * ラベルと数字の間に別の行が挟まるので、ラベル起点だと読めない。
 * 逆に「万円/月」という単位は、金額の直後に必ず来る。
 * 範囲のときは安いほうを取る（楽観に倒さないため）。
 */
export function readMonthlyRate(raw: string): number | null {
  const text = raw.normalize("NFKC");
  // 範囲は安いほうを取る。楽観に倒さないため。
  // 「60万円〜80万円／月」で 80万 を取っていた。原因は、単位の直前にある数字
  // （＝範囲の上限）だけを見ていたこと。両端を拾って小さいほうを使う。
  const man = text.match(
    /([0-9][0-9,]{0,4})\s*(?:万円?)?\s*[〜~ー－-]\s*([0-9][0-9,]{0,4})\s*万円\s*[\/／]?\s*(?:月|人月)/
  );
  if (man) {
    const lo = Math.min(toNum(man[1]), toNum(man[2]));
    if (Number.isFinite(lo) && lo >= 5 && lo <= 500) return Math.round(lo * 10_000);
  }
  const single = text.match(/([0-9][0-9,]{0,4})\s*万円\s*[\/／]?\s*(?:月|人月)/);
  if (single) {
    const n = toNum(single[1]);
    if (Number.isFinite(n) && n >= 5 && n <= 500) return Math.round(n * 10_000);
  }
  const labelled = text.match(/(?:月額|月単価|月給|月報酬)[^0-9０-９]{0,12}([0-9][0-9,]{2,8})\s*円/);
  if (labelled) {
    const n = toNum(labelled[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const labelledMan = text.match(
    /(?:月額|月単価|月給|月報酬)[^0-9]{0,12}([0-9][0-9,]{0,4})\s*(?:万円?)?\s*(?:[〜~ー－-]\s*([0-9][0-9,]{0,4})\s*)?万/
  );
  if (labelledMan) {
    const n = labelledMan[2]
      ? Math.min(toNum(labelledMan[1]), toNum(labelledMan[2]))
      : toNum(labelledMan[1]);
    if (Number.isFinite(n) && n >= 5 && n <= 500) return Math.round(n * 10_000);
  }
  return null;
}

export function readHourlyRate(raw: string): number | null {
  const text = raw.normalize("NFKC");
  const m = text.match(/(?:時給|時間単価)[^0-9０-９]{0,10}([0-9][0-9,]{2,6})\s*円/);
  if (!m) return null;
  const n = toNum(m[1]);
  return Number.isFinite(n) && n >= 100 && n <= 50_000 ? n : null;
}

export function readEngagement(text: string, budgetHintJpy: number | null = null): Engagement {
  // 他のモジュール（ingest / estimate / worktypes / gates / deadline / scam-rules）は
  // 全部 NFKC 正規化しているのに、ここだけ抜けていた。
  // そのせいで全角で書かれた「１５０万円」「１４０時間／月」を1つも読めていなかった。
  const t = text.normalize("NFKC").slice(0, 8000);

  const monthlyHours = readMonthlyHours(t);
  const daysPerWeek = readDaysPerWeek(t);
  const onsite = readOnsite(t);
  const hourly = readHourlyRate(t);
  const looksMonthly = monthlyHours !== null || daysPerWeek !== null;

  if (hourly !== null) {
    return {
      kind: "hourly",
      monthlyJpy: null,
      hourlyJpy: hourly,
      monthlyHours,
      daysPerWeek,
      onsite,
      basis: `時給 ${hourly.toLocaleString()}円 と書かれています。`,
    };
  }

  // 月額が読めなかったが、稼働時間の指定があって金額だけ拾えている場合は、
  // その金額を月額として扱う。月稼働80時間の案件の「150万円」は月額。
  const monthly = readMonthlyRate(t) ?? (looksMonthly ? budgetHintJpy : null);

  if (monthly !== null && monthly > 0) {
    const hours =
      monthlyHours ?? (daysPerWeek !== null ? Math.round(daysPerWeek * 8 * WEEKS_PER_MONTH) : null);
    const parts = [`月額 ${monthly.toLocaleString()}円`];
    if (monthlyHours !== null) parts.push(`想定稼働 ${monthlyHours}時間/月`);
    else if (daysPerWeek !== null) parts.push(`週${daysPerWeek}日（月 約${hours}時間として計算）`);
    else parts.push("稼働時間の記載なし（時給は計算できません）");
    return {
      kind: "monthly",
      monthlyJpy: monthly,
      hourlyJpy: null,
      monthlyHours: hours,
      daysPerWeek,
      onsite,
      basis: parts.join(" / ") + "。",
    };
  }

  return {
    kind: looksMonthly ? "monthly" : "fixed",
    monthlyJpy: null,
    hourlyJpy: null,
    monthlyHours,
    daysPerWeek,
    onsite,
    basis: looksMonthly
      ? "稼働時間の指定はありますが、金額が読み取れませんでした。"
      : "1件いくらの請負として扱います。",
  };
}

/** 「稼働時間 140時間/月」「月140h」「140〜180時間」 */
function readMonthlyHours(text: string): number | null {
  const m =
    // 「精算時間 140時間〜180時間」はエージェント案件の定番表記
    text.match(
      /(?:精算時間|清算時間|稼働(?:時間|想定)?|想定稼働|月)[^0-9]{0,8}([0-9]{2,3})(?:\s*[〜~ー-]\s*[0-9]{2,3})?\s*(?:時間|h)/i
    ) ?? text.match(/([0-9]{2,3})(?:\s*[〜~ー-]\s*[0-9]{2,3})?\s*(?:時間|h)\s*[\/／]?\s*月/i);
  if (!m) return null;
  const n = Number(m[1]);
  // 月の稼働として現実的な範囲だけ通す（「2時間で終わります」を月稼働と読まない）
  return Number.isFinite(n) && n >= 20 && n <= 400 ? n : null;
}

function readDaysPerWeek(text: string): number | null {
  const m = text.match(/週\s*([1-5１-５])\s*(?:〜|~|-)?\s*([1-5１-５])?\s*日/);
  if (!m) return null;
  const norm = (c: string) => Number(c.replace(/[１-５]/g, (x) => String.fromCharCode(x.charCodeAt(0) - 0xfee0)));
  // 範囲なら少ないほうを取る（楽観に倒さない）
  return norm(m[1]);
}

function readOnsite(text: string): Engagement["onsite"] {
  if (/(基本|完全)?常駐|常駐(での)?参画|出社必須/.test(text)) return "required";
  if (/週\s*[1-5１-５]\s*(回|日)?\s*出社|一部出社|ハイブリッド/.test(text)) return "partial";
  if (/(フル)?リモート|在宅|全国どこでも/.test(text)) return "remote";
  return "unknown";
}

// ---------------------------------------------------------------------------
// 稼働できるか
// ---------------------------------------------------------------------------

export interface CapacityCheck {
  /** 引き受けられるか */
  fits: boolean;
  /** 求められている月の稼働時間 */
  requiredHours: number | null;
  /** こちらが出せる月の稼働時間 */
  availableHours: number;
  reason: string;
}

/**
 * 週に出せる時間で、そもそも受けられるかを見る。
 *
 * 金額の判定より先に置く。月140時間の案件は、時給がいくら高くても
 * 週10時間の人には引き受けられない。「時給6,785円の応募候補」として
 * 出してしまうと、応募して、面談まで行って、そこで断られる。
 */
export function checkCapacity(engagement: Engagement, weeklyHours: number): CapacityCheck {
  const availableHours = Math.round(weeklyHours * WEEKS_PER_MONTH);
  // 稼働時間が書かれていないものを 140時間 とみなして落とすと、
  // 出来高の小さい案件まで巻き添えになる。分からないものは通して、後段で確認させる。
  const required = engagement.monthlyHours;

  if (required === null) {
    return {
      fits: true,
      requiredHours: null,
      availableHours,
      reason:
        engagement.kind === "monthly"
          ? "月額契約ですが、月に何時間の稼働を求められるかが書かれていません。応募前に必ず確認してください。"
          : "稼働時間の指定がないので、量はこちらで決められます。",
    };
  }

  if (required <= availableHours) {
    return {
      fits: true,
      requiredHours: required,
      availableHours,
      reason: `求められている稼働 ${required}時間/月 に対して、出せるのは ${availableHours}時間/月。足ります。`,
    };
  }

  return {
    fits: false,
    requiredHours: required,
    availableHours,
    reason:
      `求められている稼働が ${required}時間/月（週 約${Math.round(required / WEEKS_PER_MONTH)}時間）で、` +
      `あなたが出せる ${availableHours}時間/月（週 ${weeklyHours}時間）を超えています。` +
      `時給がいくら高くても引き受けられません。`,
  };
}

/**
 * 月額契約の実効時給。
 * 手数料は引かない（エージェント経由の月額は、提示額が受取額であることが多いため）。
 */
export function monthlyHourly(engagement: Engagement): number | null {
  if (engagement.kind !== "monthly" || engagement.monthlyJpy === null) return null;
  // 稼働時間が書かれていないなら、時給は出さない。
  // 業界標準の140時間で埋めると、月額4万円の案件が「時給286円」になる。
  // 実際は1投稿5,000円の出来高で、140時間もかけるものではなかった。
  const hours = engagement.monthlyHours;
  if (hours === null || !Number.isFinite(hours) || hours <= 0) return null;
  return Math.round(engagement.monthlyJpy / hours);
}
