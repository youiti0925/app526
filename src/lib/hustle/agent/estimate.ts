import { describeWorkType, estimateByWorkType, stripNonQuantities } from "./worktypes";

/**
 * 募集文から作業量を見積もる（AIなしで動く版）。
 *
 * 実効時給の判定は、AIキーが無くても必ず動く必要がある。
 * ここが動かないと「単価を検証していないのに進めてよいと言う」状態に戻ってしまう。
 * 初心者が必ず過小評価する「やりとり・修正・検収待ち」ぶんを最後に上乗せする。
 */

export interface WorkEstimate {
  lowHours: number;
  highHours: number;
  /** どう見積もったかの説明。人に見せる。 */
  basis: string;
  confidence: "high" | "medium" | "low";
}

const num = (s: string): number => Number(s.replace(/,/g, ""));

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 執筆の速度（文字/時）。調査・構成・推敲を含めた実測に近い値。 */
const CHARS_PER_HOUR = 1200;


export function estimateHours(text: string): WorkEstimate | null {
  const normalized = text.normalize("NFKC");

  // 工程が分かっている仕事は、工程を積み上げて出す。
  // 文字数だけで見ていたせいで、SDS・リスクアセスメント・作業標準書のような
  // 「文字数が書かれていない仕事」が全部 判定不能で止まっていた。
  // ここには元のテキストを渡す。規格番号を消したものを渡すと、
  // ISO9001 が消えて ISO 案件だと判定できなくなる（実際そうなった）。
  const byType = estimateByWorkType(normalized);
  if (byType) {
    // 工程を積み上げた値には、やりとり・修正の工程がすでに入っている。
    // 二重に乗せないよう、上乗せは控えめ（1.0〜1.4倍）にする。
    const low = Math.max(0.5, Math.round(byType.aiHours * 10) / 10);
    const high = Math.max(low, Math.round(byType.aiHours * 1.4 * 10) / 10);
    return {
      lowHours: low,
      highHours: high,
      basis: describeWorkType(byType),
      // 数量が読めていれば medium、読めていなければ low
      confidence: byType.unitsRead ? "medium" : "low",
    };
  }

  // ここから先の素朴な読み取りでは、数量ではない数字を消しておく。
  // 消さないと「24365作業なし」というページのタグから 24,365工程 を読み、
  // 52,790時間 という見積りが出る（実データで発生した）。
  const t = stripNonQuantities(normalized);

  // 「3000文字 × 10本」のような書き方
  const chars = t.match(/([0-9,]{3,7})\s*文字/);
  if (chars) {
    const perItem = num(chars[1]);
    // 「1記事3000文字、10本」のように、1件あたりの文字数と本数が両方出る。
    //
    // 以前はあらゆる単位の最大値を本数にしていたので、
    // 「実績5件以上の方」「月100件の問い合わせ対応」のような、
    // 納品数と無関係な数字を本数として拾っていた。
    //
    // 「1商品300文字」の直前にある単位（商品）が、その案件の数え方。
    // それが分かるなら、同じ単位だけを数える。
    const head = t.slice(Math.max(0, (chars.index ?? 0) - 14), chars.index);
    const unitWord =
      head.match(/(?:^|[^0-9])1\s*([^\s0-9、,。／/]{1,6})\s*$/)?.[1] ??
      head.match(/([^\s0-9、,。／/]{1,6})\s*(?:あたり|当たり|につき)\s*$/)?.[1] ??
      null;

    // 数え方の単位（商品）と、本数の単位（本）が違うこともある
    // 「1記事3000文字、10本」。両方を候補にする。
    const unitRe = new RegExp(
      `([0-9,]{1,5})\\s*(?:本|記事|ページ|部|通|件|商品|点|枚|個|品|案件|問|コンテンツ${
        unitWord ? `|${escapeRe(unitWord)}` : ""
      })`,
      "g"
    );

    const counts = [...t.matchAll(unitRe)]
      // 応募条件や業務量の説明に出てくる数字は、納品数ではない。
      .filter((m) => {
        const before = t.slice(Math.max(0, (m.index ?? 0) - 12), m.index);
        return !/(実績|経験|以上|最低|月間|年間|累計|登録|会員|募集)\s*$/.test(before);
      })
      .map((m) => num(m[1]))
      // 副業として現実的な数量の上限。超えたら読み間違い。
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 5_000);
    const items = counts.length ? Math.max(...counts) : 1;
    const total = perItem * items;
    if (total > 0 && total < 5_000_000) {
      const base = total / CHARS_PER_HOUR;
      return withOverhead(base, `${perItem.toLocaleString()}文字 × ${items}本 = ${total.toLocaleString()}文字を、調査込みで時速${CHARS_PER_HOUR.toLocaleString()}文字として計算`, "medium");
    }
  }

  // データ入力・リスト作成: 1件2分
  const rows = t.match(/([0-9,]{2,6})\s*(?:件|行|レコード|社|商品)/);
  if (rows && /(入力|収集|リスト|転記|登録|作成)/.test(t)) {
    const n = num(rows[1]);
    if (n > 0 && n <= 20_000) {
      const base = (n * 2) / 60;
      return withOverhead(base, `${n.toLocaleString()}件 × 1件2分として計算`, "medium");
    }
  }

  // 文字起こし: 音声1分あたり4分（整文込み）
  const minutes = t.match(/([0-9,]{1,4})\s*分(?:間)?(?:の|ほどの|程度の)?(?:音声|動画|録音|会議|インタビュー|対談)/);
  if (minutes || /(文字起こし|テープ起こし|書き起こし)/.test(t)) {
    // 本数も読む。「30分の音声を10本」を1本ぶんで見積もっていた。
    const files = [...t.matchAll(/([0-9,]{1,4})\s*(?:本|ファイル|回分|セッション)/g)]
      .map((m) => num(m[1]))
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 1_000);
    const count = files.length ? Math.max(...files) : 1;

    // 分数が書かれていないときは仮に置く。仮の数字であることを必ず文面に書く。
    // 以前は「音声60分 × 4倍として計算」とだけ出していたので、
    // 読み取った数字なのか、こちらが決めた数字なのかが区別できなかった。
    const perFile = minutes ? num(minutes[1]) : 60;
    const base = (perFile * 4 * count) / 60;
    const basis = minutes
      ? `音声${perFile}分${count > 1 ? ` × ${count}本` : ""} × 4倍（整文込み）として計算`
      : `分数が書かれていないので、仮に1本60分${count > 1 ? ` × ${count}本` : ""}として計算しました。実際の分数を確認してください。`;
    return withOverhead(base, basis, minutes ? "medium" : "low");
  }

  // 明示的な作業時間・稼働時間
  const hours = t.match(/([0-9,]{1,3})\s*(?:時間|h)\s*(?:程度|ほど|くらい|以内)?/);
  if (hours) {
    const h = num(hours[1]);
    if (h > 0 && h < 500) {
      return withOverhead(h, `募集文に書かれている${h}時間を基準に計算`, "low");
    }
  }

  return null;
}

