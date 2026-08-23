/**
 * 仕事の種類ごとの工程分解。
 *
 * なぜ要るか:
 * 「文字数 × 速度」だけで見積もっていたので、文字数の書いていない仕事は
 * 全部「判定不能」で止まっていた。市場調査で実効時給が高いと分かった
 * SDS作成・化学物質リスクアセスメント・作業標準書・ISO文書整備が、
 * まさにそこで止まっていた。狙う市場の仕事が判定できないのでは意味がない。
 *
 * 工程で分ける理由:
 * AIを使うと「生成」は速くなるが「検証」はむしろ増える。実測でも、
 * 全体の短縮率の中央値は約5割で、9割ではなかった。
 * 工程ごとに「AIがやる/人がやる」を分けておかないと、
 * 生成が速いことを根拠に全体を過小評価してしまう。
 *
 * 数字について:
 * ここに書いてある分数は初期値。実際にやった時間を記録していけば、
 * 自己調整のループ（stepLearn）が実績に寄せていく。
 * 初期値のままのうちは confidence を low にして、そう表示する。
 */

export interface WorkStep {
  name: string;
  /** 誰がやるか。ai = 私が下書きまで出せる工程。 */
  by: "ai" | "human";
  /** AIを併用したときの1単位あたりの分数 */
  minutes: number;
  /** すべて手作業でやった場合の1単位あたりの分数 */
  manualMinutes: number;
  /** なぜ人がやる必要があるか（by が human のとき） */
  why?: string;
}

export interface WorkType {
  id: string;
  label: string;
  /** 数量の単位 */
  unit: string;
  /** 単位を本文から読むための正規表現 */
  unitPattern: RegExp;
  /** この仕事だと判定するための正規表現 */
  patterns: RegExp[];
  steps: WorkStep[];
  /** 相場（1単位あたり、円）。分かっているものだけ。 */
  marketRateJpy?: { low: number; high: number };
  note: string;
}

