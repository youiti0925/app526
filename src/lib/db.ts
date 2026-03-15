import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "videosop.db");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

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
