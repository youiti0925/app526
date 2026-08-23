import { randomUUID } from "crypto";
import {
  getHustleDb,
  readAssets,
  readEntries,
  readPaths,
  readProfile,
  readScamChecks,
  readTasks,
} from "./db";
import type {
  HustleAsset,
  HustleBackup,
  HustleEntry,
  HustlePath,
  HustleProfile,
  HustleTask,
  ScamCheck,
} from "./types";

const now = () => new Date().toISOString();
const newId = () => randomUUID();

// --- profile ---------------------------------------------------------------

export function saveProfile(profile: HustleProfile): HustleProfile {
  const db = getHustleDb();
  const stamped = { ...profile, updatedAt: now() };
  db.prepare(
    `INSERT INTO hustle_profile (id, data, updated_at) VALUES ('me', ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).run(JSON.stringify(stamped), stamped.updatedAt);
  return stamped;
}

// --- paths -----------------------------------------------------------------

export function createPath(input: Partial<HustlePath> & { pathKey: HustlePath["pathKey"]; name: string }): HustlePath {
  const db = getHustleDb();
  const path: HustlePath = {
    id: input.id ?? newId(),
    pathKey: input.pathKey,
    name: input.name,
    status: input.status ?? "active",
    targetJpy: input.targetJpy ?? 0,
    notes: input.notes ?? "",
    startedAt: input.startedAt ?? now().slice(0, 10),
    createdAt: input.createdAt ?? now(),
    updatedAt: now(),
  };
  db.prepare(
    `INSERT INTO hustle_paths (id, path_key, name, status, target_jpy, notes, started_at, created_at, updated_at)
     VALUES (@id, @pathKey, @name, @status, @targetJpy, @notes, @startedAt, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       path_key = excluded.path_key, name = excluded.name, status = excluded.status,
       target_jpy = excluded.target_jpy, notes = excluded.notes, started_at = excluded.started_at,
       updated_at = excluded.updated_at`
  ).run(path);
  return path;
}

export function updatePath(id: string, patch: Partial<HustlePath>): HustlePath | null {
  const existing = readPaths().find((p) => p.id === id);
  if (!existing) return null;
  return createPath({ ...existing, ...patch, id });
}

export function deletePath(id: string): boolean {
  const db = getHustleDb();
  const res = db.prepare("DELETE FROM hustle_paths WHERE id = ?").run(id);
  return res.changes > 0;
}

// --- tasks -----------------------------------------------------------------

export function upsertTask(input: Partial<HustleTask> & { title: string }): HustleTask {
  const db = getHustleDb();
  const task: HustleTask = {
    id: input.id ?? newId(),
    pathId: input.pathId ?? null,
    title: input.title,
    detail: input.detail ?? "",
    kind: input.kind ?? "produce",
    status: input.status ?? "todo",
    dueDate: input.dueDate ?? "",
    estMinutes: input.estMinutes ?? 30,
    actualMinutes: input.actualMinutes ?? 0,
    orderIndex: input.orderIndex ?? 0,
    doneAt: input.status === "done" ? input.doneAt ?? now() : input.doneAt ?? null,
    createdAt: input.createdAt ?? now(),
    template: input.template ?? "",
  };
  db.prepare(
    `INSERT INTO hustle_tasks
       (id, path_id, title, detail, kind, status, due_date, est_minutes, actual_minutes, order_index, done_at, created_at, template)
     VALUES (@id, @pathId, @title, @detail, @kind, @status, @dueDate, @estMinutes, @actualMinutes, @orderIndex, @doneAt, @createdAt, @template)
     ON CONFLICT(id) DO UPDATE SET
       path_id = excluded.path_id, title = excluded.title, detail = excluded.detail,
       kind = excluded.kind, status = excluded.status, due_date = excluded.due_date,
       est_minutes = excluded.est_minutes, actual_minutes = excluded.actual_minutes,
       order_index = excluded.order_index, done_at = excluded.done_at,
       template = excluded.template`
  ).run(task);
  return task;
}

export function insertTasks(tasks: (Partial<HustleTask> & { title: string })[]): HustleTask[] {
  const db = getHustleDb();
  const out: HustleTask[] = [];
  const tx = db.transaction(() => {
    for (const t of tasks) out.push(upsertTask(t));
  });
  tx();
  return out;
}

export function deleteTask(id: string): boolean {
  const db = getHustleDb();
  return db.prepare("DELETE FROM hustle_tasks WHERE id = ?").run(id).changes > 0;
}

// --- entries ---------------------------------------------------------------

export function upsertEntry(input: Partial<HustleEntry> & { kind: HustleEntry["kind"] }): HustleEntry {
  const db = getHustleDb();
  const entry: HustleEntry = {
    id: input.id ?? newId(),
    pathId: input.pathId ?? null,
    date: input.date ?? now().slice(0, 10),
    kind: input.kind,
    amountJpy: Math.round(input.amountJpy ?? 0),
    minutes: Math.round(input.minutes ?? 0),
    memo: input.memo ?? "",
    settled: input.settled ?? true,
    createdAt: input.createdAt ?? now(),
  };
  db.prepare(
    `INSERT INTO hustle_entries (id, path_id, date, kind, amount_jpy, minutes, memo, settled, created_at)
     VALUES (@id, @pathId, @date, @kind, @amountJpy, @minutes, @memo, @settledInt, @createdAt)
     ON CONFLICT(id) DO UPDATE SET
       path_id = excluded.path_id, date = excluded.date, kind = excluded.kind,
       amount_jpy = excluded.amount_jpy, minutes = excluded.minutes, memo = excluded.memo,
       settled = excluded.settled`
  ).run({ ...entry, settledInt: entry.settled ? 1 : 0 });
  return entry;
}

export function deleteEntry(id: string): boolean {
  const db = getHustleDb();
  return db.prepare("DELETE FROM hustle_entries WHERE id = ?").run(id).changes > 0;
}

// --- assets ----------------------------------------------------------------

export function upsertAsset(input: Partial<HustleAsset> & { title: string }): HustleAsset {
  const db = getHustleDb();
  const asset: HustleAsset = {
    id: input.id ?? newId(),
    pathId: input.pathId ?? null,
    kind: input.kind ?? "other",
    title: input.title,
    body: input.body ?? "",
    meta: input.meta ?? {},
    status: input.status ?? "draft",
    createdAt: input.createdAt ?? now(),
  };
  db.prepare(
    `INSERT INTO hustle_assets (id, path_id, kind, title, body, meta, status, created_at)
     VALUES (@id, @pathId, @kind, @title, @body, @metaJson, @status, @createdAt)
     ON CONFLICT(id) DO UPDATE SET
       path_id = excluded.path_id, kind = excluded.kind, title = excluded.title,
       body = excluded.body, meta = excluded.meta, status = excluded.status`
  ).run({ ...asset, metaJson: JSON.stringify(asset.meta) });
  return asset;
}

export function deleteAsset(id: string): boolean {
  const db = getHustleDb();
  return db.prepare("DELETE FROM hustle_assets WHERE id = ?").run(id).changes > 0;
}

// --- scam checks -----------------------------------------------------------

export function insertScamCheck(check: Omit<ScamCheck, "id" | "createdAt"> & Partial<Pick<ScamCheck, "id" | "createdAt">>): ScamCheck {
  const db = getHustleDb();
  const record: ScamCheck = {
    id: check.id ?? newId(),
    source: check.source,
    text: check.text,
    score: check.score,
    verdict: check.verdict,
    signals: check.signals,
    advice: check.advice,
    createdAt: check.createdAt ?? now(),
  };
  db.prepare(
    `INSERT INTO hustle_scam_checks (id, source, text, score, verdict, signals, advice, created_at)
     VALUES (@id, @source, @text, @score, @verdict, @signalsJson, @advice, @createdAt)
     ON CONFLICT(id) DO UPDATE SET score = excluded.score, verdict = excluded.verdict,
       signals = excluded.signals, advice = excluded.advice`
  ).run({ ...record, signalsJson: JSON.stringify(record.signals) });
  return record;
}

// --- whole-state read / restore -------------------------------------------

export function readAll(): HustleBackup {
  return {
    version: 1,
    exportedAt: now(),
    profile: readProfile(),
    paths: readPaths(),
    tasks: readTasks(),
    entries: readEntries(),
    assets: readAssets(),
    scamChecks: readScamChecks(200),
  };
}

/**
 * ブラウザ側に退避してあったデータでサーバーを復元する。
 * サーバーが空のとき（Vercel等で /tmp が飛んだとき）だけ呼ばれる想定。
 */
export function restoreAll(backup: Partial<HustleBackup>): { restored: number } {
  const db = getHustleDb();
  let count = 0;
  const tx = db.transaction(() => {
    if (backup.profile) {
      saveProfile(backup.profile);
      count++;
    }
    for (const p of backup.paths ?? []) {
      createPath(p);
      count++;
    }
    for (const t of backup.tasks ?? []) {
      upsertTask(t);
      count++;
    }
    for (const e of backup.entries ?? []) {
      upsertEntry(e);
      count++;
    }
    for (const a of backup.assets ?? []) {
      upsertAsset(a);
      count++;
    }
    for (const s of backup.scamChecks ?? []) {
      insertScamCheck(s);
      count++;
    }
  });
  tx();
  return { restored: count };
}

export function isServerEmpty(): boolean {
  const db = getHustleDb();
  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM hustle_profile) +
         (SELECT COUNT(*) FROM hustle_paths) +
         (SELECT COUNT(*) FROM hustle_tasks) +
         (SELECT COUNT(*) FROM hustle_entries) +
         (SELECT COUNT(*) FROM hustle_assets) AS total`
    )
    .get() as { total: number };
  return counts.total === 0;
}
