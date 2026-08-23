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
} from "./types";

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

    CREATE INDEX IF NOT EXISTS idx_agent_events_run ON hustle_agent_events(run_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON hustle_leads(status, score DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_external ON hustle_leads(source, external_id)
      WHERE external_id != '';
    CREATE INDEX IF NOT EXISTS idx_inbox_status ON hustle_agent_inbox(status, priority DESC, created_at DESC);
  `);

  initialized = true;
  return db;
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
    learned: { ...defaultLearned, ...(stored.learned ?? {}) },
  };
}

export function writeAgentConfig(patch: Partial<AgentConfig>): AgentConfig {
  const db = getAgentDb();
  const merged: AgentConfig = {
    ...readAgentConfig(),
    ...patch,
    ...(patch.steps ? { steps: { ...readAgentConfig().steps, ...patch.steps } } : {}),
  };
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(CONFIG_KEY, JSON.stringify(merged));
  return merged;
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

/** 今日すでに何回回したか。1日の上限を守るために使う。 */
export function countRunsToday(): number {
  const d = new Date();
  const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const row = getAgentDb()
    .prepare("SELECT COUNT(*) AS n FROM hustle_agent_runs WHERE started_at LIKE ? || '%'")
    .get(prefix) as { n: number };
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
