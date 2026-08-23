import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import os from "os";

/**
 * Resolve a writable data directory.
 *
 * Locally (`npm run dev`, self-hosting) this is `<project>/data` and the data
 * survives restarts. On read-only serverless filesystems (Vercel etc.) that
 * mkdir throws, so we fall back to the platform temp dir. Data there is
 * ephemeral — the hustle app mirrors everything to the browser and re-seeds
 * the server on load, so the user never loses their ledger.
 */
function resolveDataDir(): { dir: string; ephemeral: boolean } {
  const configured = process.env.APP_DATA_DIR;
  const candidates = configured
    ? [configured, path.join(os.tmpdir(), "app526-data")]
    : [path.join(process.cwd(), "data"), path.join(os.tmpdir(), "app526-data")];

  for (let i = 0; i < candidates.length; i++) {
    try {
      fs.mkdirSync(candidates[i], { recursive: true });
      fs.accessSync(candidates[i], fs.constants.W_OK);
      return { dir: candidates[i], ephemeral: i > 0 };
    } catch {
      // try the next candidate
    }
  }
  throw new Error("書き込み可能なデータディレクトリが見つかりません");
}

const resolved = resolveDataDir();

const DATA_DIR = resolved.dir;
const DB_PATH = path.join(DATA_DIR, "videosop.db");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

/** True when the database lives in a temp dir and will not survive a restart. */
export const STORAGE_IS_EPHEMERAL = resolved.ephemeral;

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  // Ensure data directories exist
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'other',
      status TEXT NOT NULL DEFAULT 'draft',
      tags TEXT NOT NULL DEFAULT '[]',
      assignee TEXT,
      department TEXT,
      machine_model TEXT,
      inspection_type TEXT,
      video_file TEXT,
      work_standard TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS glossary (
      id TEXT PRIMARY KEY,
      term TEXT NOT NULL,
      reading TEXT,
      definition TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      synonyms TEXT NOT NULL DEFAULT '[]'
    );
  `);

  // Seed default settings if missing
  const existing = db.prepare("SELECT key FROM settings WHERE key = ?").get("geminiApiKey");
  if (!existing) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("geminiApiKey", "");
  }
  const toggles = db.prepare("SELECT key FROM settings WHERE key = ?").get("featureToggles");
  if (!toggles) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      "featureToggles",
      JSON.stringify({ conditionalBranching: true, sopDriftDetection: true, bidirectionalSync: true })
    );
  }
}
