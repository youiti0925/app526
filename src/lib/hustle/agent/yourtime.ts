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
  /**
   * 機械が動いている時間。あなたのカレンダーは埋めない。
   * 納期に間に合うかを見るときだけ使う。
   */
  machineHours: number;
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
 * 承認だけで済まなかったときの割り増し。
 *
 * 工程表の「あなたの時間」は、AIとツールが出したものを人が承認する時間として
 * 積んである。それが成り立つのは、出てきたものが承認できる水準のときだけ。
 *
 * 実案件9件で成果物を作らせて採点した結果、そのまま納品できたものはゼロだった。
 * だから「承認だけ」を額面どおりには扱わない。試作の結果に応じて割り増す。
 */
const OVERRUN: Record<Evidence, number> = {
  // 実案件で納品できたジャンル。それでも確認で1〜2件は差し戻る。
  proven: 1.3,
  // 人が手を入れれば納品できた。承認では済まず、直す時間が要る。
  needs_human: 2.5,
  // 納品できる水準にならなかった。承認モデルが成り立たない。
  disproven: 1,
  untested: 1,
};

/**
 * 工程表と試作の結果から、あなたの時間を出す。
 *
 * @param estimate 工程表からの見積り
 * @param evidence そのジャンルを実際に試した結果。試していなければ "untested"。
 */
export function yourTime(estimate: WorkTypeEstimate, evidence: Evidence): YourTime {
  const approve = round(estimate.humanHours);
  const manual = round(estimate.manualHours);
  const machine = round(estimate.machineHours);
  const speed = (h: number) => (h > 0 ? Math.round((manual / h) * 10) / 10 : 1);

  if (evidence === "disproven") {
    // AIの出力を当てにできない。手作業に戻る。
    return {
      lowHours: manual,
      highHours: manual,
      machineHours: machine,
      manualHours: manual,
      speedup: 1,
      certain: true,
      basis:
        `このジャンルは実案件の試作で「納品できる水準にならなかった」という結果でした。` +
        `AIの出力を承認して出す、という前提が成り立たないので、手作業と同じ ${manual}時間 で見ています。`,
    };
  }

  if (evidence === "untested") {
    return {
      lowHours: approve,
      highHours: round(Math.min(manual, approve * OVERRUN.needs_human)),
      machineHours: machine,
      manualHours: manual,
      speedup: speed(round(Math.min(manual, approve * OVERRUN.needs_human))),
      certain: false,
      basis:
        `工程表では、あなたがやるのは承認と確認だけで ${approve}時間 です` +
        `（機械が動くのは別に ${machine}時間。あなたのカレンダーは埋めません）。` +
        `ただしこのジャンルはまだ実案件で試していないので、承認だけで済むかは分かりません。` +
        `済まなかった場合を見込んで、上は ${round(Math.min(manual, approve * OVERRUN.needs_human))}時間 まで見ています。`,
    };
  }

  const high = round(Math.min(manual, approve * OVERRUN[evidence]));
  return {
    lowHours: approve,
    highHours: high,
    machineHours: machine,
    manualHours: manual,
    speedup: speed(high),
    certain: true,
    basis:
      `工程表では、あなたがやるのは承認と確認だけで ${approve}時間 です` +
      `（機械が動くのは別に ${machine}時間）。` +
      (evidence === "proven"
        ? `このジャンルは実案件の試作で納品できています。確認で差し戻るぶんを見て、上は ${high}時間。`
        : `このジャンルは試作で「人が手を入れれば納品できる」でした。承認だけでは済まないので、上は ${high}時間。`),
  };
}

/**
 * 工程表が無い仕事向け。
 *
 * 工程の内訳が無いので、どこまで自動化できるかが分からない。
 * ここで適当な比率を掛けると、根拠の無い数字が時給の計算に流れる。
 * **分けられないことを、分けられないまま返す。**
 */
export function unknownSplit(totalHours: number): YourTime {
  const total = round(totalHours);
  return {
    lowHours: total,
    highHours: total,
    machineHours: 0,
    manualHours: total,
    speedup: 1,
    certain: false,
    basis:
      `${total}時間の見積りですが、この仕事は工程の内訳を持っていないので、` +
      `どこまで機械に任せられるかが分かりません。全部あなたの時間として計算しています。` +
      `実際にはもっと短く済む可能性があります（そのぶん時給は上がります）。`,
  };
}