export const WORK_TYPES: WorkType[] = [
  {
    id: "sds",
    label: "SDS（安全データシート）の作成・改訂",
    unit: "物質",
    unitPattern: /([0-9,]{1,5})\s*(?:物質|製品|品目|SDS|シート)/i,
    patterns: [/SDS|安全データシート|MSDS/i, /GHS[^。\n]{0,10}(分類|表示|ラベル)/],
    steps: [
      { name: "既存SDS・原材料情報の読み込みと整理", by: "ai", minutes: 15, manualMinutes: 40 },
      { name: "16項目の下書き作成", by: "ai", minutes: 10, manualMinutes: 90 },
      {
        name: "GHS区分の確認（政府のGHS分類結果・モデルSDSと1件ずつ突き合わせ）",
        by: "human",
        minutes: 45,
        manualMinutes: 45,
        why: "区分が1段ずれても文章としては自然に読めてしまい、AIの出力からは誤りが浮かびません。ここは必ず一次情報に当ててください。",
      },
      { name: "法令該当性の確認（安衛法・化管法・消防法）", by: "human", minutes: 20, manualMinutes: 30, why: "改正が頻繁で、AIの知識は古い可能性があります。" },
      { name: "体裁の整形・書式合わせ", by: "ai", minutes: 5, manualMinutes: 20 },
      { name: "依頼者とのやりとり・修正対応", by: "human", minutes: 20, manualMinutes: 20 },
    ],
    marketRateJpy: { low: 15_000, high: 50_000 },
    note:
      "2026年4月の安衛法改正で、SDS交付義務の対象物質が大きく増えます。資格は要りません。GHS区分の判断だけは、AIに任せず必ず一次情報で確認してください。",
  },
  {
    id: "risk_assessment",
    label: "化学物質リスクアセスメント",
    unit: "物質",
    unitPattern: /([0-9,]{1,5})\s*(?:物質|作業|工程|項目|品目)/,
    patterns: [
      /リスクアセスメント/,
      /(化学物質|有害物質)[^。\n]{0,15}(評価|管理|調査|ばく露)/,
      /(ばく露|曝露)[^。\n]{0,10}(濃度|基準|測定|評価)/,
    ],
    steps: [
      { name: "対象物質の洗い出しと台帳整理", by: "ai", minutes: 20, manualMinutes: 60 },
      { name: "SDSからの危険有害性情報の抽出", by: "ai", minutes: 15, manualMinutes: 45 },
      {
        name: "作業実態のヒアリング（使用量・換気・作業時間・保護具）",
        by: "human",
        minutes: 40,
        manualMinutes: 40,
        why: "現場の実際を聞かないと数字が入りません。ここは人が行くしかない工程です。",
      },
      { name: "厚労省のツール（CREATE-SIMPLE 等）への入力と算定", by: "ai", minutes: 20, manualMinutes: 40 },
      {
        name: "結果の妥当性確認とリスク低減措置の検討",
        by: "human",
        minutes: 40,
        manualMinutes: 60,
        why: "現場で実行できない対策を書いても意味がありません。妥当性の判断は人の仕事です。",
      },
      { name: "報告書の作成", by: "ai", minutes: 20, manualMinutes: 80 },
      { name: "説明・修正対応", by: "human", minutes: 30, manualMinutes: 30 },
    ],
    marketRateJpy: { low: 30_000, high: 120_000 },
    note:
      "資格は不要で、厚労省が無料のツールを公開しています。競合が少ない代わりに、募集としてはほぼ公開されません。出品するか、直接当たる市場です。",
  },
  {
    id: "work_standard",
    label: "作業標準書・手順書の作成",
    unit: "工程",
    unitPattern: /([0-9,]{1,5})\s*(?:工程|作業|手順|ページ|項目|本)/,
    patterns: [
      /(作業標準|標準作業|作業手順書|手順書|SOP)/,
      /(マニュアル|業務手順)[^。\n]{0,10}(作成|整備|作り)/,
    ],
    steps: [
      { name: "既存資料・動画・メモの読み込み", by: "ai", minutes: 20, manualMinutes: 40 },
      { name: "手順の構造化と下書き", by: "ai", minutes: 20, manualMinutes: 90 },
      {
        name: "現物・現場との突き合わせ",
        by: "human",
        minutes: 40,
        manualMinutes: 60,
        why: "書いた手順が実際にその通りにできるかは、やってみないと分かりません。",
      },
      { name: "図・写真の差し込みと体裁", by: "ai", minutes: 20, manualMinutes: 45 },
      { name: "現場レビューの反映", by: "human", minutes: 30, manualMinutes: 30 },
    ],
    marketRateJpy: { low: 8_000, high: 30_000 },
    note: "製造業の現場を知っていることが、そのまま検証工程の速さになります。",
  },
  {
    id: "iso_docs",
    label: "ISO文書の整備",
    unit: "文書",
    unitPattern: /([0-9,]{1,5})\s*(?:文書|規程|手順|様式|帳票)/,
    patterns: [/ISO\s?(9001|14001|45001|27001)/i, /(品質|環境|labour|労働安全)[^。\n]{0,8}マネジメントシステム/],
    steps: [
      { name: "規格要求事項と現状文書の突き合わせ", by: "ai", minutes: 30, manualMinutes: 90 },
      { name: "不足文書の下書き作成", by: "ai", minutes: 30, manualMinutes: 120 },
      {
        name: "実際の運用と合っているかの確認",
        by: "human",
        minutes: 45,
        manualMinutes: 60,
        why: "文書と運用がずれていると審査で落ちます。ここは現場を見ないと判断できません。",
      },
      { name: "審査指摘への対応", by: "human", minutes: 40, manualMinutes: 40 },
    ],
    marketRateJpy: { low: 30_000, high: 150_000 },
    note: "審査の指摘対応まで含むかで工数が大きく変わります。範囲を先に文面で区切ってください。",
  },
  {
    id: "translation",
    label: "翻訳（機械翻訳＋後編集）",
    unit: "文字",
    unitPattern: /([0-9,]{2,7})\s*(?:文字|ワード|words?)/i,
    patterns: [/(翻訳|和訳|英訳|ローカライズ|多言語化)/],
    steps: [
      { name: "機械翻訳にかける", by: "ai", minutes: 1, manualMinutes: 30 },
      {
        name: "後編集（訳抜け・用語統一・自然さ）",
        by: "human",
        minutes: 22,
        manualMinutes: 30,
        why: "機械翻訳は流暢に間違えます。原文と1文ずつ突き合わせないと訳抜けが見えません。実測でも、生成が速くなったぶん後編集が増えていました。",
      },
      { name: "用語集の作成・反映", by: "ai", minutes: 5, manualMinutes: 15 },
    ],
    note: "1,000文字あたりの分数として計算します。「AIで速い」を売りにすると単価が壊れる代表例なので、売るなら用語統一と品質保証のほうです。",
  },
  {
    id: "manual_writing",
    label: "マニュアル・業務手順の文書化",
    unit: "ページ",
    unitPattern: /([0-9,]{1,4})\s*(?:ページ|項目|章|本)/,
    patterns: [/(マニュアル|取扱説明書|業務フロー|オンボーディング資料)/],
    steps: [
      { name: "素材の読み込みと構成案", by: "ai", minutes: 15, manualMinutes: 40 },
      { name: "本文の下書き", by: "ai", minutes: 15, manualMinutes: 60 },
      { name: "事実確認と手順の検証", by: "human", minutes: 25, manualMinutes: 40, why: "手順が実際に通るかの確認は人がやるしかありません。" },
      { name: "図表の作成", by: "ai", minutes: 10, manualMinutes: 30 },
      { name: "修正対応", by: "human", minutes: 15, manualMinutes: 15 },
    ],
    marketRateJpy: { low: 3_000, high: 15_000 },
    note: "",
  },
];

