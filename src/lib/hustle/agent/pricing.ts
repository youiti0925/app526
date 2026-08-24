/**
 * 単価と総額を分ける。
 *
 * なぜ要るか:
 * 案件ページの「予算」欄には、総額ではなく**1件あたりの単価**が入っていることがある。
 * それを総額として時給を計算すると、桁が変わる。
 *
 * 実データ（ココナラ 220件）:
 *   「記事単価 1,500円 / 記事数 5記事」  → 予算欄は 1,500円。総額は 7,500円
 *   「単価 50円 / 作成数 100」          → 予算欄は 50円。総額は 5,000円
 *   「1件200円で、100件作成」            → 予算欄は 100,000円（サイトの上限枠）。総額は 20,000円
 *
 * 上2つは総額を5倍・100倍に取り違え（安すぎると誤判定）、
 * 3つ目は逆に5倍に取り違える（高すぎると誤判定）。どちらも時給の判断を壊す。
 *
 * 案件ページには単価と数量が**別々の欄**として入っていることが多い。
 * 散文から推測するより、その欄を読むほうが確実。
 */

export interface Pricing {
  /** 仕事全体の報酬。読めなければ null。 */
  totalJpy: number | null;
  /** 1単位あたりの単価。読めなければ null。 */
  perUnitJpy: number | null;
  /** 数量。読めなければ null。 */
  units: number | null;
  /** どこから読んだか */
  source: "structured" | "prose" | "none";
  /** 人に見せる説明 */
  basis: string;
}

const NONE: Pricing = {
  totalJpy: null,
  perUnitJpy: null,
  units: null,
  source: "none",
  basis: "単価と数量を読み取れませんでした",
};

const num = (s: string): number => Number(s.replace(/[,，\s]/g, ""));

/** 副業として現実的な範囲。外れたら読み違え。 */
const MAX_UNITS = 100_000;
const MAX_TOTAL = 100_000_000;

export function readPricing(text: string): Pricing {
  const t = text.normalize("NFKC").replace(/\n+/g, " ").slice(0, 12_000);

  // 1. サイトが持っている欄。「記事単価 1,500円 … 記事数 5記事」
  const structured = t.match(
    /(?:記事単価|動画単価|単価)\s*[:：]?\s*([0-9][0-9,]{0,8})\s*円[^。]{0,24}?(?:記事数|作成数|動画数|ページ数|本数|枚数|件数)\s*[:：]?\s*([0-9][0-9,]{0,6})/
  );
  if (structured) {
    const per = num(structured[1]);
    const units = num(structured[2]);
    if (per > 0 && units > 0 && units <= MAX_UNITS && per * units <= MAX_TOTAL) {
      return {
        totalJpy: per * units,
        perUnitJpy: per,
        units,
        source: "structured",
        basis: `単価 ${per.toLocaleString()}円 × ${units.toLocaleString()} = ${(per * units).toLocaleString()}円（募集ページの単価欄と数量欄）`,
      };
    }
  }

  // 2. 本文の書き方。「1件200円で、100件作成をお願いいたします」
  const prose = t.match(
    /1\s*(?:件|記事|本|点|枚|ページ|物質|工程|文書)\s*(?:あたり|につき|につき)?\s*([0-9][0-9,]{0,8})\s*円[^。]{0,20}?([0-9][0-9,]{0,6})\s*(?:件|記事|本|点|枚|ページ|物質|工程|文書)/
  );
  if (prose) {
    const per = num(prose[1]);
    const units = num(prose[2]);
    if (per > 0 && units > 0 && units <= MAX_UNITS && per * units <= MAX_TOTAL) {
      return {
        totalJpy: per * units,
        perUnitJpy: per,
        units,
        source: "prose",
        basis: `1単位 ${per.toLocaleString()}円 × ${units.toLocaleString()} = ${(per * units).toLocaleString()}円（募集文の記載）`,
      };
    }
  }

  // 3. 単価だけ読めて数量が読めない場合。総額は出さない。
  //    ここで単価をそのまま総額にすると、5記事の案件を1記事ぶんの報酬で判断する。
  const perOnly = t.match(/(?:記事単価|動画単価|単価)\s*[:：]?\s*([0-9][0-9,]{0,8})\s*円/);
  if (perOnly) {
    const per = num(perOnly[1]);
    if (per > 0) {
      return {
        totalJpy: null,
        perUnitJpy: per,
        units: null,
        source: "structured",
        basis:
          `1単位 ${per.toLocaleString()}円 と書かれていますが、数量が読み取れません。` +
          `総額が決まらないので、何件かを先方に確認してください。`,
      };
    }
  }

  return NONE;
}
