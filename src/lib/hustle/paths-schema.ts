import type { PathKey, TaskKind } from "./types";
import type { TemplateId } from "./templates";

/** 診断で使う、収益チャネル1つ分の実データ。 */
export interface PathDefinition {
  key: PathKey;
  name: string;
  oneLiner: string;

  // --- 現実の数字（市場調査で裏取りした値。盛らない） ---
  /** 始めるのに最低限かかる現金（円） */
  upfrontCostJpy: number;
  /** 最初の1円が入金されるまでの日数。p50 は中央値、p90 は遅い側。 */
  daysToFirstYen: { p50: number; p90: number };
  /** 3ヶ月目・6ヶ月目の月収。continue できた人の中央値レンジ（円）。 */
  month3Jpy: [number, number];
  month6Jpy: [number, number];
  /** 1円も稼げずに終わる割合の説明 */
  failureNote: string;
  /** 最低限必要な稼働時間（時間/週） */
  minWeeklyHours: number;
  /** 収入の安定性: 1（単発・不安定）〜5（積み上がる） */
  stability: number;
  /** 上限の高さ: 1（頭打ちが早い）〜5（伸ばせる） */
  ceiling: number;

  // --- 前提条件 ---
  requires: {
    /** 報酬の受け取りに銀行口座が要るか */
    bankAccount: boolean;
    /** 本人確認（マイナンバー・身分証）が要るか */
    idVerification: boolean;
    /** 実名・顔・所在が相手に見える必要があるか */
    publicIdentity: boolean;
    /** 事前に見せられる実績・ポートフォリオが要るか */
    portfolio: boolean;
  };
  /** このスキルタグを持っていると加点（0〜30） */
  skillAffinity: Partial<Record<SkillTag, number>>;
  /** 無いと厳しい機材 */
  equipment: EquipmentTag[];

  // --- 中身 ---
  whyItWorks: string;
  whyPeopleFail: string[];
  platformRules: string[];
  /** このアプリが実際に肩代わりする工程 */
  automatable: { step: string; how: string; savedMinutesPerUnit: number; feature: AppFeature }[];
  /** 自動化できない、人間がやるしかない工程 */
  humanOnly: string[];
  /** 立ち上げ30日分の具体的な行動 */
  plan: PlanItem[];
  sources: string[];
}

export interface PlanItem {
  /** 開始から何日目か（0 = 今日） */
  day: number;
  title: string;
  detail: string;
  kind: TaskKind;
  estMinutes: number;
  /** この作業をアプリに下書きさせられる場合、対応するテンプレートのID */
  template?: TemplateId;
}

/** アプリ内のどの機能がその工程を担当するか */
export type AppFeature = "proposal" | "factory" | "scam" | "money" | "manual";

export type SkillTag =
  | "writing"
  | "design"
  | "coding"
  | "excel"
  | "video_edit"
  | "photo"
  | "sales"
  | "customer_support"
  | "translation"
  | "data_entry"
  | "domain_expertise"
  | "sns";

export const SKILL_LABELS: Record<SkillTag, string> = {
  writing: "文章を書く",
  design: "デザイン・画像編集",
  coding: "プログラミング",
  excel: "Excel・スプレッドシート",
  video_edit: "動画編集",
  photo: "写真撮影",
  sales: "営業・人と話す",
  customer_support: "接客・カスタマーサポート",
  translation: "翻訳・語学",
  data_entry: "データ入力・事務",
  domain_expertise: "仕事で得た専門知識がある",
  sns: "SNS運用",
};

export type EquipmentTag = "pc" | "smartphone" | "camera" | "stable_internet" | "quiet_room";

export const EQUIPMENT_LABELS: Record<EquipmentTag, string> = {
  pc: "パソコン",
  smartphone: "スマートフォン",
  camera: "カメラ（スマホ可）",
  stable_internet: "安定したネット回線",
  quiet_room: "静かに作業・通話できる場所",
};

export type PathMap = Record<PathKey, PathDefinition>;
