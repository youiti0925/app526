#!/usr/bin/env node
/**
 * 判定できなかった案件を Claude Code に回して、結果を書き戻す。
 * もう1つ、仕事の市場そのものを探しに行かせるモードがある。
 *
 *   npm run claude-batch                 # 判定を回す
 *   npm run claude-batch -- --discover   # 市場を探しに行く
 *   npm run claude-batch -- --produce    # 実案件の成果物を実際に作らせる（試作）
 *   npm run claude-batch -- --grade      # 作られた成果物を採点する
 *   npm run claude-batch -- --trial      # 試作 → 採点 を続けて回す
 *   npm run claude-batch -- --dry-run    # 指示書を表示するだけ（何も呼ばない）
 *
 * 環境変数:
 *   AGENT_URL      アプリのURL（既定 http://localhost:3000）
 *   CLAUDE_BIN     claude コマンドのパス（既定 claude）
 *   CLAUDE_MODEL   使うモデル（省略時はCLIの既定）
 *   BATCH_LIMIT    1回に回す件数（既定 10）
 *   DISCOVER_WANT  探索で探す市場の数（既定 6）
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
const WANT = Math.max(1, Math.min(20, Number(process.env.DISCOVER_WANT ?? 6)));
const DRY_RUN = process.argv.includes("--dry-run");
const DISCOVER = process.argv.includes("--discover");
const PRODUCE = process.argv.includes("--produce");
const GRADE = process.argv.includes("--grade");
const TRIAL = process.argv.includes("--trial");
const TRIAL_LIMIT = Math.max(1, Math.min(10, Number(process.env.TRIAL_LIMIT ?? 4)));

const stamp = () => new Date().toLocaleString("ja-JP");
const log = (...a) => console.log(`[${stamp()}]`, ...a);

const RANGE = {
  type: "object",
  properties: { low: { type: "number" }, high: { type: "number" } },
  required: ["low", "high"],
};

/** 判定モードで返してほしい形。CLI側でこの形に強制する。 */
const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          leadId: { type: "string" },
          estimatedHours: RANGE,
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

/** 探索モードで返してほしい形。 */
const DISCOVERY_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          channel: { type: "string", enum: ["apply", "listing", "direct", "stock"] },
          title: { type: "string" },
          url: { type: "string" },
          evidence: { type: "string" },
          demandSignal: { type: "string" },
          supplySignal: { type: "string" },
          priceJpy: RANGE,
          priceUnit: { type: "string" },
          estimatedHours: RANGE,
          platformId: { type: "string" },
          whyAiCannotKill: { type: "string" },
          qualificationBarrier: { type: "string" },
          timeToFirstYen: { type: "string" },
          firstStep: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: [
          "key",
          "channel",
          "title",
          "evidence",
          "demandSignal",
          "supplySignal",
          "priceJpy",
          "priceUnit",
          "estimatedHours",
          "platformId",
          "whyAiCannotKill",
          "qualificationBarrier",
          "firstStep",
          "confidence",
        ],
      },
    },
  },
  required: ["findings"],
};

/** 試作: 実際に成果物を作らせる。 */
const PRODUCE_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          dryRunId: { type: "string" },
          artifact: { type: "string" },
          method: { type: "string" },
          humanStepsLeft: { type: "array", items: { type: "string" } },
          humanHoursLeft: { type: "number" },
          blocked: { type: "string" },
          selfDoubt: { type: "string" },
        },
        required: ["dryRunId", "artifact", "method", "humanHoursLeft", "blocked"],
      },
    },
  },
  required: ["results"],
};

/** 採点: 依頼者の立場で見る。 */
const GRADE_SCHEMA = {
  type: "object",
  properties: {
    grades: {
      type: "array",
      items: {
        type: "object",
        properties: {
          dryRunId: { type: "string" },
          meetsRequirement: { type: "number" },
          deliverable: { type: "boolean" },
          gaps: { type: "array", items: { type: "string" } },
          humanHoursNeeded: { type: "number" },
          needsFactCheck: { type: "array", items: { type: "string" } },
          verdict: { type: "string", enum: ["pass", "needs_work", "fail", "cannot_produce"] },
          reason: { type: "string" },
        },
        required: ["dryRunId", "meetsRequirement", "deliverable", "humanHoursNeeded", "verdict", "reason"],
      },
    },
  },
  required: ["grades"],
};

