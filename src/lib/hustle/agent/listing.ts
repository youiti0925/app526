import { PLATFORM_FEES, type PlatformFee } from "../payout";
import { requiredAsk } from "./renegotiate";
import { WORK_TYPES, estimateByWorkType, type WorkType } from "./worktypes";

/**
 * 出品型のパイプライン。
 *
 * なぜ要るか:
 * ここまでのパイプラインは全部「募集に応募する」前提だった。
 * ところが実測で、募集として公開されている仕事は
 *   - ココナラの公開依頼 = イラスト・動画・作曲（AIでは納品物を作れない）
 *   - エージェント系 = 月140時間の準委任（週10時間では受けられない）
 * のどちらかで、週10時間で受けられてAIが作れる仕事はほとんど無かった。
 *
 * 一方、実効時給が高く競合が少ないと分かった SDS作成・化学物質リスクアセスメント・
 * 作業標準書・ISO文書整備は、ココナラの公開依頼1,751件に1件も出てこない。
 * これらは「出品して待つ」か「直接当たる」市場で、
 * 応募型のパイプラインからは原理的に見えない。
 *
 * だからここは、応募するのではなく「店を出す」ための層。
 * 出品文・料金プラン・責任範囲を作って承認キューに出す。
 * 出品そのものは人がやる（自動出品は規約違反になる）。
 */

export interface PriceTier {
  name: string;
  /** 何単位ぶんか */
  units: number;
  /** 提示価格（税込・手数料込みの請求額） */
  priceJpy: number;
  /** 想定工数（AI併用） */
  hours: number;
  /** 手数料を引いたあとの実効時給 */
  hourlyJpy: number;
  includes: string[];
}

export interface ListingPlan {
  workTypeId: string;
  title: string;
  catchCopy: string;
  body: string;
  tiers: PriceTier[];
  /** 購入者に用意してもらうもの */
  needsFromBuyer: string[];
  /** 納品するもの */
  deliverables: string[];
  /** やらないこと。ここを書かないと際限なく増える。 */
  notIncluded: string[];
  faq: { q: string; a: string }[];
  leadTimeDays: number;
  /** 出品先の候補 */
  where: string[];
  /** 資格・責任の線引き。書かないと誤解を招く。 */
  disclaimer: string;
  /** 相場と比べてどうか */
  priceCheck: string;
}

/** 出品するときの目標時給。応募型より高く取る。 */
function targetHourly(minHourlyJpy: number): number {
  // 出品型は入札の叩き合いにならないぶん、単価を上げられる。
  // ただし最初は実績ゼロなので、相場の下限側に寄せる。
  return Math.max(2500, minHourlyJpy * 2);
}

const TIER_SHAPES: { name: string; units: number; note: string }[] = [
  { name: "お試し", units: 1, note: "まず1件だけ。品質を見てから判断してもらう" },
  { name: "標準", units: 3, note: "よくある依頼の規模" },
  { name: "まとめて", units: 10, note: "件数が多いほど1件あたりは下げられる" },
];

/** 件数が増えるほど1件あたりを下げる（まとめて受けたほうが効率がいいため）。 */
function volumeDiscount(units: number): number {
  if (units >= 10) return 0.8;
  if (units >= 3) return 0.9;
  return 1;
}

function buildTiers(workType: WorkType, minHourlyJpy: number, platform: PlatformFee): PriceTier[] {
  const target = targetHourly(minHourlyJpy);
  const perUnit = estimateByWorkType(sampleText(workType));

  return TIER_SHAPES.map((shape) => {
    const hours = perUnit ? Math.round(perUnit.aiHours * shape.units * 10) / 10 : shape.units * 4;
    const raw = requiredAsk(target * volumeDiscount(shape.units), hours, platform) ?? 0;

    // 相場から外れすぎないように寄せる。
    // まとめ割は「目標時給から出した価格」にだけ効かせる。相場の下限にまで
    // 掛けると、自分で相場割れの値段を付けたうえで「安すぎる」と警告することになる。
    const market = workType.marketRateJpy;
    let price = raw;
    if (market) {
      const floor = Math.round((market.low * shape.units) / 1000) * 1000;
      const ceil = Math.round((market.high * shape.units) / 1000) * 1000;
      price = Math.min(Math.max(raw, floor), ceil);
    }

    const net = Math.max(0, price - Math.floor(price * platform.feeRate) - platform.withdrawalFeeJpy);
    return {
      name: shape.name,
      units: shape.units,
      priceJpy: price,
      hours,
      hourlyJpy: hours > 0 ? Math.round(net / hours) : 0,
      includes: buildIncludes(workType, shape.units, shape.note),
    };
  });
}

