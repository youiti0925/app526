/**
 * 競合の読み取り。
 *
 * なぜ要るか:
 * 実データで、応募人数44人・閲覧1,890回の6万円の案件を
 * 「実効時給26,389〜39,583円の応募候補」として通してしまった。
 * 応募人数はページに数字で書いてあるのに、読んでいなかった。
 *
 * 実効時給がいくら高く見えても、44人が応募していれば取れる確率は数%で、
 * 提案文を書く時間のほうが先に溶ける。期待値で見ないと意味がない。
 *
 * 市場調査でも、AIで短縮できる作業ほど応募が集中していた
 * （GAS自動化は応募者中央値31人・最大147人）。数字が本文にあるなら必ず使う。
 */

export interface Competition {
  /** 応募・提案の人数。読めなければ null。 */
  applicants: number | null;
  /** 閲覧数。読めなければ null。 */
  views: number | null;
  /** 募集枠。読めなければ null。 */
  slots: number | null;
  /** ざっくりの受注確率（0〜1）。応募人数から出す。読めなければ null。 */
  winRate: number | null;
  /** 人が読む説明 */
  note: string;
}

const num = (raw: string): number | null => {
  const n = Number(raw.replace(/[,，\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * 「応募人数」「提案数」などのラベルの直後にある数字を拾う。
 *
 * ラベルと数字の間に改行やタグの残骸が入るので、間に何行か挟まっていても拾う。
 * ただし「契約人数」のように意味が違うラベルを巻き込まないよう、
 * 次のラベルらしき日本語が来たら打ち切る。
 */
function readLabeled(text: string, labels: RegExp): number | null {
  // ラベルと数字の間に日本語が入っていたら、それは別のラベルなので拾わない。
  // 実データで「応募人数 / 契約人数 / 閲覧数 / 932」という並びのページがあり、
  // 空欄をまたいで閲覧数の932を応募人数として読んでいた。
  const gap = "[^0-9０-９\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}]{0,8}";
  const m = text.match(
    new RegExp(`(?:${labels.source})${gap}([0-9０-９][0-9０-９,，]{0,6})`, "u")
  );
  if (!m) return null;
  return num(m[1].replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
}

export function readCompetition(text: string): Competition {
  const t = text.slice(0, 8000);

  const applicants =
    readLabeled(t, /応募人数|応募者数|提案数|提案人数|エントリー数|応募状況[^0-9]{0,8}応募人数/) ??
    readLabeled(t, /(?:現在|すでに)[^。\n]{0,6}(?:応募|提案)/);
  const views = readLabeled(t, /閲覧数|PV数|閲覧回数/);
  const slots = readLabeled(t, /募集人数|募集枠|採用予定人数/);

  const winRate = estimateWinRate(applicants, slots);

  return { applicants, views, slots, winRate, note: describe(applicants, views, slots, winRate) };
}

/**
 * 受注確率のざっくり見積もり。
 *
 * 単純な 1/応募人数 にはしない。実績ゼロで応募する場合、
 * 実績のある応募者に先に持っていかれるので、頭数割りより不利になる。
 * だから枠数/応募人数をさらに割り引く。楽観に倒さないための係数。
 */
export function estimateWinRate(applicants: number | null, slots: number | null): number | null {
  if (applicants === null || applicants < 0) return null;
  const seats = slots && slots > 0 ? slots : 1;
  if (applicants === 0) return 0.5; // 一番乗りでも、発注されない可能性は普通にある
  const even = seats / (applicants + 1);
  // 実績ゼロぶんの割引。応募が多いほど効く。
  const penalty = applicants >= 30 ? 0.4 : applicants >= 10 ? 0.6 : 0.8;
  return Math.max(0.01, Math.min(0.9, even * penalty));
}

function describe(
  applicants: number | null,
  views: number | null,
  slots: number | null,
  winRate: number | null
): string {
  if (applicants === null) {
    return views !== null
      ? `応募人数は書かれていません（閲覧 ${views.toLocaleString()}回）。競合の数が分からないので、期待値は判断できません。`
      : "応募人数が書かれていないので、競合の数が分かりません。";
  }
  const pct = winRate !== null ? `${Math.round(winRate * 100)}%` : "不明";
  const seats = slots && slots > 0 ? `${slots}枠に対して` : "";
  const seen = views !== null ? `／閲覧 ${views.toLocaleString()}回` : "";
  return `${seats}応募 ${applicants}人${seen}。実績ゼロで取れる確率はざっくり ${pct}。`;
}

/**
 * 提案文を書く時間を織り込んだ「期待時給」。
 *
 * 応募しても取れなければ、提案文を書いた時間はまるごと損になる。
 * 受注できたときの時給ではなく、応募1回あたりの期待値で見る。
 */
export function expectedHourly(
  netJpy: number,
  workHours: number,
  proposalHours: number,
  winRate: number | null
): number | null {
  if (!Number.isFinite(netJpy) || !Number.isFinite(workHours) || workHours <= 0) return null;
  if (winRate === null) return null;
  // 期待収入 ÷ （提案にかける時間 ＋ 受注したときだけ発生する作業時間の期待値）
  const expectedIncome = netJpy * winRate;
  const expectedTime = proposalHours + workHours * winRate;
  if (expectedTime <= 0) return null;
  return Math.round(expectedIncome / expectedTime);
}
