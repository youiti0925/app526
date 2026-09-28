/**
 * 仕事ラインの保存先（SQLite）。
 *
 * - hustle_jobs      : 依頼1件ごと。本体はJSON、状態だけ列に出して検索・排他に使う
 * - hustle_recipes   : 手順書。版ごとに残す（改修で壊したら前の版に戻せるように）
 * - hustle_ai_usage  : AI呼び出し1回ごとの記録。「どれだけ使ったか」を実測で出すため
 */
import { randomUUID } from "crypto";
import { getHustleDb } from "../db";
import { validateRecipe, type Recipe } from "./recipe";
import type { Job, JobStatus } from "./pipeline";
import type { UsageRecord } from "./models";
import { appendUsage, exportRecipe, readLibraryRecipes, readLibraryUsage } from "./library";

let initialized = false;

function db() {
  const d = getHustleDb();
  if (initialized) return d;
  d.exec(`
    CREATE TABLE IF NOT EXISTS hustle_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      data TEXT NOT NULL,
      retry_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS hustle_jobs_status ON hustle_jobs(status, created_at);

    CREATE TABLE IF NOT EXISTS hustle_recipes (
      id TEXT NOT NULL,
      version INTEGER NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (id, version)
    );

    CREATE TABLE IF NOT EXISTS hustle_ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      job_id TEXT,
      recipe_id TEXT,
      purpose TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      tier TEXT NOT NULL,
      ok INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_tokens INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS hustle_ai_usage_at ON hustle_ai_usage(at);
    CREATE INDEX IF NOT EXISTS hustle_ai_usage_job ON hustle_ai_usage(job_id);
  `);
  initialized = true;
  importLibrary(d);
  return d;
}

/**
 * library/（GitHubに残してある手順書と使用量）を読み戻す。
 * 作業場所が作り直されてDBが空になっても、慣れた型を忘れないため。
 * DBの方が新しい版を持っていれば、そちらを優先する（上書きしない）。
 */
function importLibrary(d: ReturnType<typeof getHustleDb>): void {
  const insert = d.prepare("INSERT OR IGNORE INTO hustle_recipes (id, version, data, created_at) VALUES (?, ?, ?, ?)");
  const top = d.prepare("SELECT MAX(version) AS v FROM hustle_recipes WHERE id = ?");
  for (const r of readLibraryRecipes()) {
    const v = validateRecipe(r, { now: r.updatedAt }).recipe;
    if (!v) continue;
    const have = (top.get(v.id) as { v: number | null }).v ?? 0;
    if (have >= v.version) continue;
    insert.run(v.id, v.version, JSON.stringify({ ...v, updatedAt: r.updatedAt ?? v.updatedAt }), v.createdAt);
  }
  const count = (d.prepare("SELECT COUNT(*) AS n FROM hustle_ai_usage").get() as { n: number }).n;
  if (count === 0) {
    const ins = d.prepare(
      `INSERT INTO hustle_ai_usage
        (at, job_id, recipe_id, purpose, provider, model, tier, ok, duration_ms, input_tokens, output_tokens, cache_tokens, cost_usd, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')`
    );
    for (const u of readLibraryUsage()) {
      ins.run(u.at, u.jobId, u.recipeId, u.purpose, u.provider, u.model, u.tier, u.ok ? 1 : 0,
        Math.round(u.durationMs), u.inputTokens, u.outputTokens, u.cacheTokens, u.costUsd);
    }
  }
}

const now = () => new Date().toISOString();

// --- 依頼 ---------------------------------------------------------------------

type JobRow = { id: string; status: string; data: string; retry_at: string | null; created_at: string; updated_at: string };

function toJob(r: JobRow): Job {
  const data = JSON.parse(r.data) as Job;
  return { ...data, id: r.id, status: r.status as JobStatus, retryAt: r.retry_at, createdAt: r.created_at, updatedAt: r.updated_at };
}

export interface NewJob {
  title: string;
  instructions: string;
  inputCsv: string;
  lists: Record<string, string[]>;
  dataClass: Job["dataClass"];
  deadline: string;
  priceJpy: number;
}

