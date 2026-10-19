#!/usr/bin/env node
/**
 * 自律エージェントの記録（判定・下書きの工程が何をして、どこで失敗したか）を、新しい順に読む。読むだけ。
 * 提案文が出ない・判定がおかしいときに、原因を見つけるために使う。
 *
 *   node scripts/agent-events.mjs [件数=80] [--warn]     # --warn: 警告とエラーだけ
 *
 * 出力は時刻（日本時間）・工程・重さ・メッセージ。依頼者の資料の中身は出さない（メッセージの先頭200字まで）。
 */
import path from "node:path";
import Module from "node:module";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist-e2e");
process.env.APP_DATA_DIR ||= path.join(ROOT, "data");

const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) return original.call(this, path.join(DIST, request.slice(2)), ...rest);
  return original.call(this, request, ...rest);
};
const require_ = Module.createRequire(import.meta.url);

const args = process.argv.slice(2);
const limit = Number(args.find((a) => /^[0-9]+$/.test(a))) || 80;
const onlyWarn = args.includes("--warn");

let db;
try {
  db = require_(path.join(DIST, "lib/hustle/agent/db.js"));
} catch (e) {
  console.error("まだコンパイルされていません。先に node scripts/job.mjs status を実行してください");
  process.exit(1);
}

const jst = (iso) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().replace("T", " ").slice(5, 19);
const events = db
  .readEvents(undefined, limit * (onlyWarn ? 5 : 1))
  .filter((e) => !onlyWarn || e.level === "warn" || e.level === "error")
  .slice(0, limit)
  .reverse();
if (!events.length) console.log("記録はありません");
for (const e of events) console.log(`${jst(e.createdAt)} ${e.step.padEnd(8)} ${String(e.level).padEnd(8)} ${e.message.replace(/\s+/g, " ").slice(0, 200)}`);
