import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { getHustleDb } from "../db";
import {
  defaultAgentConfig,
  defaultLearned,
  type AgentConfig,
  type AgentEvent,
  type AgentRun,
  type InboxItem,
  type Lead,
  type LearnedParams,
  type SourceState,
  defaultSourceState,
} from "./types";
// 型だけ。discovery.ts はこのファイルの関数を呼ぶので、値を取り込むと循環する。
import type { Discovery, DiscoveryChannel } from "./discovery-core";
import type { DryRun, DryRunStatus, Grade, HumanVerdict } from "./dryrun-core";
import type { PublishedListing, ListingStatus } from "./listing-tracker";
import type { Capability } from "./deliverability";
import { SOURCES } from "./sources";

let initialized = false;

export function getAgentDb(): Database.Database {
  const db = getHustleDb();
  if (initialized) return db;

  db.exec(`
    CREATE TABLE IF NOT EXISTS hustle_agent_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      trigger TEXT NOT NULL DEFAULT 'manual',
      summary TEXT NOT NULL DEFAULT '',
      calls_used INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS hustle_agent_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hustle_leads (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'manual',
      external_id TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      raw_text TEXT NOT NULL,
      budget_jpy INTEGER,
      posted_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      score INTEGER NOT NULL DEFAULT 0,
      verdict TEXT NOT NULL DEFAULT 'unknown',
      triage TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hustle_agent_inbox (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 50,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      action_url TEXT NOT NULL DEFAULT '',
      lead_id TEXT,
      meta TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      decided_at TEXT,
      decision_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hustle_discoveries (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL DEFAULT '',
      key TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'apply',
      title TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      hourly_low INTEGER,
      hourly_high INTEGER,
      meets_bar INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hustle_dryruns (
      id TEXT PRIMARY KEY,
      lead_id TEXT,
      source_url TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      genre TEXT NOT NULL,
      requirement TEXT NOT NULL DEFAULT '',
      deliverable_spec TEXT NOT NULL DEFAULT '',
      artifact TEXT NOT NULL DEFAULT '',
      artifact_path TEXT NOT NULL DEFAULT '',
      method TEXT NOT NULL DEFAULT '',
      blocked_reason TEXT NOT NULL DEFAULT '',
      grade TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hustle_published_listings (
      id TEXT PRIMARY KEY,
      work_type_id TEXT NOT NULL,
      title TEXT NOT NULL,
      platform_id TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      published_at TEXT NOT NULL,
      price_jpy INTEGER NOT NULL DEFAULT 0,
      views INTEGER NOT NULL DEFAULT 0,
      inquiries INTEGER NOT NULL DEFAULT 0,
      orders INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'published',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_events_run ON hustle_agent_events(run_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON hustle_leads(status, score DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_external ON hustle_leads(source, external_id)
      WHERE external_id != '';
    CREATE INDEX IF NOT EXISTS idx_inbox_status ON hustle_agent_inbox(status, priority DESC, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_discoveries_key ON hustle_discoveries(key);
    CREATE INDEX IF NOT EXISTS idx_discoveries_status ON hustle_discoveries(status, meets_bar DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_dryruns_genre ON hustle_dryruns(genre, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_dryruns_status ON hustle_dryruns(status, created_at DESC);
  `);

  // CREATE TABLE IF NOT EXISTS は、すでにあるテーブルに列を足さない。
  // 使い始めたあとで項目が増えたときは、ここで足す。
  ensureColumn(db, "hustle_dryruns", "human_verdict", "TEXT");

  initialized = true;
  return db;
}

/**
 * 無ければ列を足す。あれば何もしない。
 *
 * 保存済みのデータを消さずに項目を増やすため。
 * sqlite の ALTER TABLE ADD COLUMN は既存行に NULL を入れるだけなので安全。
 */
