// ---------------------------------------------------------------------------
// 自律エージェント: 型定義
// ---------------------------------------------------------------------------

/** エージェントが順に実行する工程。 */
export type StepId = "ingest" | "triage" | "listing" | "draft" | "plan" | "review" | "learn";

export const STEP_LABELS: Record<StepId, string> = {
  ingest: "案件の取り込み",
  triage: "案件の判定",
  listing: "出品の準備",
  draft: "下書きの生成",
  plan: "計画の組み直し",
  review: "収支レビュー",
  learn: "自己調整",
};

/**
 * 実行する順番。ここが唯一の定義。
 *
 * 以前は runner・APIルート・画面がそれぞれ同じ配列を持っていて、
 * `listing` を足したときに run のAPIルートだけ更新し忘れた。
 * その結果 `only: ["listing"]` が「該当なし」となり、
 * 絞り込みが無かったことにされて全工程が走っていた。
 */
export const STEP_ORDER: StepId[] = [
  "ingest",
  "triage",
  "listing",
  "draft",
  "plan",
  "review",
  "learn",
];

export type RunTrigger = "manual" | "auto_open" | "daemon" | "cron";
export type RunStatus = "running" | "done" | "failed" | "skipped";

export interface AgentRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  trigger: RunTrigger;
  /** 人が読む1行の要約 */
  summary: string;
  /** この実行で消費した生成AIの呼び出し回数 */
  callsUsed: number;
}

export type EventLevel = "info" | "action" | "decision" | "warn" | "error";

/**
 * 何を見て、何を判断して、何をしたかの記録。
 * 勝手に動くものを信用してもらうには、これが全部見えている必要がある。
 */
export interface AgentEvent {
  id: string;
  runId: string;
  step: StepId | "runner";
  level: EventLevel;
  message: string;
  data: Record<string, unknown>;
  createdAt: string;
}

// --- 案件（lead）のパイプライン --------------------------------------------

export type LeadSource = "manual" | "paste" | "rss" | "email" | "site" | "discovery";
export type LeadStatus =
  | "new" // 取り込んだだけ
  | "triaged" // 判定済み
  | "drafted" // 下書きを作って承認待ちに積んだ
  | "rejected" // 判定で落とした
  | "applied" // 人が応募した
  | "won" // 受注できた
  | "lost" // 返事がなかった / 落ちた
  | "archived";

export interface Lead {
  id: string;
  source: LeadSource;
  /** 取り込み元での識別子。重複取り込みを防ぐ。 */
  externalId: string;
  url: string;
  title: string;
  rawText: string;
  /** 読み取れた報酬額。読めなければ null。 */
  budgetJpy: number | null;
  postedAt: string;
  status: LeadStatus;
  /** 0-100。高いほど「受ける価値がある」。 */
  score: number;
  /** triage の結論 */
  verdict: "reject" | "verify_first" | "proceed" | "unknown";
  /** triage の詳細（詐欺スコア、想定時間、実効時給など） */
  triage: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// --- 承認キュー -------------------------------------------------------------

export type InboxKind =
  | "proposal" // 提案文（送るとお金になる）
  | "outreach" // 営業メール
  | "listing" // 出品文
  | "deliverable" // 納品物の初稿
  | "warning" // 危険の通知（承認する対象ではない）
  | "question" // 人に判断してほしいこと
  | "report"; // 週次レビューなど

export type InboxStatus = "pending" | "approved" | "rejected" | "expired";

export interface InboxItem {
  id: string;
  runId: string;
  kind: InboxKind;
  /** 高いほど先に出す（0-100） */
  priority: number;
  title: string;
  body: string;
  /** 送信先URLなど、承認したときに開く先 */
  actionUrl: string;
  /** 紐づく案件 */
  leadId: string | null;
  meta: Record<string, unknown>;
  status: InboxStatus;
  decidedAt: string | null;
  /** 却下した理由。学習に使う。 */
  decisionNote: string;
  createdAt: string;
}

// --- 設定と学習パラメータ ---------------------------------------------------

/**
 * サイトマップ収集の状態。ソースごとに持つ。
 * since を進めることで、次回は前回以降に更新されたものだけを見る。
 */
export interface SourceState {
  enabled: boolean;
  /** 前回取り込んだうちで一番新しい更新日時 */
  since: string;
  /** 1回の実行で詳細まで取りに行く上限 */
  maxDetails: number;
  lastRunAt: string;
  lastError: string;
}

export const defaultSourceState: SourceState = {
  enabled: false,
  since: "",
  maxDetails: 12,
  lastRunAt: "",
  lastError: "",
};

export interface AgentConfig {
  /** 自律運転を有効にするか */
  enabled: boolean;
  /** 画面を開いたときに自動で回すか */
  runOnOpen: boolean;
  /** 1日に回す最大回数 */
  maxRunsPerDay: number;
  /** 1回の実行で使える生成AIの呼び出し回数の上限 */
  callBudget: number;
  /** 有効な工程 */
  steps: Record<StepId, boolean>;
  /** 1回の実行で下書きを作る案件の最大数 */
  maxDraftsPerRun: number;
  /** 案件を取り込むRSS/AtomのURL */
  feeds: string[];
  /** サイトマップ収集の設定。キーは SOURCES の id。 */
  sources: Record<string, SourceState>;
  /** 上位モデルに市場を探させる（探索層）を使うか */
  discoveryEnabled: boolean;
  /** 学習で更新されるパラメータ */
  learned: LearnedParams;
}

/**
 * 実績から自動調整されるパラメータ。
 * 何をどう変えたかは必ずイベントに残す。
 */
export interface LearnedParams {
  /** これを下回る実効時給の案件は自動で落とす */
  minHourlyJpy: number;
  /** 提案文の狙う文字数 */
  targetProposalChars: number;
  /** 通りやすかった切り口 */
  preferredAngles: string[];
  /** 却下された理由の要約（次の生成で避ける） */
  avoidNotes: string[];
  /** 更新した回数 */
  revision: number;
  updatedAt: string;
}

export const defaultLearned: LearnedParams = {
  minHourlyJpy: 1121,
  targetProposalChars: 500,
  preferredAngles: [],
  avoidNotes: [],
  revision: 0,
  updatedAt: "",
};

export const defaultAgentConfig: AgentConfig = {
  enabled: false,
  runOnOpen: true,
  maxRunsPerDay: 4,
  callBudget: 20,
  steps: { ingest: true, triage: true, listing: true, draft: true, plan: true, review: true, learn: true },
  maxDraftsPerRun: 3,
  feeds: [],
  sources: {},
  discoveryEnabled: false,
  learned: defaultLearned,
};

/** 1回の実行の結果。UI に返す。 */
export interface RunResult {
  run: AgentRun;
  events: AgentEvent[];
  /** この実行で承認待ちに積んだ件数 */
  queued: number;
  /** 取り込んだ案件数 */
  ingested: number;
  /** 判定した案件数 */
  triaged: number;
}
