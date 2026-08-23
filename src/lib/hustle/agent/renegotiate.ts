import type { PlatformFee } from "../payout";
import type { WorkTypeEstimate } from "./worktypes";

/**
 * 「安いから見送り」で終わらせないための計算と文面。
 *
 * なぜ要るか:
 * いまの判定は、基準を割ったら reject して終わりだった。
 * だが実際の受託では、金額は聞けば動くことがある。
 * 特に、発注側が作業量を分かっていない案件（「SDSを何枚か」程度の書き方）は、
 * 工程を示すと金額が上がる。何も言わずに見送ると、その可能性を毎回捨てることになる。
 *
 * ここがやるのは2つ。
 *   1. 基準を満たすには「いくら必要か」を逆算する
 *   2. その根拠（工程の内訳と相場）を添えた文面を作る
 * 送るかどうかは人が決める。自動送信はしない。
 */

export interface Renegotiation {
  /** 基準を満たすのに必要な提示額（税込・手数料込みの請求額） */
  askJpy: number;
  /** いま提示されている額 */
  offeredJpy: number;
  /** 何倍にする必要があるか */
  multiple: number;
  /** 現実的に通りそうか */
  realistic: boolean;
  /** そのまま送れる交渉文。承認キューに出す。 */
  message: string;
  /** 交渉せずに見送るべき理由。realistic=false のときに入る。 */
  giveUpReason: string;
}

/**
 * 手取りが目標時給に届く「請求額」を逆算する。
 *
 * 手取り = 請求額 - 請求額×手数料率 - 振込手数料
 * 目標手取り = 目標時給 × 工数
 * よって 請求額 = (目標時給×工数 + 振込手数料) / (1 - 手数料率)
 */
export function requiredAsk(
  targetHourlyJpy: number,
  hours: number,
  platform: Pick<PlatformFee, "feeRate" | "withdrawalFeeJpy">
): number | null {
  if (!Number.isFinite(targetHourlyJpy) || !Number.isFinite(hours) || hours <= 0) return null;
  if (platform.feeRate >= 1) return null;
  const net = targetHourlyJpy * hours;
  const gross = (net + platform.withdrawalFeeJpy) / (1 - platform.feeRate);
  // 見積書に書ける形に丸める（千円単位）
  return Math.ceil(gross / 1000) * 1000;
}

export interface RenegotiateInput {
  title: string;
  offeredJpy: number;
  /** 見積もった工数（時間）。上限側を使う。 */
  hours: number;
  minHourlyJpy: number;
  platform: Pick<PlatformFee, "feeRate" | "withdrawalFeeJpy" | "name">;
  /** 工程の内訳があれば、根拠として文面に入れる */
  breakdown?: WorkTypeEstimate | null;
  /**
   * 相場が分かっていれば入れる。**1単位あたり**の金額。
   * 案件全体の相場は units 倍したもので、そのまま出すと桁が一つ違う。
   */
  marketRateJpy?: { low: number; high: number } | null;
}

export function buildRenegotiation(input: RenegotiateInput): Renegotiation | null {
  const ask = requiredAsk(input.minHourlyJpy, input.hours, input.platform);
  if (ask === null || input.offeredJpy <= 0) return null;

  const multiple = Math.round((ask / input.offeredJpy) * 10) / 10;

  // 3倍を超える交渉はまず通らない。時間を使うだけなので、そう書いて見送らせる。
  const realistic = multiple <= 3;

  return {
    askJpy: ask,
    offeredJpy: input.offeredJpy,
    multiple,
    realistic,
    message: realistic ? buildMessage(input, ask) : "",
    giveUpReason: realistic
      ? ""
      : `基準を満たすには ${ask.toLocaleString()}円（提示額の ${multiple}倍）が必要です。` +
        `ここまで開いていると、交渉しても通らないうえに、やりとりの時間だけ消えます。` +
        `この案件は見送って、最初から相場が合っている先を探してください。`,
  };
}

function buildMessage(input: RenegotiateInput, ask: number): string {
  const lines: string[] = [];

  lines.push("ご提示の条件を拝見しました。作業範囲を確認させてください。");
  lines.push("");
  lines.push("こちらで想定している工程は次のとおりです。");
  lines.push("");

  if (input.breakdown) {
    for (const step of input.breakdown.breakdown) {
      const who = step.by === "human" ? "手作業" : "自動化";
      lines.push(`・${step.name}（${who} / 約${step.hours}時間）`);
    }
    lines.push("");
    lines.push(
      `合計で約${input.breakdown.aiHours}時間を見込んでいます。` +
        `うち約${input.breakdown.humanHours}時間は、ツールでは代替できず、内容を一件ずつ確認する必要がある部分です。`
    );
  } else {
    lines.push(`・全体で約${input.hours}時間を見込んでいます。`);
  }

  lines.push("");
  lines.push(
    `この工程量ですと、${ask.toLocaleString()}円（税込）でお願いできればと考えております。`
  );

  if (input.marketRateJpy) {
    // 相場は「1単位あたり」で持っている。数量を掛けずにそのまま書くと、
    // 20物質のSDSに「15,000〜50,000円が相場」と自分から言うことになり、
    // 交渉のために出した文面で逆に足元を見られる。
    const units = input.breakdown?.units ?? 1;
    const unitLabel = input.breakdown?.workType.unit ?? "件";
    const per = input.marketRateJpy;
    const total = { low: per.low * units, high: per.high * units };
    const read = input.breakdown?.unitsRead ?? false;

    if (units > 1 && read) {
      lines.push(
        `同種の依頼ですと1${unitLabel}あたり ${per.low.toLocaleString()}〜${per.high.toLocaleString()}円 が目安で、` +
          `今回の${units}${unitLabel}ですと ${total.low.toLocaleString()}〜${total.high.toLocaleString()}円 の範囲になります。`
      );
    } else if (units > 1) {
      lines.push(
        `同種の依頼ですと1${unitLabel}あたり ${per.low.toLocaleString()}〜${per.high.toLocaleString()}円 が目安です。` +
          `対象の${unitLabel}数によって総額が変わりますので、件数をお知らせいただければ改めてお見積もりします。`
      );
    } else {
      lines.push(
        `同種の依頼ですと1${unitLabel}あたり ${per.low.toLocaleString()}〜${per.high.toLocaleString()}円 が目安です。`
      );
    }
  }

  lines.push("");
  lines.push("ご予算の都合がある場合は、次のいずれかで調整できます。");
  lines.push("・対象の件数を減らす");
  lines.push("・確認工程を簡略化し、その範囲を書面で明記する（品質の責任範囲もそこまでとする）");
  lines.push("・初回は一部だけをお試しでお受けし、内容をご確認いただいてから残りを進める");
  lines.push("");
  lines.push("ご検討のほどよろしくお願いいたします。");
  lines.push("");
  lines.push("【送る前に確認してください】");
  lines.push("・工程の内容が、この依頼の実態と合っているか");
  lines.push("・書いていない前提（素材の提供、確認の回数、納期）があれば追記する");

  return lines.join("\n");
}
