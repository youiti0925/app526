/**
 * 手取り計算。
 *
 * クラウドソーシングは「受注額 = もらえる額」ではない。
 * システム手数料・振込手数料・最低出金額があり、少額案件ほど手元に残らない。
 * 実効時給を出す前に、まずここを正しく見せる必要がある。
 *
 * 数字は各社の公開している手数料表に基づく。改定されることがあるので、
 * UI 側で編集できるようにしてある。
 */
export interface PlatformFee {
  id: string;
  name: string;
  /** システム手数料率（0.2 = 20%） */
  feeRate: number;
  feeNote: string;
  /** 振込手数料（円） */
  withdrawalFeeJpy: number;
  withdrawalNote: string;
  /** これ未満は出金できない（円） */
  minPayoutJpy: number;
  /** 入金までの目安日数 */
  payoutLagDays: string;
}

export const PLATFORM_FEES: PlatformFee[] = [
  {
    id: "crowdworks",
    name: "クラウドワークス",
    feeRate: 0.2,
    feeNote: "システム利用料 20%（契約金額に応じて変動する場合あり）",
    withdrawalFeeJpy: 500,
    withdrawalNote: "楽天銀行は安く、他行は高い。クイック出金はさらに追加手数料。",
    minPayoutJpy: 1000,
    payoutLagDays: "15日/月末締め → 半月後払い",
  },
  {
    id: "lancers",
    name: "ランサーズ",
    feeRate: 0.2,
    feeNote: "システム手数料 一律 20%（税別）",
    withdrawalFeeJpy: 550,
    withdrawalNote: "出金には本人確認の承認が必要。承認前は1円も引き出せない。",
    minPayoutJpy: 1000,
    payoutLagDays: "残高1,000円超で出金申請可",
  },
  {
    id: "coconala",
    name: "ココナラ",
    feeRate: 0.22,
    feeNote: "販売手数料 22%（税込）",
    withdrawalFeeJpy: 160,
    withdrawalNote: "3,000円以上の申請で振込手数料が無料になる場合あり",
    minPayoutJpy: 1000,
    payoutLagDays: "毎週木曜振込（月〜日の申請分）",
  },
  {
    id: "direct",
    name: "直接取引（請求書払い）",
    feeRate: 0,
    feeNote: "手数料なし。ただし未払いリスクを自分で負う。",
    withdrawalFeeJpy: 0,
    withdrawalNote: "報酬 100万円以下なら源泉徴収 10.21% が引かれることがある（確定申告で精算）",
    minPayoutJpy: 0,
    payoutLagDays: "月末締め翌月末払いが一般的（最長60日）",
  },
  {
    id: "mercari",
    name: "メルカリ",
    feeRate: 0.1,
    feeNote: "販売手数料 10%。これに加えて送料が自己負担のことが多い。",
    withdrawalFeeJpy: 200,
    withdrawalNote: "振込申請1回につき手数料。本人確認が未完了だと1営業日あたりの申請額にも上限がかかる。",
    minPayoutJpy: 200,
    payoutLagDays: "購入→発送→受取評価→売上金確定→振込申請→入金で実質7〜14日",
  },
];

export interface PayoutBreakdown {
  grossJpy: number;
  feeJpy: number;
  withdrawalFeeJpy: number;
  otherCostJpy: number;
  netJpy: number;
  /** 受注額のうち手元に残る割合 */
  retentionRate: number;
  /** 投入時間から計算した実効時給。時間未入力なら null。 */
  hourlyJpy: number | null;
  /** 出金できるか */
  canWithdraw: boolean;
  warnings: string[];
}

export function computePayout(
  grossJpy: number,
  platform: PlatformFee,
  hours: number,
  otherCostJpy = 0,
  minWageJpy = 1121
): PayoutBreakdown {
  const feeJpy = Math.floor(grossJpy * platform.feeRate);
  const afterFee = grossJpy - feeJpy;
  const canWithdraw = afterFee >= platform.minPayoutJpy;

  // 最低出金額に届かない場合でも、振込手数料は免除されるわけではなく
  // 「他の報酬と合算して出金するときに引かれる」だけ。ここで0扱いにすると
  // 手取りと残存率が実態より高く出るので、常に控除する。
  const withdrawalFeeJpy = platform.withdrawalFeeJpy;
  const netJpy = Math.max(0, afterFee - withdrawalFeeJpy - otherCostJpy);

  const hourlyJpy = hours > 0 ? Math.round(netJpy / hours) : null;
  const retentionRate = grossJpy > 0 ? netJpy / grossJpy : 0;

  const warnings: string[] = [];

  if (!canWithdraw) {
    warnings.push(
      `手数料を引いた ${afterFee.toLocaleString()}円 は、${platform.name} の最低出金額 ${platform.minPayoutJpy.toLocaleString()}円 に届きません。他の報酬と合算して超えるまで、この分は口座に入りません（合算して出金する際に振込手数料 ${platform.withdrawalFeeJpy.toLocaleString()}円 が引かれます）。`
    );
  }
  if (retentionRate > 0 && retentionRate < 0.5) {
    warnings.push(
      `受注額の ${Math.round(retentionRate * 100)}% しか手元に残りません。少額案件は手数料の比率が跳ね上がるので、まとめて受けるか単価を上げてください。`
    );
  }
  if (hourlyJpy !== null && hourlyJpy < minWageJpy) {
    warnings.push(
      `実効時給 ${hourlyJpy.toLocaleString()}円 は最低賃金（${minWageJpy.toLocaleString()}円）を下回ります。この単価で続けると、働くほど損をします。`
    );
  }
  if (platform.id === "direct") {
    warnings.push(
      "直接取引は手数料がゼロな代わりに、未払いのリスクを自分で負います。着手前に発注書か、条件を書いたメールの合意を必ず残してください。"
    );
  }

  return {
    grossJpy,
    feeJpy,
    withdrawalFeeJpy,
    otherCostJpy,
    netJpy,
    retentionRate,
    hourlyJpy,
    canWithdraw,
    warnings,
  };
}
