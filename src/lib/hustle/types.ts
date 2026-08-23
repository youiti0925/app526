// ---------------------------------------------------------------------------
// 副業パイプライン: 型定義
// ---------------------------------------------------------------------------

/** 収益チャネルの種別。市場調査で検証済みのカテゴリに対応する。 */
export type PathKey =
  | "crowdsourcing"
  | "local_b2b"
  | "unused_resale"
  | "content_seo"
  | "digital_products"
  | "micro_tools"
  | "short_video";

export type PathStatus = "considering" | "active" | "paused" | "killed";

export type TaskKind = "setup" | "produce" | "publish" | "outreach" | "admin" | "learn";
export type TaskStatus = "todo" | "doing" | "done" | "skipped";

export type EntryKind = "income" | "expense" | "time";

export type AssetKind =
  | "proposal"
  | "article"
  | "thread"
  | "script"
  | "listing"
  | "outreach_mail"
  | "profile"
  | "other";

export type AssetStatus = "draft" | "ready" | "published";

/** 自己申告のプロフィール。診断エンジンの入力になる。 */
export interface HustleProfile {
  /** 使える時間（時間/週） */
  weeklyHours: number;
  /** 今すぐ副業に投じられる現金（円）。0 を許容する。 */
  budgetJpy: number;
  /** いつまでにいくら必要か */
  goalJpy: number;
  /** 目標期限（YYYY-MM-DD）。空なら期限なし。 */
  deadline: string;
  /** 持っているスキル */
  skills: string[];
  /** 持っている機材・環境 */
  equipment: string[];
  /** 本人確認書類・銀行口座など、換金に必要な前提の充足状況 */
  hasBankAccount: boolean;
  hasIdVerification: boolean;
  /** 本業の副業禁止規定など、身バレを避ける必要があるか */
  needsAnonymity: boolean;
  /** やりたくないこと */
  avoid: string[];
  /**
   * 経歴・できること。提案文と営業メールの生成に使う。
   * エージェントはサーバー側で動くため、ブラウザではなくここに持つ必要がある。
   */
  background: string;
  updatedAt: string;
}

export const emptyProfile: HustleProfile = {
  weeklyHours: 10,
  budgetJpy: 0,
  goalJpy: 30000,
  deadline: "",
  skills: [],
  equipment: [],
  hasBankAccount: true,
  hasIdVerification: true,
  needsAnonymity: false,
  avoid: [],
  background: "",
  updatedAt: "",
};

/** ユーザーが実際に運用している（or 検討中の）収益チャネル。 */
export interface HustlePath {
  id: string;
  pathKey: PathKey;
  name: string;
  status: PathStatus;
  targetJpy: number;
  notes: string;
  startedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** 今日やること。診断結果から自動生成され、手動追加もできる。 */
export interface HustleTask {
  id: string;
  pathId: string | null;
  title: string;
  detail: string;
  kind: TaskKind;
  status: TaskStatus;
  /** 実行予定日（YYYY-MM-DD）。空なら未スケジュール。 */
  dueDate: string;
  estMinutes: number;
  actualMinutes: number;
  orderIndex: number;
  doneAt: string | null;
  createdAt: string;
  /** この作業を下書きできるテンプレートのID。無ければ空文字。 */
  template: string;
}

/** 金と時間の台帳。実効時給の計算元。 */
export interface HustleEntry {
  id: string;
  pathId: string | null;
  /** YYYY-MM-DD */
  date: string;
  kind: EntryKind;
  /** income / expense のとき使う（円） */
  amountJpy: number;
  /** time のとき使う（分） */
  minutes: number;
  memo: string;
  /** 入金済みか。受注確定だが未入金の売上を区別する。 */
  settled: boolean;
  createdAt: string;
}

/** AI が生成した成果物。 */
export interface HustleAsset {
  id: string;
  pathId: string | null;
  kind: AssetKind;
  title: string;
  body: string;
  /** 生成時の入力・メタ情報 */
  meta: Record<string, unknown>;
  status: AssetStatus;
  createdAt: string;
}

/** 詐欺・搾取案件の判定結果。 */
export interface ScamCheck {
  id: string;
  source: string;
  text: string;
  /** 0-100。高いほど危険。 */
  score: number;
  verdict: "safe" | "caution" | "danger";
  signals: ScamSignalHit[];
  advice: string;
  createdAt: string;
}

export interface ScamSignalHit {
  id: string;
  label: string;
  weight: number;
  why: string;
  /** 判定根拠になった本文中の抜粋 */
  excerpt?: string;
}

/** アプリ全体のエクスポート形式（バックアップ／機種変更用）。 */
export interface HustleBackup {
  version: 1;
  exportedAt: string;
  profile: HustleProfile | null;
  paths: HustlePath[];
  tasks: HustleTask[];
  entries: HustleEntry[];
  assets: HustleAsset[];
  scamChecks: ScamCheck[];
}
