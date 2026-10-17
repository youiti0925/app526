/**
 * 実績づくり — 評価がまだ少ないうちは、時給が基準を割る小さな仕事も「受けてよい」に回す。
 *
 * 評価0のワーカーは、時給の良い案件ではまず選ばれない。短時間で終わる正規の仕事で評価を積み、
 * それを足場に大きい仕事へ進む。ただし次は変えない:
 *   - 詐欺・関門・納期・納品できるかの判定（ここより前で落ちたものは通さない）
 *   - 仮払い前に作業しない
 *   - 時給が極端に低い仕事（下の FLOOR_JPY 未満）。評価のためでも、ただ働きに近いものは受けない
 */

/** 受けた仕事がこの件数に届くまでは実績づくりを続ける。JOB_TRACK_RECORD_UNTIL で変えられる。 */
export const TRACK_RECORD_UNTIL = 5;
/** 1件あたり、あなたが手を動かす時間の上限（時間）。長い安い仕事で週の時間を使い切らないため。 */
export const MAX_HOURS = 3;
/** これ未満の時給（手取り・良いほうの端）は、実績づくりでも受けない。 */
export const FLOOR_JPY = 500;

export interface TrackRecordInput {
  /** 手取りの時給（あなたの時間で割ったもの） */
  hourly: { low: number; high: number } | null;
  /** あなたが手を動かす時間（多いほうの端） */
  yourHighHours: number;
  /** これまでに受けた仕事の数 */
  wonCount: number;
  until?: number;
}

export interface TrackRecordDecision {
  applies: boolean;
  reason: string;
}

export function trackRecordException(input: TrackRecordInput): TrackRecordDecision {
  const until = input.until ?? TRACK_RECORD_UNTIL;
  if (input.wonCount >= until) return { applies: false, reason: "" };
  if (!input.hourly) return { applies: false, reason: "" };
  if (input.yourHighHours > MAX_HOURS) return { applies: false, reason: "" };
  if (input.hourly.high < FLOOR_JPY) return { applies: false, reason: "" };
  return {
    applies: true,
    reason:
      `実績づくり：手取り時給は ${input.hourly.low.toLocaleString()}〜${input.hourly.high.toLocaleString()}円 と低いが、` +
      `${input.yourHighHours}時間以内で終わり、評価がつく（受けた仕事 ${input.wonCount}/${until}件。${until}件までは小さい仕事で評価を積む）。` +
      `契約と仮払いが画面に出てから作業すること`,
  };
}