/**
 * やりとり・修正・検収待ちの上乗せ。
 * 初心者の見積もりが外れる最大の理由がここなので、必ず乗せる。
 */
function withOverhead(baseHours: number, basis: string, confidence: WorkEstimate["confidence"]): WorkEstimate {
  const low = Math.max(0.5, Math.round(baseHours * 1.2 * 10) / 10);
  const high = Math.max(low, Math.round(baseHours * 1.8 * 10) / 10);
  return {
    lowHours: low,
    highHours: high,
    basis: `${basis}。そこにやりとり・修正・検収待ちを2〜8割上乗せ。`,
    confidence,
  };
}

/** 募集文に地雷になりやすい条件が書かれていないかを見る。 */
export function detectScopeRisks(text: string): string[] {
  const t = text.normalize("NFKC");
  const risks: string[] = [];

  const checks: [RegExp, string][] = [
    [/修正[^。\n]{0,10}(無制限|何度でも|納得(いく|される)まで)/, "修正が無制限。作業量が青天井になります。回数を必ず区切ってください。"],
    [/(継続|長期)[^。\n]{0,15}(前提|可能|お願い)/, "「継続前提」は、初回を安く受けさせるための言い回しであることが多いです。初回単価で判断してください。"],
    [/(テスト|トライアル|お試し)[^。\n]{0,15}(無償|無料|報酬なし)/, "無償のテスト課題があります。それも作業時間です。"],
    [/(検収|確認)[^。\n]{0,20}(後|次第)[^。\n]{0,15}(お支払|支払)/, "検収の基準と日数が書かれていないと、支払いが無限に延びます。"],
    [/(スカイプ|zoom|ズーム|通話|ミーティング|定例)/i, "打ち合わせの時間は報酬に含まれないことが多いです。頻度と時間を確認してください。"],
    [/(マニュアル|レギュレーション)[^。\n]{0,20}(遵守|沿って|従って)/, "レギュレーションが厚いと、慣れるまでの時間が読めません。事前に見せてもらってください。"],
    [/(単価|報酬)[^。\n]{0,20}(応相談|スキルに応じて|要相談)/, "報酬が確定していません。着手前に金額を文面で確定させてください。"],
    [/(即日|本日中|今日中|至急)/, "納期が極端に短い案件は、作業単価が実質的に下がります。"],
  ];

  for (const [re, message] of checks) {
    if (re.test(t)) risks.push(message);
  }
  return risks;
}
