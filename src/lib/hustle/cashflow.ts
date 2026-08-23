import { PLATFORM_FEES, computePayout, type PlatformFee } from "./payout";
import { formatLocalDate } from "./analytics";

/**
 * いつ現金が手に入るかの計算。
 *
 * なぜ要るか:
 * このアプリを使う理由が「お金が無い」ことなので、
 * 「いくら稼げるか」より「いつ手元に入るか」のほうが重要な場面がある。
 * 家賃の期日までに現金化できない仕事は、金額が良くても今は受けられない。
 *
 * いまのアプリは「未入金 ○円」までしか出しておらず、その○円が
 * いつ口座に入るかを答えられない。ここで答える。
 *
 * 締め日の規則はプラットフォームごとに違う。
 * 確認できていないものは推測で埋めず、その旨を返す。
 */

/** 締め日の考え方 */
export type CutoffRule =
  | "semimonthly" // 15日締め・月末締めの2回
  | "weekly" // 毎週
  | "month_end" // 月末締め
  | "unknown";

export interface PayoutRule {
  platformId: string;
  cutoff: CutoffRule;
  /** 締め日から入金までの日数 */
  lagDays: number;
  /** 毎週締めの場合の曜日（0=日曜） */
  weekday?: number;
  /** 確認できているか。false なら結果に「未確認」と出す。 */
  verified: boolean;
  note: string;
}

export const PAYOUT_RULES: PayoutRule[] = [
  {
    platformId: "crowdworks",
    cutoff: "semimonthly",
    lagDays: 15,
    verified: true,
    note: "15日締め・月末締めの月2回。締めからおよそ半月後に入金。未出金1,000円以上が条件。",
  },
  {
    platformId: "lancers",
    cutoff: "semimonthly",
    lagDays: 15,
    verified: true,
    note: "15日締め・月末締めの月2回。残高1,000円超で申請できる。",
  },
  {
    platformId: "coconala",
    cutoff: "weekly",
    lagDays: 0,
    weekday: 4, // 木曜
    verified: true,
    note: "毎週木曜振込。月〜日の申請分が次の木曜に入る。現金化が一番速い。",
  },
  {
    platformId: "direct",
    cutoff: "month_end",
    lagDays: 30,
    verified: false,
    note: "月末締め翌月末払いが一般的だが、取引先ごとに違う。契約時に必ず確認すること。最長60日のこともある。",
  },
  {
    platformId: "mercari",
    cutoff: "weekly",
    lagDays: 4,
    weekday: 4,
    verified: false,
    note: "購入→発送→受取評価→売上金確定→振込申請という段取りがあり、実質7〜14日。相手の評価待ちで止まる。",
  },
];

export interface PayoutProjection {
  /** 締め日 */
  cutoffDate: string;
  /** 入金予定日 */
  payoutDate: string;
  /** 今日から何日後か */
  daysUntil: number;
  /** 手取り（手数料・振込手数料を引いた額） */
  netJpy: number;
  /** 最低出金額に届かず、当面引き出せないか */
  stuck: boolean;
  /** 締め日の規則を確認できているか */
  verified: boolean;
  note: string;
}

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const addDays = (d: Date, n: number): Date => {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
};