export function createJob(input: NewJob): Job {
  const at = now();
  const job: Job = {
    id: randomUUID(),
    ...input,
    status: "queued",
    note: "処理待ち",
    recipeId: null,
    recipeVersion: null,
    route: null,
    outputCsv: "",
    issues: [],
    removed: [],
    report: null,
    qualityPass: null,
    outputSrc: [],
    feedback: "",
    inboxId: null,
    error: "",
    retryAt: null,
    createdAt: at,
    updatedAt: at,
    startedAt: null,
    finishedAt: null,
  };
  db()
    .prepare("INSERT INTO hustle_jobs (id, status, data, retry_at, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)")
    .run(job.id, job.status, JSON.stringify(job), at, at);
  return job;
}

export function readJob(id: string): Job | null {
  const r = db().prepare("SELECT * FROM hustle_jobs WHERE id = ?").get(id) as JobRow | undefined;
  return r ? toJob(r) : null;
}

export function readJobs(limit = 50): Job[] {
  return (db().prepare("SELECT * FROM hustle_jobs ORDER BY created_at DESC LIMIT ?").all(limit) as JobRow[]).map(toJob);
}

export function updateJob(id: string, patch: Partial<Job>): Job | null {
  const d = db();
  return d.transaction(() => {
    const cur = readJob(id);
    if (!cur) return null;
    const next: Job = { ...cur, ...patch, id, updatedAt: now() };
    d.prepare("UPDATE hustle_jobs SET status = ?, data = ?, retry_at = ?, updated_at = ? WHERE id = ?").run(
      next.status, JSON.stringify(next), next.retryAt, next.updatedAt, id
    );
    return next;
  })();
}

/** 処理中のまま止まった依頼（サーバーの再起動など）を、処理待ちに戻す。 */
export function reapStaleJobs(maxMinutes = 45): number {
  const cutoff = new Date(Date.now() - maxMinutes * 60_000).toISOString();
  const stale = db().prepare("SELECT id FROM hustle_jobs WHERE status = 'working' AND updated_at < ?").all(cutoff) as { id: string }[];
  for (const s of stale) updateJob(s.id, { status: "queued", note: "処理が途中で止まっていたため、やり直します" });
  return stale.length;
}

/**
 * 次に処理する依頼を1件取って「処理中」にする。取れなければ null。
 * 状態の書き換えを条件付きUPDATEで行うので、2つの処理が同じ依頼を取ることはない。
 */
export function claimNextJob(): Job | null {
  const d = db();
  const at = now();
  const row = d
    .prepare(
      `SELECT * FROM hustle_jobs
       WHERE status = 'queued' OR (status = 'waiting_quota' AND (retry_at IS NULL OR retry_at <= ?))
       ORDER BY created_at ASC LIMIT 1`
    )
    .get(at) as JobRow | undefined;
  if (!row) return null;
  const res = d
    .prepare("UPDATE hustle_jobs SET status = 'working', updated_at = ? WHERE id = ? AND status = ?")
    .run(at, row.id, row.status);
  if (res.changes !== 1) return null;
  return updateJob(row.id, { status: "working", startedAt: at, error: "" });
}

/** 指定の依頼を「処理中」にする（コマンドから1件だけ回すとき）。取れなければ null。 */
export function claimJob(id: string): Job | null {
  const at = now();
  const res = db()
    .prepare("UPDATE hustle_jobs SET status = 'working', updated_at = ? WHERE id = ? AND status IN ('queued', 'waiting_quota')")
    .run(at, id);
  if (res.changes !== 1) return null;
  return updateJob(id, { status: "working", startedAt: at, error: "" });
}

export function hasWorkingJob(): boolean {
  return !!db().prepare("SELECT 1 FROM hustle_jobs WHERE status = 'working' LIMIT 1").get();
}

// --- 手順書 -------------------------------------------------------------------

function parseRecipe(data: string): Recipe | null {
  try {
    const raw = JSON.parse(data);
    const v = validateRecipe(raw, { now: raw?.updatedAt });
    return v.recipe;
  } catch {
    return null;
  }
}

/** 各手順書の最新版。 */
export function listRecipes(): Recipe[] {
  const rows = db()
    .prepare(
      `SELECT r.data FROM hustle_recipes r
       JOIN (SELECT id, MAX(version) AS v FROM hustle_recipes GROUP BY id) m ON r.id = m.id AND r.version = m.v
       ORDER BY r.created_at DESC`
    )
    .all() as { data: string }[];
  return rows.map((r) => parseRecipe(r.data)).filter((r): r is Recipe => !!r);
}