/** モードごとの違いはここに閉じ込める。 */
const MODES = {
  triage: {
    label: "判定",
    briefUrl: `${BASE}/api/hustle/agent/escalations?limit=${LIMIT}`,
    postUrl: `${BASE}/api/hustle/agent/escalations`,
    schema: TRIAGE_SCHEMA,
    // 判定は募集文を読むだけなので、探しに行く必要はない
    allowedTools: "WebSearch,WebFetch",
    maxTurns: 30,
    emptyBrief: "判定してほしい案件はありません",
    countBrief: (brief) => (brief.match(/^## 案件 /gm) ?? []).length,
    key: "verdicts",
    report(applied, items) {
      log(`${applied.applied}件を反映、${applied.queued}件を承認キューに追加しました。`);
      for (const s of applied.skipped ?? []) log(`  スキップ: ${s.leadId} — ${s.why}`);
      for (const v of items) log(`  ${String(v.verdict).padEnd(13)} ${String(v.reason ?? "").slice(0, 80)}`);
    },
  },
  discover: {
    label: "探索",
    briefUrl: `${BASE}/api/hustle/agent/discovery?want=${WANT}`,
    postUrl: `${BASE}/api/hustle/agent/discovery`,
    schema: DISCOVERY_SCHEMA,
    allowedTools: "WebSearch,WebFetch",
    // 探索は一次情報を実際に開いて確かめる必要があるので、判定より多く回す
    maxTurns: 80,
    emptyBrief: null,
    countBrief: () => WANT,
    key: "findings",
    report(applied, items) {
      log(
        `${applied.received}件のうち ${applied.saved}件を新規に記録しました` +
          `（重複 ${applied.duplicates}件 / 基準割れ ${applied.belowBar}件）`
      );
      for (const f of items) {
        const hourly = (applied.discoveries ?? []).find((d) => d.key === f.key)?.hourlyJpy;
        const rate = hourly ? `${hourly.low.toLocaleString()}〜${hourly.high.toLocaleString()}円/h` : "時給不明";
        log(`  ${String(f.channel).padEnd(8)} ${rate.padEnd(22)} ${String(f.title).slice(0, 60)}`);
      }
      log("結果は /hustle/discovery で見られます。");
    },
  },
  produce: {
    label: "試作",
    briefUrl: `${BASE}/api/hustle/agent/dryrun?phase=produce&limit=${TRIAL_LIMIT}`,
    postUrl: `${BASE}/api/hustle/agent/dryrun`,
    schema: PRODUCE_SCHEMA,
    // 実際に作って動かして確かめる必要があるので、ツールを広く許可する。
    // ただし書き込みは作業ディレクトリの中だけ。
    allowedTools: "WebSearch,WebFetch,Read,Write,Edit,Glob,Grep,Bash",
    maxTurns: 120,
    emptyBrief: "試作する案件がありません",
    countBrief: (brief) => (brief.match(/^## 試作 /gm) ?? []).length,
    key: "results",
    extraBody: { phase: "produce" },
    report(applied, items) {
      log(`${applied.saved}件の成果物を記録しました`);
      for (const r of items) {
        const state = r.blocked ? `作れず（${String(r.blocked).slice(0, 40)}）` : `${String(r.artifact).length}文字`;
        log(`  ${state} / 人の残作業 ${r.humanHoursLeft}時間`);
      }
      log("採点するには: npm run claude-batch -- --grade");
    },
  },
  grade: {
    label: "採点",
    briefUrl: `${BASE}/api/hustle/agent/dryrun?phase=grade&limit=${TRIAL_LIMIT}`,
    postUrl: `${BASE}/api/hustle/agent/dryrun`,
    schema: GRADE_SCHEMA,
    // 採点は事実確認のために外を見るだけ。作らせない。
    allowedTools: "WebSearch,WebFetch",
    maxTurns: 60,
    emptyBrief: "採点する成果物がありません",
    countBrief: (brief) => (brief.match(/^## 成果物 /gm) ?? []).length,
    key: "grades",
    extraBody: { phase: "grade" },
    report(applied, items) {
      log(`${applied.saved}件を採点しました`);
      for (const g of items) {
        log(`  ${String(g.verdict).padEnd(14)} 要求充足 ${g.meetsRequirement}点 / 人の残作業 ${g.humanHoursNeeded}時間`);
        if (g.reason) log(`    ${String(g.reason).slice(0, 100)}`);
      }
      for (const o of applied.overrides ?? []) log(`  検算で上書き: ${o.note}`);
      log("結果は /hustle/dryrun で見られます。");
    },
  },
};

const mode = PRODUCE
  ? MODES.produce
  : GRADE
    ? MODES.grade
    : DISCOVER
      ? MODES.discover
      : MODES.triage;

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

async function runMode(mode) {
  const brief = await fetch(mode.briefUrl)
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
    .catch((e) => {
      console.error(`アプリに接続できません (${BASE}): ${e.message}`);
      console.error(`  ${BASE} で 'npm run dev' か 'npm start' が動いているか確認してください。`);
      process.exit(1);
    });

  if (mode.emptyBrief && brief.startsWith(mode.emptyBrief)) {
    log(`${mode.label}に回すものはありません。`);
    return false;
  }

  log(`${mode.label}: ${mode.countBrief(brief)}件を ${CLAUDE} に回します。`);

  if (DRY_RUN) {
    console.log("\n" + brief);
    return false;
  }

  const args = [
    "--bare", // CLAUDE.md やフックを読まない。バッチの再現性のため。
    "-p",
    "--output-format", "json",
    "--json-schema", JSON.stringify(mode.schema),
    // 必要な最小限だけ許可する。bypassPermissions は使わない。
    "--permission-mode", "dontAsk",
    "--allowedTools", mode.allowedTools,
    "--max-turns", String(mode.maxTurns),
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
    // 失敗時も JSON が返ってくることがあり、本当の原因はその中にある。
    // ここを読まずに exit コードだけで説明すると、認証エラーを
    // 「権限の拒否・不正なフラグ」と誤って案内することになる（実際にそうなった）。
    const failure = parseLoose(out);
    const detail = typeof failure?.result === "string" ? failure.result : "";

    console.error(`claude が異常終了しました (exit ${code})`);
    if (detail) console.error(`  ${detail}`);

    if (/Authentication|認証/i.test(detail) || code === 2) {
      console.error("  一度 `claude` を対話で起動して /login してください。");
      console.error("  サブスクで動くので、APIクレジットの購入は要りません。");
    } else if (code === 1 && !detail) {
      console.error("  権限の拒否・不正なフラグ・入力なし、のいずれかです。");
    }
    if (failure?.permission_denials?.length) {
      console.error(`  拒否されたツール: ${JSON.stringify(failure.permission_denials).slice(0, 500)}`);
    }
    if (err.trim()) console.error(err.trim().slice(0, 2000));
    process.exit(code === -1 ? 1 : code);
  }

  const envelope = parseLoose(out);
  if (envelope?.is_error) {
    console.error(`claude がエラーを返しました: ${envelope.result ?? "（詳細なし）"}`);
    process.exit(1);
  }
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

  const items = payload?.[mode.key];
  if (!Array.isArray(items) || items.length === 0) {
    console.error(`${mode.label}の結果が1件も返ってきませんでした。`);
    console.error(JSON.stringify(payload).slice(0, 1500));
    process.exit(1);
  }

  const applied = await fetch(mode.postUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(mode.extraBody ?? {}), [mode.key]: items }),
  }).then((r) => r.json());

  if (applied.error) {
    console.error(`書き戻しに失敗しました: ${applied.error}`);
    process.exit(1);
  }

  mode.report(applied, items);
  return true;
}

if (TRIAL) {
  // 試作と採点は必ず別プロセスで回す。同じ文脈で採点させると、
  // 自分が作ったものなので甘い点がつく。
  log("試作 → 採点 を続けて回します。");
  const produced = await runMode(MODES.produce);
  if (produced) await runMode(MODES.grade);
} else {
  await runMode(mode);
}