function buildIncludes(workType: WorkType, units: number, note: string): string[] {
  const machine = workType.steps.filter((s) => s.by === "ai").map((s) => s.name);
  const human = workType.steps.filter((s) => s.by === "human").map((s) => s.name);
  return [
    `${units}${workType.unit}ぶん`,
    ...machine.slice(0, 3),
    ...human.slice(0, 2),
    "修正2回まで",
    note,
  ];
}

/** 工程分解の数量を読ませるための、その仕事の代表的な言い回し。 */
function sampleText(workType: WorkType): string {
  return `1${workType.unit}の${workType.label}`;
}

// ---------------------------------------------------------------------------
// 出品文
// ---------------------------------------------------------------------------

interface ListingCopy {
  title: string;
  catchCopy: string;
  body: string;
  needsFromBuyer: string[];
  deliverables: string[];
  notIncluded: string[];
  faq: { q: string; a: string }[];
  leadTimeDays: number;
  where: string[];
  disclaimer: string;
}

const COPY: Record<string, ListingCopy> = {
  sds: {
    title: "SDS（安全データシート）の作成・改訂を代行します",
    catchCopy: "GHS区分は政府の分類結果と1件ずつ突き合わせて確認します",
    body: [
      "製品のSDS（安全データシート）を、JIS Z 7253 に沿った16項目の形式で作成・改訂します。",
      "",
      "2026年4月の労働安全衛生法改正で、SDS交付義務の対象物質が大きく増えました。",
      "対象になったが手が回っていない、という状況に対応します。",
      "",
      "【進め方】",
      "1. 原材料の組成情報と、既存のSDSがあればそれをお送りください",
      "2. こちらで16項目の下書きを作成します",
      "3. GHS区分は、政府のGHS分類結果とモデルSDSに1件ずつ当てて確認します",
      "4. 安衛法・化管法・消防法の該当性を確認します",
      "5. 御社の書式に合わせて整えて納品します",
      "",
      "【この工程にしている理由】",
      "GHS区分は、1段ずれていても文章としては自然に読めてしまいます。",
      "生成AIの出力をそのまま渡すと、この誤りが誰にも気づかれないまま流通します。",
      "そのため区分の確認だけは、必ず一次情報に当てる工程として分けています。",
    ].join("\n"),
    needsFromBuyer: [
      "原材料の組成情報（配合率、CAS番号が分かれば併せて）",
      "既存のSDSがあればそのファイル",
      "御社指定の書式があればテンプレート",
      "想定される用途と使用条件",
    ],
    deliverables: ["16項目のSDS（Word / PDF）", "GHS区分の根拠一覧（どの分類結果を参照したか）"],
    notIncluded: [
      "成分分析・試験の実施（分析機関への依頼が必要です）",
      "登録・届出の代行（行政手続の代理は行政書士の業務です）",
      "ラベル印刷の手配",
    ],
    faq: [
      {
        q: "資格は持っていますか？",
        a: "SDSの作成に法定の資格要件はありません。私は製造業の現場実務の経験があり、工程と使用実態を踏まえて作成します。有資格者の証明が必要な場合は、その旨をお知らせください。",
      },
      {
        q: "内容の最終責任はどちらにありますか？",
        a: "SDSの交付者は御社になりますので、最終的な確認と責任は御社にあります。こちらは根拠を明示した状態で納品しますので、確認しやすい形にしています。",
      },
      { q: "急ぎで対応できますか？", a: "件数と情報の揃い具合によります。まずご相談ください。" },
    ],
    leadTimeDays: 10,
    where: ["ココナラ（出品）", "業界団体の会員向け掲示板", "取引先への直接案内"],
    disclaimer:
      "法定資格を要する業務ではありませんが、私は化学物質管理の有資格者ではありません。SDSの交付責任は交付者（御社）にあります。根拠を明示して納品しますので、必ず内容をご確認のうえ交付してください。",
  },

  risk_assessment: {
    title: "化学物質リスクアセスメントの実施と報告書作成を代行します",
    catchCopy: "厚労省の無料ツールを使い、現場の実態を聞き取ったうえで算定します",
    body: [
      "労働安全衛生法で義務づけられている化学物質のリスクアセスメントを、実施から報告書作成まで代行します。",
      "",
      "【進め方】",
      "1. 使用している化学物質の台帳を整理します（SDSをお送りください）",
      "2. 危険有害性の情報を抽出します",
      "3. 作業の実態をヒアリングします（使用量・換気・作業時間・保護具。オンライン可）",
      "4. 厚労省の CREATE-SIMPLE 等でリスクを算定します",
      "5. 結果の妥当性を確認し、実行できるリスク低減措置を検討します",
      "6. 報告書にまとめます",
      "",
      "【ヒアリングを必ず行う理由】",
      "同じ物質でも、使用量・換気・作業時間で結果はまったく変わります。",
      "SDSだけを見て算定した数字は、書類としては成立しますが実態を表しません。",
      "現場を聞かずに出す報告書は、監督署の指摘にも労災の防止にも役に立ちません。",
      "",
      "製造業の現場経験があるので、何を聞けばよいかが分かります。",
      "ヒアリングは1物質あたり短時間で済みます。",
    ].join("\n"),
    needsFromBuyer: [
      "対象化学物質のSDS",
      "使用量・使用頻度が分かる資料（概算で構いません）",
      "作業場の換気状況（局所排気の有無）",
      "使用している保護具",
      "ヒアリングに対応できる方の時間（1回・オンライン可）",
    ],
    deliverables: [
      "リスクアセスメント実施記録（物質ごと）",
      "算定に使った条件の一覧",
      "リスク低減措置の提案",
      "報告書（Word / PDF）",
    ],
    notIncluded: [
      "作業環境測定の実施（作業環境測定士の業務です）",
      "個人ばく露測定の実施",
      "監督署への届出の代行（行政手続の代理は行政書士の業務です）",
      "保護具の選定と購入の手配",
    ],
    faq: [
      {
        q: "資格は必要ないのですか？",
        a: "リスクアセスメントの実施自体に法定の資格要件はありません。ただし作業環境測定は測定士の業務なので、そこは含みません。",
      },
      {
        q: "何物質からお願いできますか？",
        a: "1物質からお受けします。まず1物質で内容をご確認いただいてから、残りを進めるのが安心かと思います。",
      },
      {
        q: "現場に来てもらえますか？",
        a: "ヒアリングはオンラインで対応しています。現地確認が必要な場合は別途ご相談ください。",
      },
    ],
    leadTimeDays: 14,
    where: ["ココナラ（出品）", "地域の中小企業支援機関", "業界団体", "取引先への直接案内"],
    disclaimer:
      "作業環境測定・個人ばく露測定は含みません（有資格者の業務です）。リスクアセスメントの実施義務は事業者にありますので、内容をご確認のうえご活用ください。",
  },

  work_standard: {
    title: "作業標準書・手順書を作成します",
    catchCopy: "現場の動画やメモから、そのまま使える手順書に起こします",
    body: [
      "作業標準書・手順書を、既存の資料や現場の動画・メモから作成します。",
      "",
      "【進め方】",
      "1. 既存の資料、作業動画、担当者のメモをお送りください",
      "2. 手順を構造化して下書きを作成します",
      "3. 抜けている前提（工具・治具・判断基準）を洗い出してご質問します",
      "4. 図・写真を差し込んで体裁を整えます",
      "5. 現場レビューの指摘を反映します",
      "",
      "【よくある問題】",
      "手順書が使われない一番の理由は、書いた人が分かっている前提を書いていないことです。",
      "「適切に」「必要に応じて」で済ませている箇所を、判断基準の形に書き直します。",
      "製造業の現場経験があるので、どこが抜けているかが読めます。",
    ].join("\n"),
    needsFromBuyer: [
      "既存の手順書・作業指示書があればそのファイル",
      "作業の動画または写真",
      "担当者への確認ができる時間（チャットでも可）",
    ],
    deliverables: ["作業標準書（Word / Excel / PDF）", "確認が必要な箇所の一覧"],
    notIncluded: ["現地での撮影", "作業そのものの改善提案（別途ご相談ください）"],
    faq: [
      { q: "動画がなくても頼めますか？", a: "既存資料と口頭説明でも作成できます。ただし抜けの確認に往復が増えます。" },
      { q: "英語版も作れますか？", a: "対応できます。技術文書の翻訳としてご相談ください。" },
    ],
    leadTimeDays: 7,
    where: ["ココナラ（出品）", "取引先への直接案内", "地域の中小企業支援機関"],
    disclaimer: "納品物の内容確認と、現場での運用可否の判断は御社でお願いします。",
  },

  iso_docs: {
    title: "ISO（9001 / 14001 / 45001）の文書整備を代行します",
    catchCopy: "規格要求と現状文書を突き合わせ、足りない文書を作ります",
    body: [
      "ISOマネジメントシステムの文書整備を代行します。",
      "",
      "【進め方】",
      "1. 現在の文書一式と、規格の該当バージョンを確認します",
      "2. 規格要求事項と現状を突き合わせ、不足を洗い出します",
      "3. 不足している文書の下書きを作成します",
      "4. 実際の運用と合っているかを確認します",
      "5. 審査の指摘に対応します（ご希望の場合）",
      "",
      "【文書と運用がずれると審査で落ちます】",
      "既存のひな形をそのまま入れると、実際にやっていないことが書かれた文書ができます。",
      "そこは審査で必ず突かれます。運用に合わせて書き換えることを前提にしています。",
    ].join("\n"),
    needsFromBuyer: [
      "現在の文書一式",
      "取得または更新する規格とバージョン",
      "審査の予定日（決まっていれば）",
      "運用の実態を確認できる方の時間",
    ],
    deliverables: ["不足文書の一覧と対応表", "作成した文書一式", "規格要求との対応関係"],
    notIncluded: ["審査機関との折衝の代理", "内部監査員としての実施（別途ご相談ください）"],
    faq: [
      { q: "審査の指摘対応まで含みますか？", a: "範囲によって工数が大きく変わるため、別見積もりとしています。" },
      { q: "コンサルタントの資格はありますか？", a: "ISOの審査員資格は持っていません。文書作成の実務としてお受けします。" },
    ],
    leadTimeDays: 21,
    where: ["ココナラ（出品）", "取引先への直接案内", "地域の中小企業支援機関"],
    disclaimer:
      "ISO審査員・コンサルタントの資格は持っていません。文書作成の実務としてお受けします。認証取得の可否を保証するものではありません。",
  },
};