export function getRecipe(id: string, version?: number): Recipe | null {
  const row = (version
    ? db().prepare("SELECT data FROM hustle_recipes WHERE id = ? AND version = ?").get(id, version)
    : db().prepare("SELECT data FROM hustle_recipes WHERE id = ? ORDER BY version DESC LIMIT 1").get(id)) as { data: string } | undefined;
  return row ? parseRecipe(row.data) : null;
}

export function recipeVersions(id: string): { version: number; createdAt: string }[] {
  return (db().prepare("SELECT version, created_at AS createdAt FROM hustle_recipes WHERE id = ? ORDER BY version DESC").all(id) as {
    version: number;
    createdAt: string;
  }[]);
}

/** 新しい版として保存する（同じ id があれば版を1つ上げる）。 */
export function saveRecipe(recipe: Recipe): Recipe {
  const d = db();
  return d.transaction(() => {
    const top = d.prepare("SELECT MAX(version) AS v FROM hustle_recipes WHERE id = ?").get(recipe.id) as { v: number | null };
    const version = (top.v ?? 0) + 1;
    const at = now();
    const saved: Recipe = { ...recipe, version, updatedAt: at, createdAt: version === 1 ? at : recipe.createdAt };
    d.prepare("INSERT INTO hustle_recipes (id, version, data, created_at) VALUES (?, ?, ?, ?)").run(saved.id, version, JSON.stringify(saved), at);
    exportRecipe(saved);
    return saved;
  })();
}

/** 手順を変えない更新（統計・手本・比較結果）。版は上げずに最新版を書き換える。 */
export function patchRecipe(id: string, patch: Partial<Pick<Recipe, "stats" | "testSet" | "trials" | "preferred">>): Recipe | null {
  const d = db();
  return d.transaction(() => {
    const cur = getRecipe(id);
    if (!cur) return null;
    const next = { ...cur, ...patch, updatedAt: now() };
    d.prepare("UPDATE hustle_recipes SET data = ? WHERE id = ? AND version = ?").run(JSON.stringify(next), id, cur.version);
    exportRecipe(next);
    return next;
  })();
}

// --- 使用量 -------------------------------------------------------------------

export function recordUsage(u: UsageRecord & { jobId: string | null; recipeId: string | null }): void {
  appendUsage({ ...u, at: now() });
  db()
    .prepare(
      `INSERT INTO hustle_ai_usage
        (at, job_id, recipe_id, purpose, provider, model, tier, ok, duration_ms, input_tokens, output_tokens, cache_tokens, cost_usd, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      now(), u.jobId, u.recipeId, u.purpose, u.provider, u.model, u.tier, u.ok ? 1 : 0,
      Math.round(u.durationMs), u.inputTokens, u.outputTokens, u.cacheTokens, u.costUsd, u.note.slice(0, 300)
    );
}

export interface UsageTotal {
  provider: string;
  model: string;
  calls: number;
  failed: number;
  minutes: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  costUsd: number;
}

type UsageAgg = { provider: string; model: string; calls: number; failed: number; ms: number; input: number; output: number; cache: number; cost: number };

const AGG = `provider, model, COUNT(*) AS calls, SUM(1 - ok) AS failed, SUM(duration_ms) AS ms,
  SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(cache_tokens) AS cache, SUM(cost_usd) AS cost`;

const toTotal = (r: UsageAgg): UsageTotal => ({
  provider: r.provider,
  model: r.model,
  calls: r.calls,
  failed: r.failed,
  minutes: Math.round((r.ms / 60_000) * 10) / 10,
  inputTokens: r.input,
  outputTokens: r.output,
  cacheTokens: r.cache,
  costUsd: Math.round(r.cost * 10000) / 10000,
});

export function usageSince(sinceIso: string): UsageTotal[] {
  return (db().prepare(`SELECT ${AGG} FROM hustle_ai_usage WHERE at >= ? GROUP BY provider, model ORDER BY ms DESC`).all(sinceIso) as UsageAgg[]).map(toTotal);
}

export function usageForJob(jobId: string): (UsageTotal & { purpose: string })[] {
  return (
    db().prepare(`SELECT purpose, ${AGG} FROM hustle_ai_usage WHERE job_id = ? GROUP BY purpose, provider, model ORDER BY ms DESC`).all(jobId) as (UsageAgg & {
      purpose: string;
    })[]
  ).map((r) => ({ ...toTotal(r), purpose: r.purpose }));
}
