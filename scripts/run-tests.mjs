#!/usr/bin/env node
/**
 * テストの実行（Windows でも動く形）。`TZ=UTC node --test …` は Windows の PowerShell では書けないため、
 * 環境変数はここで付けて子プロセスに渡す。
 *
 *   node scripts/run-tests.mjs unit    # 型の準備 → 単体テストを UTC と日本時間の両方で
 *   node scripts/run-tests.mjs e2e     # 型の準備 → E2E（日本時間）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const kind = process.argv[2];
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env }, shell: process.platform === "win32" && cmd === npx });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (kind === "unit") {
  run(npx, ["tsc", "-p", "tsconfig.test.json"]);
  const dir = path.join(ROOT, "tests", "unit");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort().map((f) => path.join("tests", "unit", f));
  for (const tz of ["UTC", "Asia/Tokyo"]) run(process.execPath, ["--test", ...files], { TZ: tz });
} else if (kind === "e2e") {
  run(npx, ["tsc", "-p", "tsconfig.e2e.json"]);
  run(process.execPath, ["--test", path.join("tests", "e2e.test.mjs")], { TZ: "Asia/Tokyo" });
} else {
  console.error("使い方: node scripts/run-tests.mjs unit | e2e");
  process.exit(2);
}