function ensureColumn(db: Database.Database, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

const now = () => new Date().toISOString();
const newId = () => randomUUID();

function parse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// --- 設定 -------------------------------------------------------------------

const CONFIG_KEY = "hustleAgentConfig";

export function readAgentConfig(): AgentConfig {
  const db = getAgentDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(CONFIG_KEY) as
    | { value: string }
    | undefined;
  if (!row) return { ...defaultAgentConfig };

  const stored = parse<Partial<AgentConfig>>(row.value, {});
  return {
    ...defaultAgentConfig,
    ...stored,
    steps: { ...defaultAgentConfig.steps, ...(stored.steps ?? {}) },
    feeds: Array.isArray(stored.feeds) ? stored.feeds : [],
    sources: normalizeSources(stored.sources),
    learned: { ...defaultLearned, ...(stored.learned ?? {}) },
  };
}

/**
 * 保存されている値に欠けがあっても既定で埋める。
 *
 * SOURCES の defaultEnabled は、ここで読むまで**どこからも参照されていなかった**。
 * その結果、入れたばかりの状態では取り込み元が1つも有効にならず、
 * 設定画面で手で入れるまでパイプラインが何も取りに行かなかった。
 * 保存された値が無いソースは defaultEnabled に従う。
 * 保存された値があるなら、そちらを優先する（利用者が切ったものを勝手に戻さない）。
 */
function normalizeSources(stored: unknown): Record<string, SourceState> {
  const out: Record<string, SourceState> = {};
  const saved = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;

  for (const source of SOURCES) {
    if (source.id in saved) continue;
    out[source.id] = { ...defaultSourceState, enabled: source.defaultEnabled };
  }

  for (const [id, value] of Object.entries(saved)) {
    const v = (value ?? {}) as Partial<SourceState>;
    out[id] = {
      enabled: v.enabled === true,
      since: typeof v.since === "string" ? v.since : "",
      maxDetails:
        typeof v.maxDetails === "number" && Number.isFinite(v.maxDetails)
          ? Math.min(50, Math.max(1, Math.round(v.maxDetails)))
          : defaultSourceState.maxDetails,
      lastRunAt: typeof v.lastRunAt === "string" ? v.lastRunAt : "",
      lastError: typeof v.lastError === "string" ? v.lastError : "",
      consecutiveFailures:
        typeof v.consecutiveFailures === "number" && Number.isFinite(v.consecutiveFailures)
          ? Math.max(0, Math.round(v.consecutiveFailures))
          : 0,
    };
  }
  return out;
}

/** ソースはキーごとに部分更新できる。1項目だけ触れるようにするため。 */
export type AgentConfigPatch = Partial<Omit<AgentConfig, "sources">> & {
  sources?: Record<string, Partial<SourceState>>;
};

export function writeAgentConfig(patch: AgentConfigPatch): AgentConfig {
  const db = getAgentDb();
  const current = readAgentConfig();
  const { sources: sourcePatch, steps: stepPatch, ...rest } = patch;
  const merged: AgentConfig = {
    ...current,
    ...rest,
    steps: stepPatch ? { ...current.steps, ...stepPatch } : current.steps,
    // ソースはキーごとに差分更新する。1つ触っただけで他が消えないように。
    sources: sourcePatch ? mergeSources(current.sources, sourcePatch) : current.sources,
  };
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(CONFIG_KEY, JSON.stringify(merged));
  return merged;
}

function mergeSources(
  current: Record<string, SourceState>,
  patch: Record<string, Partial<SourceState>>
): Record<string, SourceState> {
  const out: Record<string, SourceState> = { ...current };
  for (const [id, value] of Object.entries(patch)) {
    out[id] = { ...defaultSourceState, ...(current[id] ?? {}), ...(value ?? {}) };
  }
  return out;
}

export function writeLearned(learned: LearnedParams): void {
  writeAgentConfig({ learned });
}

// --- 実行 -------------------------------------------------------------------

export function createRun(trigger: AgentRun["trigger"]): AgentRun {
  const db = getAgentDb();
  const run: AgentRun = {
    id: newId(),
    startedAt: now(),
    finishedAt: null,
    status: "running",
    trigger,
    summary: "",
    callsUsed: 0,
  };
  db.prepare(
    `INSERT INTO hustle_agent_runs (id, started_at, finished_at, status, trigger, summary, calls_used)
     VALUES (@id, @startedAt, @finishedAt, @status, @trigger, @summary, @callsUsed)`
  ).run(run);
  return run;
}

export function finishRun(id: string, status: AgentRun["status"], summary: string, callsUsed: number): void {
  getAgentDb()
    .prepare(
      "UPDATE hustle_agent_runs SET finished_at = ?, status = ?, summary = ?, calls_used = ? WHERE id = ?"
    )
    .run(now(), status, summary, callsUsed, id);
}

type RunRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  trigger: string;
  summary: string;
  calls_used: number;
};