export interface WorkTypeEstimate {
  workType: WorkType;
  /** 読み取れた数量 */
  units: number;
  /** 数量が本文から読めたか。読めなければ1件として計算している。 */
  unitsRead: boolean;
  /** AI併用での合計時間 */
  aiHours: number;
  /** 手作業だけの場合の合計時間 */
  manualHours: number;
  /** そのうち人がやらないと終わらない時間 */
  humanHours: number;
  /** 短縮率（0〜1）。1に近いほどAIで速くなる。 */
  reduction: number;
  /** 工程ごとの内訳。人に見せる。 */
  breakdown: { name: string; by: "ai" | "human"; hours: number; why?: string }[];
}

/**
 * 数量として読んではいけない数字を消す。
 *
 * 実データで「ISO14001 文書の整備」から 14,001文書 と読み、
 * 33,835時間 という見積りを出していた。ギークスジョブのページタグ
 * 「24365作業なし」からは 24,365工程 を読んでいた。
 * どちらも、そのまま時給の計算に流れる。
 */
export function stripNonQuantities(text: string): string {
  return (
    text
      // 規格番号: ISO9001 / ISO 14001 / JIS Z 7253 / IEC 62443
      .replace(/\b(ISO|IEC|JIS|ANSI|ASTM)\s?[A-Z]?\s?[0-9-]{3,7}/gi, " ")
      // 年号・西暦
      .replace(/\b(19|20)[0-9]{2}\s*年?/g, " ")
      // 5桁以上の連番（タグ・ID・郵便番号のたぐい）
      .replace(/\b[0-9]{5,}\b/g, " ")
  );
}

/** 副業として現実的な数量の上限。これを超えたら読み間違いとみなす。 */
const MAX_PLAUSIBLE_UNITS = 500;

/**
 * 「これを作ってください」と依頼している形。
 * 助詞で見る。日本語は「Xを作成」「Xの作成」が依頼で、「Xが整備されている」は状態の説明。
 */
const AS_REQUEST =
  /[をの]\s*[^。\n]{0,20}(作成|制作|整備|作り|書き|執筆|依頼|お願い|募集|代行|支援|実施)/;

/**
 * 語そのものが動詞になるもの（翻訳・英訳・リスクアセスメント）は、
 * 直後の「してください」「をお願い」で依頼と分かる。
 */
const AS_SAHEN_REQUEST =
  /^\s*(を?\s*(し|いたし|お願い|依頼|代行|対応)|の\s*(お願い|依頼|代行|案件|業務))/;

/**
 * 「SDS作成」「リスクアセスメント実施」のように、助詞をはさまず
 * 直後に動作の語が続く形。日本語ではこれが一番よくある依頼の書き方。
 * 「手順書が整備されている」は先に AS_BACKGROUND で落ちるので、ここには来ない。
 */
const AS_COMPOUND = /^\s*(作成|制作|整備|作り|執筆|代行|支援|実施|対応)/;

/**
 * 状態の説明。ここに当たるものは依頼ではない。
 * 実データで「確実な手順書が整備されているため」という背景説明だけで、
 * SAP運用保守の案件を「作業標準書の作成」と判定していた。
 */
const AS_BACKGROUND =
  /が\s*[^。\n]{0,10}(整備|完備|用意|存在|あり|ある|ござい|できてい|揃っ)|に\s*(沿っ|従っ|基づ)/;

