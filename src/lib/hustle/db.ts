import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import type {
  HustleAsset,
  HustleEntry,
  HustlePath,
  HustleProfile,
  HustleTask,
  ScamCheck,
  ScamSignalHit,
} from "./types";

let initialized = false;

/** 副業パイプライン用テーブルを（初回のみ）用意して DB を返す。 */
export function getHustleDb(): Database.Database {
  const db = getDb();
  if (initialized) return db;

  db.exec(`
    CREATE TABLE IF NOT EXISTS hustle_profile (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hustle_paths (
      id TEXT PRIMARY KEY,
      path_key TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'considering',
      target_jpy INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hustle_tasks (
      id TEXT PRIMARY KEY,
      path_id TEXT,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'produce',
      status TEXT NOT NULL DEFAULT 'todo',
      due_date TEXT NOT NULL DEFAULT '',
      est_minutes INTEGER NOT NULL DEFAULT 30,
      actual_minutes INTEGER NOT NULL DEFAULT 0,
      order_index INTEGER NOT NULL DEFAULT 0,
      done_at TEXT,
      created_at TEXT NOT NULL,
      template TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (path_id) REFERENCES hustle_paths(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS hustle_entries (
      id TEXT PRIMARY KEY,
      path_id TEXT,
      date TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount_jpy INTEGER NOT NULL DEFAULT 0,
      minutes INTEGER NOT NULL DEFAULT 0,
      memo TEXT NOT NULL DEFAULT '',
      settled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (path_id) REFERENCES hustle_paths(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS hustle_assets (
      id TEXT PRIMARY KEY,
      path_id TEXT,
      kind TEXT NOT NULL DEFAULT 'other',
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      meta TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      FOREIGN KEY (path_id) REFERENCES hustle_paths(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS hustle_scam_checks (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      verdict TEXT NOT NULL DEFAULT 'safe',
      signals TEXT NOT NULL DEFAULT '[]',
      advice TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_hustle_tasks_due ON hustle_tasks(due_date, status);
    CREATE INDEX IF NOT EXISTS idx_hustle_entries_date ON hustle_entries(date);
    CREATE INDEX IF NOT EXISTS idx_hustle_entries_path ON hustle_entries(path_id);
    CREATE INDEX IF NOT EXISTS idx_hustle_assets_path ON hustle_assets(path_id, created_at);
  `);

  // 既にテーブルがある環境向けの追加カラム。存在すれば失敗するので握りつぶす。
  const taskColumns = db.prepare("PRAGMA table_info(hustle_tasks)").all() as { name: string }[];
  if (!taskColumns.some((c) => c.name === "template")) {
    db.exec("ALTER TABLE hustle_tasks ADD COLUMN template TEXT NOT NULL DEFAULT ''");
  }

  initialized = true;
  return db;
}

// --- row <-> domain mapping ------------------------------------------------

type PathRow = {
  id: string;
  path_key: string;
  name: string;
  status: string;
  target_jpy: number;
  notes: string;
  started_at: string;
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  id: string;
  path_id: string | null;
  title: string;
  detail: string;
  kind: string;
  status: string;
  due_date: string;
  est_minutes: number;
  actual_minutes: number;
  order_index: number;
  done_at: string | null;
  created_at: string;
  template: string;
};

type EntryRow = {
  id: string;
  path_id: string | null;
  date: string;
  kind: string;
  amount_jpy: number;
  minutes: number;
  memo: string;
  settled: number;
  created_at: string;
};

type AssetRow = {
  id: string;
  path_id: string | null;
  kind: string;
  title: string;
  body: string;
  meta: string;
  status: string;
  created_at: string;
};

type ScamRow = {
  id: string;
  source: string;
  text: string;
  score: number;
  verdict: string;
  signals: string;
  advice: string;
  created_at: string;
};

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const rowToPath = (r: PathRow): HustlePath => ({
  id: r.id,
  pathKey: r.path_key as HustlePath["pathKey"],
  name: r.name,
  status: r.status as HustlePath["status"],
  targetJpy: r.target_jpy,
  notes: r.notes,
  startedAt: r.started_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const rowToTask = (r: TaskRow): HustleTask => ({
  id: r.id,
  pathId: r.path_id,
  title: r.title,
  detail: r.detail,
  kind: r.kind as HustleTask["kind"],
  status: r.status as HustleTask["status"],
  dueDate: r.due_date,
  estMinutes: r.est_minutes,
  actualMinutes: r.actual_minutes,
  orderIndex: r.order_index,
  doneAt: r.done_at,
  createdAt: r.created_at,
  template: r.template ?? "",
});

export const rowToEntry = (r: EntryRow): HustleEntry => ({
  id: r.id,
  pathId: r.path_id,
  date: r.date,
  kind: r.kind as HustleEntry["kind"],
  amountJpy: r.amount_jpy,
  minutes: r.minutes,
  memo: r.memo,
  settled: r.settled === 1,
  createdAt: r.created_at,
});

export const rowToAsset = (r: AssetRow): HustleAsset => ({
  id: r.id,
  pathId: r.path_id,
  kind: r.kind as HustleAsset["kind"],
  title: r.title,
  body: r.body,
  meta: parseJson<Record<string, unknown>>(r.meta, {}),
  status: r.status as HustleAsset["status"],
  createdAt: r.created_at,
});

export const rowToScamCheck = (r: ScamRow): ScamCheck => ({
  id: r.id,
  source: r.source,
  text: r.text,
  score: r.score,
  verdict: r.verdict as ScamCheck["verdict"],
  signals: parseJson<ScamSignalHit[]>(r.signals, []),
  advice: r.advice,
  createdAt: r.created_at,
});

// --- reads -----------------------------------------------------------------

export function readProfile(): HustleProfile | null {
  const db = getHustleDb();
  const row = db.prepare("SELECT data FROM hustle_profile WHERE id = 'me'").get() as
    | { data: string }
    | undefined;
  if (!row) return null;
  return parseJson<HustleProfile | null>(row.data, null);
}

export function readPaths(): HustlePath[] {
  const db = getHustleDb();
  return (
    db.prepare("SELECT * FROM hustle_paths ORDER BY created_at ASC").all() as PathRow[]
  ).map(rowToPath);
}

export function readTasks(): HustleTask[] {
  const db = getHustleDb();
  return (
    db
      .prepare("SELECT * FROM hustle_tasks ORDER BY due_date ASC, order_index ASC, created_at ASC")
      .all() as TaskRow[]
  ).map(rowToTask);
}

export function readEntries(): HustleEntry[] {
  const db = getHustleDb();
  return (
    db.prepare("SELECT * FROM hustle_entries ORDER BY date DESC, created_at DESC").all() as EntryRow[]
  ).map(rowToEntry);
}

export function readAssets(): HustleAsset[] {
  const db = getHustleDb();
  return (
    db.prepare("SELECT * FROM hustle_assets ORDER BY created_at DESC").all() as AssetRow[]
  ).map(rowToAsset);
}

export function readScamChecks(limit = 50): ScamCheck[] {
  const db = getHustleDb();
  return (
    db
      .prepare("SELECT * FROM hustle_scam_checks ORDER BY created_at DESC LIMIT ?")
      .all(limit) as ScamRow[]
  ).map(rowToScamCheck);
}