// ---------------------------------------------------------------------------

/** 1つの出品プランを作る。 */
export function buildListing(
  workTypeId: string,
  options: { minHourlyJpy: number; platformId?: string } = { minHourlyJpy: 1121 }
): ListingPlan | null {
  const workType = WORK_TYPES.find((w) => w.id === workTypeId);
  const copy = COPY[workTypeId];
  if (!workType || !copy) return null;

  const platform =
    PLATFORM_FEES.find((p) => p.id === (options.platformId ?? "coconala")) ?? PLATFORM_FEES[0];
  const tiers = buildTiers(workType, options.minHourlyJpy, platform);

  return {
    workTypeId,
    ...copy,
    tiers,
    priceCheck: checkAgainstMarket(workType, tiers, options.minHourlyJpy),
  };
}

function checkAgainstMarket(workType: WorkType, tiers: PriceTier[], minHourlyJpy: number): string {
  const standard = tiers.find((t) => t.name === "標準") ?? tiers[0];
  const parts: string[] = [];

  parts.push(
    `標準プランは ${standard.priceJpy.toLocaleString()}円 / ${standard.hours}時間 → ` +
      `手数料を引いた実効時給 ${standard.hourlyJpy.toLocaleString()}円。`
  );

  if (standard.hourlyJpy < minHourlyJpy) {
    parts.push(
      `基準の ${minHourlyJpy.toLocaleString()}円 を下回っています。相場に合わせて下げた結果なので、` +
        `この価格で受けるなら工程を削るか、件数をまとめてください。`
    );
  }

  if (workType.marketRateJpy) {
    const perUnit = Math.round(standard.priceJpy / standard.units);
    const { low, high } = workType.marketRateJpy;
    if (perUnit < low) {
      parts.push(`1${workType.unit}あたり ${perUnit.toLocaleString()}円 は相場（${low.toLocaleString()}〜${high.toLocaleString()}円）より安いです。上げる余地があります。`);
    } else if (perUnit > high) {
      parts.push(`1${workType.unit}あたり ${perUnit.toLocaleString()}円 は相場の上限を超えています。なぜその値段なのかを本文で説明しないと売れません。`);
    } else {
      parts.push(`1${workType.unit}あたり ${perUnit.toLocaleString()}円 で、相場（${low.toLocaleString()}〜${high.toLocaleString()}円）の範囲に入っています。`);
    }
  } else {
    parts.push("この仕事の相場データを持っていないので、価格の妥当性は検証できていません。");
  }

  return parts.join("");
}