/**
 * その仕事を「依頼されている」のか、単に言及されているだけなのかを見る。
 *
 * 位置では判定しない。本文抽出が JSON-LD の説明文を先頭に置くので、
 * 「先頭にあれば依頼」という仮定は成り立たなかった。
 */
function matchesAsRequest(text: string, workType: WorkType): boolean {
  // 短い文字列は、それ自体が依頼。背景としての言及は長い文章の中に現れる。
  const isShort = text.length < 120;

  for (const p of workType.patterns) {
    // 同じ語が複数回出るので、依頼の形で使われている箇所があるかを全部見る
    const re = new RegExp(p.source, p.flags.includes("g") ? p.flags : `${p.flags}g`);
    for (const m of text.matchAll(re)) {
      if (m.index === undefined) continue;
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 30);
      if (AS_BACKGROUND.test(after)) continue;
      if (isShort) return true;
      if (AS_REQUEST.test(after) || AS_SAHEN_REQUEST.test(after) || AS_COMPOUND.test(after)) return true;
      // 「作業標準書の作成をお願いします」のように語の前に依頼語がある形
      const before = text.slice(Math.max(0, m.index - 20), m.index);
      if (/(作成|制作|整備|代行)\s*[すし]?\s*[るま]?[^。\n]{0,6}$/.test(before)) return true;
    }
  }
  return false;
}

/** 本文がどの仕事に当たるかを判定し、工程を積み上げて時間を出す。 */
export function estimateByWorkType(text: string): WorkTypeEstimate | null {
  const normalized = text.normalize("NFKC");
  // 仕事の種類の判定には規格番号が要る（ISO9001 で ISO 案件と分かる）ので元のまま。
  // 数量を読むときだけ、数量ではない数字を消したテキストを使う。
  // 本文にたまたま出てくる語で仕事の種類を決めない。
  // 実データで「確実な手順書が整備されているため」という一文だけで
  // SAP運用保守の案件を「作業標準書の作成」と判定していた。
  const workType = WORK_TYPES.find((w) => matchesAsRequest(normalized, w));
  if (!workType) return null;

  const t = stripNonQuantities(normalized);
  const m = t.match(workType.unitPattern);
  const raw = m ? Number(m[1].replace(/,/g, "")) : NaN;
  // 文字単位の仕事だけは桁が大きいので別枠
  const cap = workType.unit === "文字" ? 500_000 : MAX_PLAUSIBLE_UNITS;
  const unitsRead = Number.isFinite(raw) && raw > 0 && raw <= cap;
  // 文字単位の仕事は1,000文字を1単位として数える
  const perUnit = workType.unit === "文字" ? 1000 : 1;
  const units = unitsRead ? Math.max(1, Math.ceil(raw / perUnit)) : 1;

  const sum = (pick: (s: WorkStep) => number) =>
    workType.steps.reduce((acc, s) => acc + pick(s), 0);

  const aiMinutes = sum((s) => s.minutes) * units;
  const manualMinutes = sum((s) => s.manualMinutes) * units;
  const humanMinutes = sum((s) => (s.by === "human" ? s.minutes : 0)) * units;

  return {
    workType,
    units,
    unitsRead,
    aiHours: round(aiMinutes / 60),
    manualHours: round(manualMinutes / 60),
    humanHours: round(humanMinutes / 60),
    reduction: manualMinutes > 0 ? round(1 - aiMinutes / manualMinutes) : 0,
    breakdown: workType.steps.map((s) => ({
      name: s.name,
      by: s.by,
      hours: round((s.minutes * units) / 60),
      why: s.why,
    })),
  };
}

const round = (n: number): number => Math.round(n * 10) / 10;

/** 人が読む説明文にする。 */
export function describeWorkType(e: WorkTypeEstimate): string {
  const unitLabel = e.workType.unit === "文字" ? `${e.units * 1000}文字` : `${e.units}${e.workType.unit}`;
  const counted = e.unitsRead ? unitLabel : `${unitLabel}（数量が読めなかったので1単位として計算）`;
  return (
    `${e.workType.label} / ${counted}。` +
    `AI併用で ${e.aiHours}時間（手作業だけなら ${e.manualHours}時間、短縮 ${Math.round(e.reduction * 100)}%）。` +
    `うち ${e.humanHours}時間 はあなたが手を動かす必要があります。`
  );
}
