/**
 * 税金の目安。
 *
 * なぜ要るか:
 * 副業で一番よくある事故が「20万円以下なら申告不要」の誤解。
 * これは**所得税の確定申告**の話で、**住民税の申告は金額に関係なく必要**。
 * 知らずに放置して、あとから住民税の追徴が来るケースが多い。
 *
 * もうひとつが「収入」と「所得」の取り違え。
 * 20万円のラインは、売上ではなく **売上 − 経費** で見る。
 * 経費を記録していないと、実際は下回っているのに超えたと思い込む
 * （逆に、経費を入れずに超えていることに気づかないこともある）。
 *
 * ここは目安を出すだけで、判断はしない。
 * 個別の事情（他の所得、扶養、控除）で結論が変わるので、
 * 金額が近づいたら税務署か税理士に確認するよう促す。
 */

/** 所得税の確定申告が必要になる、給与以外の所得のライン（給与所得者の場合） */
export const INCOME_TAX_THRESHOLD_JPY = 200_000;

/** 事業所得として扱われやすくなる目安（帳簿の保存が前提） */
export const BUSINESS_INCOME_GUIDE_JPY = 3_000_000;

export type TaxFlag =
  | "under_threshold" // 20万円以下
  | "near_threshold" // 20万円に近い
  | "over_threshold" // 20万円超
  | "no_records"; // 記録が足りず判断できない

export interface TaxSummary {
  /** 年間の売上 */
  revenueJpy: number;
  /** 年間の経費 */
  expenseJpy: number;
  /** 所得（売上 − 経費）。20万円のラインはこちらで見る。 */
  incomeJpy: number;
  flag: TaxFlag;
  /** 何をしないといけないか */
  todo: string[];
  /** 誤解しやすい点 */
  warnings: string[];
  note: string;
}

export interface TaxInput {
  /** その年の売上（入金済み） */
  revenueJpy: number;
  /** その年の経費 */
  expenseJpy: number;
  /** 経費を1件でも記録しているか */
  hasExpenseRecords: boolean;
  /** 給与所得者か（会社員・パート）。個人事業主だけなら false。 */
  isEmployee: boolean;
}

export function summarizeTax(input: TaxInput): TaxSummary {
  const incomeJpy = input.revenueJpy - input.expenseJpy;
  const todo: string[] = [];
  const warnings: string[] = [];

  // 住民税は金額に関係なく申告が要る。ここが一番誤解される。
  warnings.push(
    "「20万円以下なら申告不要」は**所得税だけ**の話です。住民税の申告は金額に関係なく必要で、ここを放置すると後から追徴が来ます。お住まいの市区町村の窓口で申告してください。"
  );

  if (!input.hasExpenseRecords && input.revenueJpy > 0) {
    warnings.push(
      "経費が1件も記録されていません。20万円のラインは売上ではなく「売上 − 経費」で見るので、経費を入れないと実際より高く出ます。通信費・電気代・PCの按分、書籍、ツールの利用料などを記録してください。"
    );
  }

  const flag: TaxFlag =
    input.revenueJpy === 0
      ? "no_records"
      : incomeJpy > INCOME_TAX_THRESHOLD_JPY
        ? "over_threshold"
        : incomeJpy > INCOME_TAX_THRESHOLD_JPY * 0.8
          ? "near_threshold"
          : "under_threshold";

  if (flag === "over_threshold" && input.isEmployee) {
    todo.push("所得税の確定申告が必要です（給与以外の所得が20万円を超えています）");
    todo.push("売上と経費の記録を、証憑（領収書・支払明細）とあわせて残してください");
  }

  if (flag === "near_threshold") {
    todo.push(
      `所得が ${incomeJpy.toLocaleString()}円 で、20万円のラインに近づいています。年内にあと ${(INCOME_TAX_THRESHOLD_JPY - incomeJpy).toLocaleString()}円 で超えます。`
    );
    todo.push("いまのうちに経費の記録を揃えておいてください。あとからでは領収書が出てきません。");
  }

  if (!input.isEmployee && input.revenueJpy > 0) {
    todo.push(
      "給与所得が無い場合、20万円の特例は使えません。基礎控除の範囲を超えるなら確定申告が要ります。"
    );
  }

  if (incomeJpy >= BUSINESS_INCOME_GUIDE_JPY) {
    todo.push(
      "所得が300万円を超えています。帳簿を付けていれば事業所得として扱える可能性があり、青色申告の控除が使えます。ここからは税理士に相談したほうが得です。"
    );
  }

  todo.push("住民税の申告（金額に関係なく必要）");

  return {
    revenueJpy: input.revenueJpy,
    expenseJpy: input.expenseJpy,
    incomeJpy,
    flag,
    todo,
    warnings,
    note: buildNote(flag, incomeJpy),
  };
}

function buildNote(flag: TaxFlag, incomeJpy: number): string {
  const base = {
    no_records: "まだ入金の記録がありません。最初の1円が入ったら、その日から記録してください。",
    under_threshold: `今年の所得は ${incomeJpy.toLocaleString()}円 です。所得税の確定申告のラインには届いていません。`,
    near_threshold: `今年の所得は ${incomeJpy.toLocaleString()}円 で、20万円のラインが見えてきました。`,
    over_threshold: `今年の所得は ${incomeJpy.toLocaleString()}円 で、20万円を超えています。確定申告が必要です。`,
  }[flag];

  return `${base} これは記録された数字からの目安です。他の所得・扶養・各種控除で結論が変わるので、実際の申告は税務署（無料相談があります）か税理士に確認してください。`;
}

/**
 * 経費に入れられるものの例。
 * 「入れられる」と言い切らず、按分が要るものはそう書く。
 */
export const EXPENSE_HINTS: { label: string; note: string }[] = [
  { label: "通信費（ネット回線・スマホ）", note: "私用と分けられないので、使用時間の割合で按分します。" },
  { label: "電気代", note: "同じく按分。作業時間 ÷ 24時間 × 使用面積の割合、などで説明できる形にします。" },
  { label: "PC・周辺機器", note: "10万円未満なら一括で経費。10万円以上は減価償却になります。" },
  { label: "ソフト・サービスの利用料", note: "仕事に使うぶんは経費。私用と兼ねるなら按分。" },
  { label: "書籍・資料", note: "仕事に関係するものだけ。" },
  { label: "手数料（プラットフォーム・振込）", note: "全額。このアプリが記録している手数料がそのまま使えます。" },
  { label: "家賃", note: "作業スペースの面積割合で按分。全額は入れられません。" },
];