/** 出品できる仕事を全部返す。 */
export const listableWorkTypes = (): string[] => Object.keys(COPY);

/** 承認キューに出す本文にする。 */
export function renderListing(plan: ListingPlan): string {
  const lines: string[] = [];

  lines.push(`# ${plan.title}`);
  lines.push("");
  lines.push(`**${plan.catchCopy}**`);
  lines.push("");
  lines.push(plan.body);
  lines.push("");
  lines.push("## 料金プラン");
  lines.push("");
  lines.push("| プラン | 内容 | 価格 | 想定工数 | 実効時給 |");
  lines.push("| --- | --- | ---: | ---: | ---: |");
  for (const t of plan.tiers) {
    lines.push(
      `| ${t.name} | ${t.units}件 | ${t.priceJpy.toLocaleString()}円 | ${t.hours}時間 | ${t.hourlyJpy.toLocaleString()}円 |`
    );
  }
  lines.push("");
  lines.push(`納期の目安: ${plan.leadTimeDays}日`);
  lines.push("");
  lines.push("## 用意していただくもの");
  lines.push("");
  for (const n of plan.needsFromBuyer) lines.push(`- ${n}`);
  lines.push("");
  lines.push("## 納品するもの");
  lines.push("");
  for (const d of plan.deliverables) lines.push(`- ${d}`);
  lines.push("");
  lines.push("## 含まないもの");
  lines.push("");
  for (const n of plan.notIncluded) lines.push(`- ${n}`);
  lines.push("");
  lines.push("## よくあるご質問");
  lines.push("");
  for (const f of plan.faq) {
    lines.push(`**${f.q}**`);
    lines.push("");
    lines.push(f.a);
    lines.push("");
  }
  lines.push("## お断りしていること");
  lines.push("");
  lines.push(plan.disclaimer);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 出品前に確認してください");
  lines.push("");
  lines.push(`- 価格の検証: ${plan.priceCheck}`);
  lines.push("- 経歴の記述が、実際に説明できる範囲に収まっているか");
  lines.push("- 「含まないもの」に、あなたがやりたくない作業が入っているか");
  lines.push(`- 出品先の候補: ${plan.where.join(" / ")}`);
  lines.push("- 出品はあなたが手で行ってください（自動出品は各サービスの規約違反です）");

  return lines.join("\n");
}
