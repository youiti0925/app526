"use client";

import { useEffect } from "react";

const SESSION_KEY = "hustle-agent-autorun";

/**
 * アプリを開いたときにエージェントを1回だけ走らせる。
 *
 * 実際に走るかどうか（自律運転がオンか、1日の上限に達していないか）は
 * サーバー側の runAgent が判断する。ここは「合図を送るだけ」に留めて、
 * 判断のロジックを二重に持たないようにしている。
 */
export default function AgentAutoRun() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (sessionStorage.getItem(SESSION_KEY) === "1") return;
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // プライベートモード等。二重実行になっても runAgent 側で弾かれる。
    }

    void fetch("/api/hustle/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "auto_open" }),
    }).catch(() => undefined);
  }, []);

  return null;
}
