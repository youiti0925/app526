#!/usr/bin/env node
/**
 * エージェントを常駐で回す。
 *
 *   npm run agent                     # 既定は30分おき
 *   AGENT_INTERVAL_MIN=60 npm run agent
 *   AGENT_URL=http://localhost:3000 npm run agent
 *
 * 実際に走るかどうか（自律運転がオン、1日の上限内）はサーバー側が判断する。
 * ここは合図を送るだけなので、二重起動しても実害はない。
 */

const BASE = (process.env.AGENT_URL ?? "http://localhost:3000").replace(/\/$/, "");
// 合言葉ロック(APP_PASSWORD)が掛かった公開デプロイでも、デーモンが自分で通れるように
const AUTH = process.env.APP_PASSWORD
  ? { Authorization: `Basic ${Buffer.from(`agent:${process.env.APP_PASSWORD}`).toString("base64")}` }
  : {};
const INTERVAL_MIN = Math.max(5, Number(process.env.AGENT_INTERVAL_MIN ?? 30));
const FORCE = process.env.AGENT_FORCE === "1";

const stamp = () => new Date().toLocaleString("ja-JP");

async function tick() {
  try {
    const res = await fetch(`${BASE}/api/hustle/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ trigger: "daemon", force: FORCE }),
    });

    if (!res.ok) {
      console.error(`[${stamp()}] サーバーがエラーを返しました (${res.status})`);
      return;
    }

    const data = await res.json();
    if (!data.ran) {
      console.log(`[${stamp()}] 実行なし: ${data.reason}`);
      return;
    }

    const { run, queued, triaged, ingested } = data.result;
    console.log(
      `[${stamp()}] ${run.summary}（取り込み${ingested} / 判定${triaged} / 承認待ち+${queued} / AI${run.callsUsed}回）`
    );

    for (const e of data.result.events.filter((x) => x.level === "decision" || x.level === "error")) {
      console.log(`    ${e.level === "error" ? "×" : "·"} ${e.message}`);
    }
  } catch (error) {
    console.error(`[${stamp()}] サーバーに接続できません: ${error instanceof Error ? error.message : error}`);
    console.error(`    ${BASE} で 'npm run dev' か 'npm start' が動いているか確認してください。`);
  }
}

console.log(`副業パイプラインのエージェントを起動しました。`);
console.log(`  接続先: ${BASE}`);
console.log(`  間隔:   ${INTERVAL_MIN}分`);
console.log(`  停止:   Ctrl+C\n`);

await tick();
const timer = setInterval(tick, INTERVAL_MIN * 60_000);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearInterval(timer);
    console.log(`\n[${stamp()}] 停止しました。`);
    process.exit(0);
  });
}
