/**
 * 「あなたが手を動かす時間」と「全体の作業量」を分ける。
 *
 * なぜ要るか:
 * 週10時間というのは**あなたの時間**であって、仕事に要る時間の合計ではない。
 * 実際に処理するのはAIなので、この2つを混ぜると、受けられるはずの仕事を落とす。
 *
 * それまでの実装は、工程表の合計（AIがやる工程 + 人がやる工程）を
 * そのまま「見積り工数」として時給の計算に使っていた。
 * たとえば20物質のSDSは合計で約32時間だが、そのうち人が動くのは約28時間ではなく、
 * GHS区分の確認と法令の確認、やりとりの部分だけ。ここを分けていなかった。
 *
 * ただし逆方向にも間違えない。
 * 実案件9件でAIに成果物を作らせて採点した結果、**そのまま納品できたものはゼロ**で、
 * 採点者が見積もった「納品できる形にするまでに人が追加で使う時間」は12〜60時間だった。
 * つまり「AIがやるから人の時間はゼロ」も同じくらい誤り。
 *
 * だからここは、幅で出す。
 *   下限 = 工程表で人の担当になっている時間（AIの出力がそのまま使えた場合）
 *   上限 = 全体の作業量（AIの出力が使えず、結局自分でやる場合）
 * そのうえで、**試作ハーネスの結果**（evidence）で幅を狭める。
 * 主張ではなく結果で決める、という他の層と同じ方針。
 */

import type { Evidence } from "./dryrun-core";
import type { WorkTypeEstimate } from "./worktypes";

export interface YourTime {
  /** あなたが手を動かす時間の下限 */
  lowHours: number;
  /** 同、上限 */
  highHours: number;
  /** 仕事全体の作業量（AIがやるぶんを含む）。納期の目安に使う。 */
  totalHours: number;
  /**
   * AIを使わず全部手でやった場合の時間。
   *
   * 「AIに任せてどれだけ楽になるか」は、全体の作業量と比べても出てこない。
   * 比べる相手はこちら。SDSなら1物質あたり手作業4.1時間に対して、
   * あなたの時間は1.4時間。これが実際の効きめ。
   */
  manualHours: number;
  /** 手作業に対して、あなたの時間が何倍速か */
  speedup: number;
  /** 幅が確定しているか。false のときは「分からない」と読む。 */
  certain: boolean;
  /** 人に見せる説明 */
  basis: string;
}

const round = (n: number): number => Math.max(0.1, Math.round(n * 10) / 10);

/**
 * 実証済みのジャンルでも、AIの出力をそのまま出さない。
 * 目視の確認と手直しに、AIがやった作業量のこれだけを見込む。
 *
 * 根拠: 試作9件のうち最も出来が良かったもの（要求充足78点）でも、
 * 採点者は「納品まで12時間」と付けた。ゼロで見積もることはできない。
 * 実証済み（そのまま納品できた）の実例はまだ無いので、
 * ここは「一番良かった実例より甘くしない」という下限の置き方をしている。
 */
const REVIEW_SHARE_WHEN_PROVEN = 0.15;

/**
 * 条件つき（人が手を入れれば納品できた）のジャンル。
 * AIがやった作業量のうち、これだけは結局こちらで触ることになる。
 */
const REVIEW_SHARE_WHEN_NEEDS_HUMAN = 0.4;

/**
 * 工程表と試作の結果から、あなたの時間を出す。
 *
 * @param estimate 工程表からの見積り（aiHours = 全体、humanHours = 人の担当）
 * @param evidence そのジャンルを実際に試した結果。試していなければ "untested"。
 */
export function yourTime(estimate: WorkTypeEstimate, evidence: Evidence): YourTime {
  const total = round(estimate.aiHours);
  const human = round(Math.min(estimate.humanHours, estimate.aiHours));
  const manual = round(estimate.manualHours);
  // AIに任せる部分
  const aiPart = Math.max(0, total - human);
  const withManual = (low: number, high: number) => ({
    manualHours: manual,
    // 手作業に対する倍率。悪いほうの端で見る。
    speedup: high > 0 ? Math.round((manual / high) * 10) / 10 : 1,
  });

  switch (evidence) {
    case "proven":
      return {
        lowHours: human,
        highHours: round(human + aiPart * REVIEW_SHARE_WHEN_PROVEN),
        totalHours: total,
        ...withManual(human, round(human + aiPart * REVIEW_SHARE_WHEN_PROVEN)),
        certain: true,
        basis:
          `工程表の人の担当が ${human}時間。このジャンルは実案件の試作で納品できています。` +
          `AIが作ったぶん（${round(aiPart)}時間ぶんの作業）の確認と手直しに ` +
          `${Math.round(REVIEW_SHARE_WHEN_PROVEN * 100)}% を見込んでいます。`,
      };

    case "needs_human":
      return {
        lowHours: human,
        highHours: round(human + aiPart * REVIEW_SHARE_WHEN_NEEDS_HUMAN),
        totalHours: total,
        ...withManual(human, round(human + aiPart * REVIEW_SHARE_WHEN_NEEDS_HUMAN)),
        certain: true,
        basis:
          `工程表の人の担当が ${human}時間。このジャンルは試作で「人が手を入れれば納品できる」でした。` +
          `AIが作ったぶんの ${Math.round(REVIEW_SHARE_WHEN_NEEDS_HUMAN * 100)}% は結局こちらで触ることになります。`,
      };

    case "disproven":
      return {
        lowHours: total,
        highHours: total,
        totalHours: total,
        ...withManual(total, total),
        certain: true,
        basis:
          `このジャンルは試作で「納品できる水準にならなかった」という結果でした。` +
          `AIの出力を当てにできないので、${total}時間 は全部あなたの時間として見ています。`,
      };

    default:
      return {
        lowHours: human,
        highHours: total,
        totalHours: total,
        ...withManual(human, total),
        certain: false,
        basis:
          `工程表の人の担当は ${human}時間で、全体は ${total}時間です。` +
          `ただしこのジャンルはまだ実案件で試していないので、AIの出力がそのまま使えるか分かりません。` +
          `うまくいけば ${human}時間、AIの出力が使えなければ ${total}時間、と幅で見てください。`,
      };
  }
}

/**
 * 工程表が無い仕事（文字数からの素朴な見積りなど）向け。
 *
 * 工程の内訳が無いので、人とAIの切り分けができない。
 * ここで適当な比率を掛けると、根拠の無い数字が時給の計算に流れる。
 * **分けられないことを、分けられないまま返す。**
 */
export function unknownSplit(totalHours: number): YourTime {
  const total = round(totalHours);
  return {
    lowHours: total,
    highHours: total,
    totalHours: total,
    manualHours: total,
    speedup: 1,
    certain: false,
    basis:
      `${total}時間の見積りですが、この仕事は工程の内訳を持っていないので、` +
      `どこまでAIに任せられるかが分かりません。全部あなたの時間として計算しています。` +
      `実際にはもっと短く済む可能性があります（そのぶん時給は上がります）。`,
  };
}
