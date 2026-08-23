#!/usr/bin/env node
/**
 * 判定できなかった案件を Claude Code に回して、結果を書き戻す。
 *
 *   npm run claude-batch              # 1回だけ実行
 *   npm run claude-batch -- --dry-run # 指示書を表示するだけ（何も呼ばない）
 *
 * 環境変数:
 *   AGENT_URL      アプリのURL（既定 http://localhost:3000）
 *   CLAUDE_BIN     claude コマンドのパス（既定 claude）
 *   CLAUDE_MODEL   使うモデル（省略時はCLIの既定）
 *   BATCH_LIMIT    1回に回す件数（既定 10）
 *   MAX_BUDGET_USD 1回の上限。APIキー課金のときの保険（既定 なし）
 *
 * 認証について:
 *   Claude.ai のサブスクで動きます。一度 `claude` を対話で起動して /login すれば、
 *   以降このスクリプトはその認証を使うので、APIクレジットの購入は要りません。
 *   ANTHROPIC_API_KEY を設定した場合はそちらが使われ、従量課金になります。
 */

import { spawn } from "node:child_process";

const BASE = (process.env.AGENT_URL ?? "http://localhost:3000").replace(/\/$/, "");
const CLAUDE = process.env.CLAUDE_BIN ?? "claude";
const LIMIT = Math.max(1, Math.min(20, Number(process.env.BATCH_LIMIT ?? 10)));
const DRY_RUN = process.argv.includes("--dry-run");

const stamp = () => new Date().toLocaleString("ja-JP");
const log = (...a) => console.log(`[${stamp()}]`, ...a);

/** 返してほしい形。CLI側でこの形に強制する。 */
const SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          leadId: { type: "string" },
          estimatedHours: {
            type: "object",
            properties: { low: { type: "number" }, high: { type: "number" } },
            required: ["low", "high"],
          },
          basis: { type: "string" },
          offeredJpy: { type: ["number", "null"] },
          verdict: { type: "string", enum: ["reject", "verify_first", "proceed"] },
          reason: { type: "string" },
          risks: { type: "array", items: { type: "string" } },
          proposal: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["leadId", "estimatedHours", "basis", "verdict", "reason", "proposal", "confidence"],
      },
    },
  },
  required: ["verdicts"],
};

function run(cmd, args, stdin) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve({ code: -1, out, err: String(e) }));
    child.on("close", (code) => resolve({ code, out, err }));
    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
  });
}

/** ```json フェンスや前後の説明が混ざっていても JSON を取り出す。 */
function parseLoose(text) {
  const candidates = [text];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidates.push(fence[1]);
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a !== -1 && b > a) candidates.push(text.slice(a, b + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* 次の候補へ */
    }
  }
  return null;
}

const brief = await fetch(`${BASE}/api/hustle/agent/escalations?limit=${LIMIT}`)
  .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
  .catch((e) => {
    console.error(`アプリに接続できません (${BASE}): ${e.message}`);
    console.error(`  ${BASE} で 'npm run dev' か 'npm start' が動いているか確認してください。`);
    process.exit(1);
  });

if (brief.startsWith("判定してほしい案件はありません")) {
  log("判定待ちの案件はありません。");
  process.exit(0);
}

const caseCount = (brief.match(/^## 案件 /gm) ?? []).length;
log(`${caseCount}件を判定に回します。`);

if (DRY_RUN) {
  console.log("\n" + brief);
  process.exit(0);
}

const args = [
  "--bare", // CLAUDE.md やフックを読まない。バッチの再現性のため。
  "-p",
  "--output-format", "json",
  "--json-schema", JSON.stringify(SCHEMA),
  // 判定に必要な最小限だけ許可する。bypassPermissions は使わない。
  "--permission-mode", "dontAsk",
  "--allowedTools", "WebSearch,WebFetch",
  "--max-turns", "30",
];
if (process.env.CLAUDE_MODEL) args.push("--model", process.env.CLAUDE_MODEL);
if (process.env.MAX_BUDGET_USD) args.push("--max-budget-usd", process.env.MAX_BUDGET_USD);

log(`${CLAUDE} を起動します…`);
const { code, out, err } = await run(CLAUDE, args, brief);

if (code !== 0) {
  if (/ENOENT/.test(err)) {
    console.error(`\`${CLAUDE}\` が見つかりません。`);
    console.error("  Claude Code をインストールしてから、一度 `claude` を対話で起動して /login してください。");
    console.error("  別の場所にある場合は CLAUDE_BIN でパスを指定できます。");
    process.exit(1);
  }
  console.error(`claude が異常終了しました (exit ${code})`);
  if (code === 1) console.error("  権限の拒否・不正なフラグ・入力なし、のいずれかです。");
  if (code === 2) console.error("  コスト上限に達したか、認証に失敗しています。`claude` を対話で起動して /login を試してください。");
  if (err.trim()) console.error(err.trim().slice(0, 2000));
  process.exit(code === -1 ? 1 : code);
}

const envelope = parseLoose(out);
if (!envelope) {
  console.error("claude の出力を解釈できませんでした。");
  console.error(out.slice(0, 2000));
  process.exit(1);
}

if (envelope.total_cost_usd !== undefined) {
  log(`コスト: $${Number(envelope.total_cost_usd).toFixed(4)}`);
}

// --json-schema を使うと structured_output に入る。素の result のこともある。
const payload =
  envelope.structured_output ??
  (typeof envelope.result === "string" ? parseLoose(envelope.result) : envelope.result) ??
  envelope;

const verdicts = payload?.verdicts;
if (!Array.isArray(verdicts) || verdicts.length === 0) {
  console.error("判定が1件も返ってきませんでした。");
  console.error(JSON.stringify(payload).slice(0, 1500));
  process.exit(1);
}

const applied = await fetch(`${BASE}/api/hustle/agent/escalations`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ verdicts }),
}).then((r) => r.json());

if (applied.error) {
  console.error(`書き戻しに失敗しました: ${applied.error}`);
  process.exit(1);
}

log(`${applied.applied}件を反映、${applied.queued}件を承認キューに追加しました。`);
for (const s of applied.skipped ?? []) log(`  スキップ: ${s.leadId} — ${s.why}`);
for (const v of verdicts) {
  log(`  ${v.verdict.padEnd(13)} ${String(v.reason ?? "").slice(0, 80)}`);
}
