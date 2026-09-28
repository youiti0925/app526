/**
 * サーバーの claude コマンドがサブスクでログインできているか。
 * `claude auth status` は使用量を消費しない。10分だけ結果を覚えておく。
 */
import { spawn } from "node:child_process";

export interface ClaudeStatus {
  installed: boolean;
  loggedIn: boolean;
  method: string;
  detail: string;
  checkedAt: string;
}

let cache: ClaudeStatus | null = null;

export async function claudeStatus(force = false): Promise<ClaudeStatus> {
  if (!force && cache && Date.now() - Date.parse(cache.checkedAt) < 10 * 60_000) return cache;
  const bin = process.env.CLAUDE_BIN || "claude";
  const result = await new Promise<{ code: number; out: string; err: string }>((resolve) => {
    let out = "";
    let err = "";
    let child;
    try {
      child = spawn(bin, ["auth", "status"], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ code: -1, out, err: String(e) });
      return;
    }
    const timer = setTimeout(() => child.kill("SIGTERM"), 20_000);
    child.stdout.on("data", (d: Buffer) => (out += d));
    child.stderr.on("data", (d: Buffer) => (err += d));
    child.on("error", (e: Error) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: `${err}${String(e)}` });
    });
    child.on("close", (c: number | null) => {
      clearTimeout(timer);
      resolve({ code: c ?? -1, out, err });
    });
  });
  const checkedAt = new Date().toISOString();
  if (/ENOENT/.test(result.err)) {
    cache = { installed: false, loggedIn: false, method: "", detail: "claude コマンドがありません", checkedAt };
    return cache;
  }
  let parsed: { loggedIn?: boolean; authMethod?: string } = {};
  try {
    parsed = JSON.parse(result.out);
  } catch {
    /* 形式が変わっていたら、ログインしていない扱いにして案内を出す */
  }
  const method = parsed.authMethod ?? "";
  cache = {
    installed: true,
    loggedIn: parsed.loggedIn === true,
    method,
    detail:
      parsed.loggedIn !== true
        ? "ログインしていません。サーバーで `claude setup-token` を実行し、出てきた値を CLAUDE_CODE_OAUTH_TOKEN に設定してください"
        : /api.?key/i.test(method)
          ? "APIキーで動いています（従量課金）。サブスクで動かすなら ANTHROPIC_API_KEY を外してください"
          : "サブスクのログインで動いています",
    checkedAt,
  };
  return cache;
}
