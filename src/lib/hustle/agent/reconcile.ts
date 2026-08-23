import type { PlatformFee } from "../payout";

/**
 * 上位モデルが返した判定を、こちらで検算し直す。
 *
 * なぜ必要か:
 * 判定を返す側が「実効時給は十分です」と書いていても、その算術が正しい保証はない。
 * ここを素通しすると、時給130円の案件が「受けてよい」として承認キューに並ぶ。
 * 金額と時間という検算可能な数字については、返ってきた結論ではなく
 * こちらの計算を正とする。上書きしたことは必ず記録に残す。
 */

export interface ReconcileInput {
  verdict: "reject" | "verify_first" | "proceed";
  reason: string;
  offeredJpy: number | null;
  lowHours: number;
  highHours: number;
  riskCount: number;
  minHourlyJpy: number;
  platform: Pick<PlatformFee, "feeRate" | "withdrawalFeeJpy">;
}

export interface ReconcileOutput {
  verdict: "reject" | "verify_first" | "proceed";
  reason: string;
  hourly: { low: number; high: number } | null;
  score: number;
  /** こちらの計算で結論を変えたか */
  overridden: boolean;
}

export function reconcileVerdict(input: ReconcileInput): ReconcileOutput {
  const { offeredJpy, lowHours, highHours, minHourlyJpy, platform } = input;

  let hourly: { low: number; high: number } | null = null;
  if (
    offeredJpy !== null &&
    Number.isFinite(offeredJpy) &&
    offeredJpy > 0 &&
    Number.isFinite(lowHours) &&
    Number.isFinite(highHours) &&
    highHours > 0
  ) {
    const fee = Math.floor(offeredJpy * platform.feeRate);
    const net = Math.max(0, offeredJpy - fee - platform.withdrawalFeeJpy);
    hourly = {
      low: Math.round(net / highHours),
      high: Math.round(net / Math.max(0.5, lowHours)),
    };
  }

  let verdict = input.verdict;
  let reason = input.reason;
  let overridden = false;

  // 上限側の時給ですら基準を割るなら、どんな結論が返ってきても受けさせない
  if (hourly && hourly.high < minHourlyJpy && verdict !== "reject") {
    verdict = "reject";
    reason = `手数料を引いた実効時給が ${hourly.low.toLocaleString()}〜${hourly.high.toLocaleString()}円で、基準の ${minHourlyJpy.toLocaleString()}円 を下回るため見送り（元の判定: ${input.verdict}）`;
    overridden = true;
  }

  // 下限側だけ割っているなら、通してよいが条件確認は必須にする
  if (hourly && hourly.low < minHourlyJpy && verdict === "proceed") {
    verdict = "verify_first";
    reason = `${reason}（実効時給の下限 ${hourly.low.toLocaleString()}円 が基準を割るため、条件を確認してから）`;
    overridden = true;
  }

  const rateScore = hourly ? Math.min(100, (hourly.low / Math.max(1, minHourlyJpy)) * 60) : 25;
  const score = Math.max(0, Math.round(rateScore - input.riskCount * 4));

  return { verdict, reason, hourly, score, overridden };
}