const toRun = (r: RunRow): AgentRun => ({
  id: r.id,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  status: r.status as AgentRun["status"],
  trigger: r.trigger as AgentRun["trigger"],
  summary: r.summary,
  callsUsed: r.calls_used,
});

export function readRuns(limit = 20): AgentRun[] {
  return (
    getAgentDb()
      .prepare("SELECT * FROM hustle_agent_runs ORDER BY started_at DESC LIMIT ?")
      .all(limit) as RunRow[]
  ).map(toRun);
}

/**
 * 今日の始まりと終わりを、UTC の ISO 文字列で返す。
 *
 * started_at は `new Date().toISOString()`（UTC）で入る。
 * 一方「今日」は使う人の時計で決まる。日本時間の朝9時は前日の UTC なので、
 * ローカルの年月日をそのまま前方一致に使うと、朝のうちに回した分が
 * 「今日」に数えられず、1日の上限がすり抜けていた。
 * ローカルの1日を UTC の範囲に変換してから数える。
 */
export function localDayRangeUtc(at: Date = new Date()): { from: string; to: string } {
  const start = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const end = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** 今日すでに何回回したか。1日の上限を守るために使う。 */
export function countRunsToday(at: Date = new Date()): number {
  const { from, to } = localDayRangeUtc(at);
  const row = getAgentDb()
    .prepare("SELECT COUNT(*) AS n FROM hustle_agent_runs WHERE started_at >= ? AND started_at < ?")
    .get(from, to) as { n: number };
  return row.n;
}

/** 実行中のまま放置された run を掃除する（プロセスが落ちた場合など）。 */
export function reapStaleRuns(maxMinutes = 15): number {
  const cutoff = new Date(Date.now() - maxMinutes * 60_000).toISOString();
  const res = getAgentDb()
    .prepare(
      "UPDATE hustle_agent_runs SET status = 'failed', finished_at = ?, summary = '途中で停止しました' WHERE status = 'running' AND started_at < ?"
    )
    .run(now(), cutoff);
  return res.changes;
}

export function hasRunningRun(): boolean {
  const row = getAgentDb()
    .prepare("SELECT COUNT(*) AS n FROM hustle_agent_runs WHERE status = 'running'")
    .get() as { n: number };
  return row.n > 0;
}

// --- イベント ---------------------------------------------------------------

export function logEvent(
  runId: string,
  step: AgentEvent["step"],
  level: AgentEvent["level"],
  message: string,
  data: Record<string, unknown> = {}
): AgentEvent {
  const event: AgentEvent = { id: newId(), runId, step, level, message, data, createdAt: now() };
  getAgentDb()
    .prepare(
      `INSERT INTO hustle_agent_events (id, run_id, step, level, message, data, created_at)
       VALUES (@id, @runId, @step, @level, @message, @dataJson, @createdAt)`
    )
    .run({ ...event, dataJson: JSON.stringify(data) });
  return event;
}

type EventRow = {
  id: string;
  run_id: string;
  step: string;
  level: string;
  message: string;
  data: string;
  created_at: string;
};

const toEvent = (r: EventRow): AgentEvent => ({
  id: r.id,
  runId: r.run_id,
  step: r.step as AgentEvent["step"],
  level: r.level as AgentEvent["level"],
  message: r.message,
  data: parse<Record<string, unknown>>(r.data, {}),
  createdAt: r.created_at,
});

export function readEvents(runId?: string, limit = 200): AgentEvent[] {
  const db = getAgentDb();
  const rows = runId
    ? (db
        .prepare("SELECT * FROM hustle_agent_events WHERE run_id = ? ORDER BY created_at ASC LIMIT ?")
        .all(runId, limit) as EventRow[])
    : (db
        .prepare("SELECT * FROM hustle_agent_events ORDER BY created_at DESC LIMIT ?")
        .all(limit) as EventRow[]);
  return rows.map(toEvent);
}

// --- 案件 -------------------------------------------------------------------

type LeadRow = {
  id: string;
  source: string;
  external_id: string;
  url: string;
  title: string;
  raw_text: string;
  budget_jpy: number | null;
  posted_at: string;
  status: string;
  score: number;
  verdict: string;
  triage: string;
  created_at: string;
  updated_at: string;
};

const toLead = (r: LeadRow): Lead => ({
  id: r.id,
  source: r.source as Lead["source"],
  externalId: r.external_id,
  url: r.url,
  title: r.title,
  rawText: r.raw_text,
  budgetJpy: r.budget_jpy,
  postedAt: r.posted_at,
  status: r.status as Lead["status"],
  score: r.score,
  verdict: r.verdict as Lead["verdict"],
  triage: parse<Record<string, unknown>>(r.triage, {}),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** 取り込み。同じ source + externalId が既にあれば false を返して何もしない。 */
/**
 * すでに取り込んだ externalId の集合。
 * サイトマップの lastmod が日付までしか無いと、同じ日の案件を
 * 「前回より後」だけで絞れない。取り込み済みかどうかで弾くのが確実。
 */
export function readKnownExternalIds(source: Lead["source"]): Set<string> {
  const rows = getAgentDb()
    .prepare("SELECT external_id FROM hustle_leads WHERE source = ? AND external_id != ''")
    .all(source) as { external_id: string }[];
  return new Set(rows.map((r) => r.external_id));
}

export function insertLead(input: Partial<Lead> & { rawText: string }): { lead: Lead; created: boolean } {
  const db = getAgentDb();
  const externalId = input.externalId ?? "";

  if (externalId) {
    const existing = db
      .prepare("SELECT * FROM hustle_leads WHERE source = ? AND external_id = ?")
      .get(input.source ?? "manual", externalId) as LeadRow | undefined;
    if (existing) return { lead: toLead(existing), created: false };
  }

  const lead: Lead = {
    id: input.id ?? newId(),
    source: input.source ?? "manual",
    externalId,
    url: input.url ?? "",
    title: input.title ?? input.rawText.slice(0, 60).replace(/\s+/g, " "),
    rawText: input.rawText,
    budgetJpy: input.budgetJpy ?? null,
    postedAt: input.postedAt ?? now(),
    status: input.status ?? "new",
    score: input.score ?? 0,
    verdict: input.verdict ?? "unknown",
    triage: input.triage ?? {},
    createdAt: input.createdAt ?? now(),
    updatedAt: now(),
  };

  db.prepare(
    `INSERT INTO hustle_leads
       (id, source, external_id, url, title, raw_text, budget_jpy, posted_at, status, score, verdict, triage, created_at, updated_at)
     VALUES (@id, @source, @externalId, @url, @title, @rawText, @budgetJpy, @postedAt, @status, @score, @verdict, @triageJson, @createdAt, @updatedAt)`
  ).run({ ...lead, triageJson: JSON.stringify(lead.triage) });

  return { lead, created: true };
}

export function updateLead(id: string, patch: Partial<Lead>): Lead | null {
  const db = getAgentDb();
  const row = db.prepare("SELECT * FROM hustle_leads WHERE id = ?").get(id) as LeadRow | undefined;
  if (!row) return null;
  const merged = { ...toLead(row), ...patch, id, updatedAt: now() };
  db.prepare(
    `UPDATE hustle_leads SET status = @status, score = @score, verdict = @verdict,
       triage = @triageJson, title = @title, budget_jpy = @budgetJpy, updated_at = @updatedAt
     WHERE id = @id`
  ).run({ ...merged, triageJson: JSON.stringify(merged.triage) });
  return merged;
}

export function readLeads(status?: Lead["status"], limit = 100): Lead[] {
  const db = getAgentDb();
  const rows = status
    ? (db
        .prepare("SELECT * FROM hustle_leads WHERE status = ? ORDER BY score DESC, created_at DESC LIMIT ?")
        .all(status, limit) as LeadRow[])
    : (db
        .prepare("SELECT * FROM hustle_leads ORDER BY created_at DESC LIMIT ?")
        .all(limit) as LeadRow[]);
  return rows.map(toLead);
}

/**
 * id を指定して案件を引く。
 *
 * 上位モデルの判定を書き戻すときに、新しい順300件を読んでから
 * その中を探していた。エスカレーションは時間のかかる経路なので、
 * 返ってくる頃には300件を超えていることがあり、
 * せっかく出した判定が「見つかりません」で捨てられていた。
 */
export function readLeadsByIds(ids: string[]): Map<string, Lead> {
  const out = new Map<string, Lead>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return out;

  const db = getAgentDb();
  // SQLite の変数の上限（既定999）に収まるように分ける
  for (let i = 0; i < unique.length; i += 400) {
    const chunk = unique.slice(i, i + 400);
    const rows = db
      .prepare(`SELECT * FROM hustle_leads WHERE id IN (${chunk.map(() => "?").join(",")})`)
      .all(...chunk) as LeadRow[];
    for (const row of rows) {
      const lead = toLead(row);
      out.set(lead.id, lead);
    }
  }
  return out;
}

// --- 承認キュー -------------------------------------------------------------

type InboxRow = {
  id: string;
  run_id: string;
  kind: string;
  priority: number;
  title: string;
  body: string;
  action_url: string;
  lead_id: string | null;
  meta: string;
  status: string;
  decided_at: string | null;
  decision_note: string;
  created_at: string;
};

const toInbox = (r: InboxRow): InboxItem => ({
  id: r.id,
  runId: r.run_id,
  kind: r.kind as InboxItem["kind"],
  priority: r.priority,
  title: r.title,
  body: r.body,
  actionUrl: r.action_url,
  leadId: r.lead_id,
  meta: parse<Record<string, unknown>>(r.meta, {}),
  status: r.status as InboxItem["status"],
  decidedAt: r.decided_at,
  decisionNote: r.decision_note,
  createdAt: r.created_at,
});

export function pushInbox(input: Partial<InboxItem> & { kind: InboxItem["kind"]; title: string }): InboxItem {
  const db = getAgentDb();
  const item: InboxItem = {
    id: input.id ?? newId(),
    runId: input.runId ?? "",
    kind: input.kind,
    priority: input.priority ?? 50,
    title: input.title,
    body: input.body ?? "",
    actionUrl: input.actionUrl ?? "",
    leadId: input.leadId ?? null,
    meta: input.meta ?? {},
    status: input.status ?? "pending",
    decidedAt: input.decidedAt ?? null,
    decisionNote: input.decisionNote ?? "",
    createdAt: input.createdAt ?? now(),
  };
  db.prepare(
    `INSERT INTO hustle_agent_inbox
       (id, run_id, kind, priority, title, body, action_url, lead_id, meta, status, decided_at, decision_note, created_at)
     VALUES (@id, @runId, @kind, @priority, @title, @body, @actionUrl, @leadId, @metaJson, @status, @decidedAt, @decisionNote, @createdAt)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status, decided_at = excluded.decided_at,
       decision_note = excluded.decision_note, body = excluded.body, meta = excluded.meta`
  ).run({ ...item, metaJson: JSON.stringify(item.meta) });
  return item;
}

export function readInbox(status?: InboxItem["status"], limit = 100): InboxItem[] {
  const db = getAgentDb();
  const rows = status
    ? (db
        .prepare(
          "SELECT * FROM hustle_agent_inbox WHERE status = ? ORDER BY priority DESC, created_at DESC LIMIT ?"
        )
        .all(status, limit) as InboxRow[])
    : (db
        .prepare("SELECT * FROM hustle_agent_inbox ORDER BY created_at DESC LIMIT ?")
        .all(limit) as InboxRow[]);
  return rows.map(toInbox);
}

/**
 * 1件だけ読む。
 *
 * 以前は readInbox()（既定100件）から find していたので、
 * 承認待ちが100件を超えると古いものが 404 になり、
 * 承認も却下もできないまま溜まり続けていた。
 */
export function readInboxItem(id: string): InboxItem | null {
  const row = getAgentDb()
    .prepare("SELECT * FROM hustle_agent_inbox WHERE id = ?")
    .get(id) as InboxRow | undefined;
  return row ? toInbox(row) : null;
}

/** 未処理が何件あるか（一覧の上限で隠れているぶんも含む）。 */
export function countInbox(status?: InboxItem["status"]): number {
  const db = getAgentDb();
  const row = (
    status
      ? db.prepare("SELECT COUNT(*) AS n FROM hustle_agent_inbox WHERE status = ?").get(status)
      : db.prepare("SELECT COUNT(*) AS n FROM hustle_agent_inbox").get()
  ) as { n: number };
  return row.n;
}

export function decideInbox(
  id: string,
  status: InboxItem["status"],
  note: string
): InboxItem | null {
  const db = getAgentDb();
  const row = db.prepare("SELECT * FROM hustle_agent_inbox WHERE id = ?").get(id) as InboxRow | undefined;
  if (!row) return null;
  db.prepare(
    "UPDATE hustle_agent_inbox SET status = ?, decided_at = ?, decision_note = ? WHERE id = ?"
  ).run(status, now(), note, id);
  return { ...toInbox(row), status, decidedAt: now(), decisionNote: note };
}

export function updateInboxBody(id: string, body: string): void {
  getAgentDb().prepare("UPDATE hustle_agent_inbox SET body = ? WHERE id = ?").run(body, id);
}


// --- 探索の結果 -------------------------------------------------------------

interface DiscoveryRow {
  id: string;
  run_id: string;
  key: string;
  channel: string;
  title: string;
  url: string;
  payload: string;
  hourly_low: number | null;
  hourly_high: number | null;
  meets_bar: number;
  note: string;
  status: string;
  created_at: string;
}

function toDiscovery(row: DiscoveryRow): Discovery {
  const payload = parse<Record<string, unknown>>(row.payload, {});
  return {
    ...(payload as unknown as Discovery),
    id: row.id,
    runId: row.run_id,
    key: row.key,
    channel: row.channel as DiscoveryChannel,
    title: row.title,
    url: row.url,
    hourlyJpy:
      row.hourly_low === null || row.hourly_high === null
        ? null
        : { low: row.hourly_low, high: row.hourly_high },
    meetsBar: row.meets_bar === 1,
    note: row.note,
    status: row.status as Discovery["status"],
    createdAt: row.created_at,
  };
}

/**
 * 見つけた市場を保存する。
 * 同じ key が既にあれば上書きせず、見つけた回数だけ増やす扱いにする
 * （人が status を変えた結果を、次の探索で消さないため）。
 */
export function insertDiscovery(d: Omit<Discovery, "id" | "createdAt" | "status">): {
  discovery: Discovery;
  created: boolean;
} {
  const db = getAgentDb();
  const existing = db.prepare("SELECT * FROM hustle_discoveries WHERE key = ?").get(d.key) as
    | DiscoveryRow
    | undefined;
  if (existing) return { discovery: toDiscovery(existing), created: false };

  const row: DiscoveryRow = {
    id: newId(),
    run_id: d.runId,
    key: d.key,
    channel: d.channel,
    title: d.title,
    url: d.url,
    payload: JSON.stringify(d),
    hourly_low: d.hourlyJpy?.low ?? null,
    hourly_high: d.hourlyJpy?.high ?? null,
    meets_bar: d.meetsBar ? 1 : 0,
    note: d.note,
    status: "new",
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO hustle_discoveries
       (id, run_id, key, channel, title, url, payload, hourly_low, hourly_high, meets_bar, note, status, created_at)
     VALUES (@id, @run_id, @key, @channel, @title, @url, @payload, @hourly_low, @hourly_high, @meets_bar, @note, @status, @created_at)`
  ).run(row);
  return { discovery: toDiscovery(row), created: true };
}

export function readDiscoveries(limit = 50): Discovery[] {
  const rows = getAgentDb()
    .prepare(
      `SELECT * FROM hustle_discoveries
       WHERE status != 'dropped'
       ORDER BY meets_bar DESC, created_at DESC
       LIMIT ?`
    )
    .all(limit) as DiscoveryRow[];
  return rows.map(toDiscovery);
}

/** 重複探索を避けるために、すでに見た市場の key を返す。 */
export function readDiscoveryKeys(limit = 200): string[] {
  const rows = getAgentDb()
    .prepare("SELECT key FROM hustle_discoveries ORDER BY created_at DESC LIMIT ?")
    .all(limit) as { key: string }[];
  return rows.map((r) => r.key);
}

export function setDiscoveryStatus(id: string, status: Discovery["status"]): Discovery | null {
  const db = getAgentDb();
  db.prepare("UPDATE hustle_discoveries SET status = ? WHERE id = ?").run(status, id);
  const row = db.prepare("SELECT * FROM hustle_discoveries WHERE id = ?").get(id) as
    | DiscoveryRow
    | undefined;
  return row ? toDiscovery(row) : null;
}


// --- 試作 -------------------------------------------------------------------

interface DryRunRow {
  id: string;
  lead_id: string | null;
  source_url: string;
  title: string;
  genre: string;
  requirement: string;
  deliverable_spec: string;
  artifact: string;
  artifact_path: string;
  method: string;
  blocked_reason: string;
  grade: string | null;
  human_verdict: string | null;
  status: string;
  created_at: string;
}

const toDryRun = (r: DryRunRow): DryRun => ({
  id: r.id,
  leadId: r.lead_id,
  sourceUrl: r.source_url,
  title: r.title,
  genre: r.genre as Capability,
  requirement: r.requirement,
  deliverableSpec: r.deliverable_spec,
  artifact: r.artifact,
  artifactPath: r.artifact_path,
  method: r.method,
  blockedReason: r.blocked_reason,
  grade: r.grade ? parse<Grade | null>(r.grade, null) : null,
  humanVerdict: r.human_verdict ? parse<HumanVerdict | null>(r.human_verdict, null) : null,
  status: r.status as DryRunStatus,
  createdAt: r.created_at,
});

export function insertDryRun(
  input: Omit<
    DryRun,
    | "id"
    | "createdAt"
    | "status"
    | "grade"
    | "humanVerdict"
    | "artifact"
    | "artifactPath"
    | "method"
    | "blockedReason"
  >
): DryRun {
  const db = getAgentDb();
  const row: DryRunRow = {
    id: newId(),
    human_verdict: null,
    lead_id: input.leadId,
    source_url: input.sourceUrl,
    title: input.title,
    genre: input.genre,
    requirement: input.requirement,
    deliverable_spec: input.deliverableSpec,
    artifact: "",
    artifact_path: "",
    method: "",
    blocked_reason: "",
    grade: null,
    status: "pending",
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO hustle_dryruns
       (id, lead_id, source_url, title, genre, requirement, deliverable_spec,
        artifact, artifact_path, method, blocked_reason, grade, status, created_at)
     VALUES (@id, @lead_id, @source_url, @title, @genre, @requirement, @deliverable_spec,
        @artifact, @artifact_path, @method, @blocked_reason, @grade, @status, @created_at)`
  ).run(row);
  return toDryRun(row);
}

/**
 * 人が現物を見て下した判断を保存する。
 *
 * AIの採点を上書きするのではなく、別に持つ。
 * どちらも残しておけば「採点は通したのに人は落とした」が後から追える。
 */
export function saveHumanVerdict(
  id: string,
  verdict: HumanVerdict["verdict"],
  note: string
): DryRun | null {
  const db = getAgentDb();
  const value: HumanVerdict = { verdict, note, decidedAt: now() };
  db.prepare("UPDATE hustle_dryruns SET human_verdict = ? WHERE id = ?").run(
    JSON.stringify(value),
    id
  );
  const row = db.prepare("SELECT * FROM hustle_dryruns WHERE id = ?").get(id) as
    | DryRunRow
    | undefined;
  return row ? toDryRun(row) : null;
}

export function readDryRuns(status?: DryRunStatus, limit = 100): DryRun[] {
  const db = getAgentDb();
  const rows = (
    status
      ? db.prepare("SELECT * FROM hustle_dryruns WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(status, limit)
      : db.prepare("SELECT * FROM hustle_dryruns ORDER BY created_at DESC LIMIT ?").all(limit)
  ) as DryRunRow[];
  return rows.map(toDryRun);
}

export function readDryRun(id: string): DryRun | null {
  const row = getAgentDb().prepare("SELECT * FROM hustle_dryruns WHERE id = ?").get(id) as DryRunRow | undefined;
  return row ? toDryRun(row) : null;
}

/** すでに試作したジャンル（同じジャンルを何度も試さないため）。 */
export function readTestedGenres(): Set<string> {
  const rows = getAgentDb()
    .prepare("SELECT DISTINCT genre FROM hustle_dryruns WHERE status != 'pending'")
    .all() as { genre: string }[];
  return new Set(rows.map((r) => r.genre));
}

export function saveArtifact(
  id: string,
  fields: { artifact: string; method: string; blockedReason: string; artifactPath?: string }
): DryRun | null {
  getAgentDb()
    .prepare(
      `UPDATE hustle_dryruns
       SET artifact = ?, method = ?, blocked_reason = ?, artifact_path = ?, status = ?
       WHERE id = ?`
    )
    .run(
      fields.artifact,
      fields.method,
      fields.blockedReason,
      fields.artifactPath ?? "",
      fields.blockedReason && !fields.artifact ? "skipped" : "produced",
      id
    );
  return readDryRun(id);
}

export function saveGrade(id: string, grade: Grade): DryRun | null {
  getAgentDb()
    .prepare("UPDATE hustle_dryruns SET grade = ?, status = 'graded' WHERE id = ?")
    .run(JSON.stringify(grade), id);
  return readDryRun(id);
}


// --- 出品した後の追跡 -------------------------------------------------------

interface ListingRow {
  id: string;
  work_type_id: string;
  title: string;
  platform_id: string;
  url: string;
  published_at: string;
  price_jpy: number;
  views: number;
  inquiries: number;
  orders: number;
  last_checked_at: string;
  status: string;
  created_at: string;
}

const toListing = (r: ListingRow): PublishedListing => ({
  id: r.id,
  workTypeId: r.work_type_id,
  title: r.title,
  platformId: r.platform_id,
  url: r.url,
  publishedAt: r.published_at,
  priceJpy: r.price_jpy,
  views: r.views,
  inquiries: r.inquiries,
  orders: r.orders,
  lastCheckedAt: r.last_checked_at,
  status: r.status as ListingStatus,
  createdAt: r.created_at,
});

export function upsertPublishedListing(
  input: Partial<PublishedListing> & { workTypeId: string; title: string; publishedAt: string }
): PublishedListing {
  const db = getAgentDb();
  const id = input.id ?? newId();
  const existing = db.prepare("SELECT * FROM hustle_published_listings WHERE id = ?").get(id) as
    | ListingRow
    | undefined;

  const row: ListingRow = {
    id,
    work_type_id: input.workTypeId,
    title: input.title,
    platform_id: input.platformId ?? existing?.platform_id ?? "",
    url: input.url ?? existing?.url ?? "",
    published_at: input.publishedAt,
    price_jpy: input.priceJpy ?? existing?.price_jpy ?? 0,
    views: input.views ?? existing?.views ?? 0,
    inquiries: input.inquiries ?? existing?.inquiries ?? 0,
    orders: input.orders ?? existing?.orders ?? 0,
    last_checked_at: input.lastCheckedAt ?? now(),
    status: input.status ?? (existing?.status as ListingStatus) ?? "published",
    created_at: existing?.created_at ?? now(),
  };

  db.prepare(
    `INSERT INTO hustle_published_listings
       (id, work_type_id, title, platform_id, url, published_at, price_jpy,
        views, inquiries, orders, last_checked_at, status, created_at)
     VALUES (@id, @work_type_id, @title, @platform_id, @url, @published_at, @price_jpy,
        @views, @inquiries, @orders, @last_checked_at, @status, @created_at)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, platform_id = excluded.platform_id, url = excluded.url,
       published_at = excluded.published_at, price_jpy = excluded.price_jpy,
       views = excluded.views, inquiries = excluded.inquiries, orders = excluded.orders,
       last_checked_at = excluded.last_checked_at, status = excluded.status`
  ).run(row);

  return toListing(row);
}

/**
 * id で1件引く。
 * 一覧（上限あり）から find すると、件数が増えたときに古いものが
 * 見つからなくなる。承認キューと案件で同じ間違いをしていた。
 */
export function readPublishedListing(id: string): PublishedListing | null {
  const row = getAgentDb()
    .prepare("SELECT * FROM hustle_published_listings WHERE id = ?")
    .get(id) as ListingRow | undefined;
  return row ? toListing(row) : null;
}

export function readPublishedListings(limit = 100): PublishedListing[] {
  const rows = getAgentDb()
    .prepare(
      "SELECT * FROM hustle_published_listings WHERE status != 'closed' ORDER BY published_at DESC LIMIT ?"
    )
    .all(limit) as ListingRow[];
  return rows.map(toListing);
}