/** 次に来る締め日。 */
export function nextCutoff(from: Date, rule: PayoutRule): Date {
  const d = startOfDay(from);

  if (rule.cutoff === "weekly") {
    const target = rule.weekday ?? 4;
    // 当日が締め曜日でも、その日のうちは間に合わない前提で翌週にする
    const delta = ((target - d.getDay() + 7) % 7) || 7;
    return addDays(d, delta);
  }

  if (rule.cutoff === "semimonthly") {
    if (d.getDate() < 15) return new Date(d.getFullYear(), d.getMonth(), 15);
    // 月末
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
  }

  // month_end
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/**
 * この仕事の報酬が、いつ・いくら手元に入るか。
 *
 * @param wonAt 受注（または納品）した日
 * @param hours 実効時給の計算に使う工数。最低出金額の判定にだけ使う。
 */
export function projectPayout(
  amountJpy: number,
  platformId: string,
  wonAt: Date = new Date(),
  today: Date = new Date()
): PayoutProjection | null {
  const platform: PlatformFee | undefined = PLATFORM_FEES.find((p) => p.id === platformId);
  const rule = PAYOUT_RULES.find((r) => r.platformId === platformId);
  if (!platform || !rule) return null;

  const payout = computePayout(amountJpy, platform, 1);
  const cutoff = nextCutoff(wonAt, rule);
  const payoutDate = addDays(cutoff, rule.lagDays);
  const daysUntil = Math.round(
    (startOfDay(payoutDate).getTime() - startOfDay(today).getTime()) / 86_400_000
  );

  const stuck = !payout.canWithdraw;

  const parts = [rule.note];
  if (!rule.verified) parts.push("※この締め日の規則は未確認です。実際の条件を必ず確認してください。");
  if (stuck) {
    parts.push(
      `手数料を引いた ${(payout.grossJpy - payout.feeJpy).toLocaleString()}円 が最低出金額 ${platform.minPayoutJpy.toLocaleString()}円 に届かないので、この分だけでは引き出せません。他の報酬と合算するまで口座には入りません。`
    );
  }

  return {
    cutoffDate: formatLocalDate(cutoff),
    payoutDate: formatLocalDate(payoutDate),
    daysUntil,
    netJpy: payout.netJpy,
    stuck,
    verified: rule.verified,
    note: parts.join(" "),
  };
}

// ---------------------------------------------------------------------------
// 期日に間に合うか
// ---------------------------------------------------------------------------

export interface CashNeed {
  /** いつまでに */
  byDate: string;
  /** いくら必要か */
  amountJpy: number;
  label: string;
}

export interface CashflowCheck {
  /** 期日までに入る見込みの合計 */
  incomingJpy: number;
  /** 足りるか */
  covers: boolean;
  shortfallJpy: number;
  /** 期日までに入るもの */
  arriving: { label: string; payoutDate: string; netJpy: number }[];
  /** 期日に間に合わないもの */
  tooLate: { label: string; payoutDate: string; netJpy: number }[];
  advice: string;
}

/**
 * 「◯日までに◯円要る」に対して、いま抱えている仕事で足りるか。
 *
 * 足りないときに「頑張りましょう」で終わらせない。
 * 何日足りないのか、現金化の速いところに切り替えれば届くのかまで出す。
 */
export function checkCashNeed(
  need: CashNeed,
  jobs: { label: string; amountJpy: number; platformId: string; wonAt: Date }[],
  today: Date = new Date()
): CashflowCheck {
  const arriving: CashflowCheck["arriving"] = [];
  const tooLate: CashflowCheck["tooLate"] = [];

  for (const job of jobs) {
    const p = projectPayout(job.amountJpy, job.platformId, job.wonAt, today);
    if (!p) continue;
    const row = { label: job.label, payoutDate: p.payoutDate, netJpy: p.stuck ? 0 : p.netJpy };
    if (p.payoutDate <= need.byDate && !p.stuck) arriving.push(row);
    else tooLate.push(row);
  }

  const incomingJpy = arriving.reduce((sum, a) => sum + a.netJpy, 0);
  const shortfallJpy = Math.max(0, need.amountJpy - incomingJpy);
  const covers = shortfallJpy === 0;

  return {
    incomingJpy,
    covers,
    shortfallJpy,
    arriving,
    tooLate,
    advice: buildAdvice(need, incomingJpy, shortfallJpy, covers, tooLate, today),
  };
}

function buildAdvice(
  need: CashNeed,
  incomingJpy: number,
  shortfallJpy: number,
  covers: boolean,
  tooLate: CashflowCheck["tooLate"],
  today: Date
): string {
  if (covers) {
    return `${need.byDate} までに ${incomingJpy.toLocaleString()}円 入る見込みで、必要な ${need.amountJpy.toLocaleString()}円 に足ります。`;
  }

  const daysLeft = Math.round(
    (new Date(`${need.byDate}T00:00:00`).getTime() - startOfDay(today).getTime()) / 86_400_000
  );

  const lines = [
    `${need.byDate} までに入る見込みは ${incomingJpy.toLocaleString()}円 で、${shortfallJpy.toLocaleString()}円 足りません（残り${daysLeft}日）。`,
  ];

  if (tooLate.length > 0) {
    lines.push(
      `間に合わない入金が ${tooLate.length}件（${tooLate.map((t) => `${t.payoutDate} ${t.netJpy.toLocaleString()}円`).join(" / ")}）あります。`
    );
  }

  // 現金化の速い順に案内する。ここで見栄えのいいことを言わない。
  if (daysLeft <= 14) {
    lines.push(
      "この日数で受注から入金まで回せるのは、現金化が速い経路だけです。ココナラは毎週木曜振込なので、今から受注できれば間に合う可能性があります。"
    );
    lines.push(
      "それでも足りないなら、副業で埋めようとしないでください。生活福祉資金の緊急小口資金、住居確保給付金、自治体の相談窓口のほうが速くて確実です。/hustle/guide に窓口をまとめてあります。"
    );
  } else {
    lines.push(
      "受注から入金まで、クラウドソーシングでも1か月前後かかります。いま動き出す必要があります。"
    );
  }

  return lines.join(" ");
}
