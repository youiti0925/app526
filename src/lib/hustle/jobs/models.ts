/**
 * 仕事ラインが使うAIの呼び出し口。
 *
 * 既定は Claude Code CLI（`claude -p`）をサブスクのログインで呼ぶ。
 * 段（軽い/中/上位）ごとにモデルを変え、1回ごとの時間・トークンを必ず記録する。
 * 「どれだけ使ったか」を実測で出せないと、サブスクの上限に当たるかどうかを
 * 予想でしか語れない（実際に予想で語ってきた）。
 *
 * 呼び出しの作り:
 * - `--bare` は使わない。--bare はサブスクのログイン（OAuth）を読まず、APIキーでしか動かない
 * - 代わりに `--safe-mode` で CLAUDE.md・フック・プラグイン等を切り、空の作業フォルダで動かす
 * - `--system-prompt` を短く差し替える。既定のシステムプロンプトのままだと1回あたり入力が2倍になる（実測）
 * - ツールは原則なし。Web調査の操作だけ WebSearch / WebFetch を許可する
 * - 権限は dontAsk（許可していないものは黙って拒否）。bypassPermissions は使わない
 * - ANTHROPIC_API_KEY は子プロセスに渡さない（明示的に JOB_CLAUDE_USE_API_KEY=1 のときだけ渡す）。
 *   環境にキーが残っていると、気づかないうちに従量課金に切り替わるため
 *
 * Gemini は無料枠のため、送った内容が学習に使われうる。公開情報だけの依頼でしか使わない。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Tier } from "./recipe";

export type Purpose = "route" | "author" | "fix" | "run" | "review" | "compare";
export const PURPOSE_LABELS: Record<Purpose, string> = {
  route: "振り分け",
  author: "手順書づくり",
  fix: "手順書の改修",
  run: "作業",
  review: "検品",
  compare: "モデル比較",
};

export interface ModelChoice {
  provider: "claude" | "gemini";
  model: string;
}

export interface ModelRequest {
  purpose: Purpose;
  tier: Tier;
  prompt: string;
  /** 返してほしいJSONの形（JSON Schema）。 */
  schema: Record<string, unknown>;
  /** Web検索・取得を許可する（ai_lookup と手順書づくりだけ）。 */
  web?: boolean;
  /** 段の既定モデルの代わりに使うモデル（比較試験・比較で選ばれたモデル）。 */
  override?: ModelChoice;
  timeoutMs?: number;
}

export interface UsageRecord {
  provider: string;
  model: string;
  tier: Tier;
  purpose: Purpose;
  ok: boolean;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  /** API料金に換算した目安。サブスクでは請求されない。 */
  costUsd: number;
  note: string;
}

export interface ModelResponse {
  ok: boolean;
  data: unknown;
  error?: string;
  /** 使用上限に当たった。ジョブを止めて、時間をおいてやり直す。 */
  quota?: boolean;
  usage: UsageRecord;
}

export type ModelCaller = (req: ModelRequest) => Promise<ModelResponse>;

/** 使用上限に当たったときに投げる。パイプラインはこれを見てジョブを一時停止する。 */
export class QuotaPauseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaPauseError";
  }
}

const DEFAULT_TIER_MODELS: Record<Tier, string> = { light: "haiku", standard: "sonnet", heavy: "opus" };

/** 段ごとのモデル。環境変数で差し替えられる（モデルの世代交代でデプロイなしに直せるように）。 */
export function tierModel(tier: Tier): string {
  const env = {
    light: process.env.JOB_MODEL_LIGHT,
    standard: process.env.JOB_MODEL_STANDARD,
    heavy: process.env.JOB_MODEL_HEAVY,
  }[tier];
  return env?.trim() || DEFAULT_TIER_MODELS[tier];
}

const SYSTEM_PROMPT =
  "あなたは受託データ作業の作業担当です。指示に書かれたことだけを行い、指定されたJSONの形だけで答えます。" +
  "推測で値を補わず、分からないものは空にします。";

// --- CLIの出力の読み取り（純関数。テスト対象）------------------------------

interface CliEnvelope {
  is_error?: boolean;
  result?: unknown;
  structured_output?: unknown;
  duration_ms?: number;
  total_cost_usd?: number;
  api_error_status?: number | null;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  modelUsage?: Record<string, { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number; costUSD?: number }>;
  subtype?: string;
}

/** ```json フェンスや前後の説明が混ざっていてもJSONを取り出す。 */
export function parseLooseJson(text: string): unknown {
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

const QUOTA_RE = /usage limit|rate limit|limit reached|limit will reset|too many requests|上限/i;

/** CLIの終了コード・標準出力から、結果と使用量を取り出す。 */
export function readCliOutput(
  code: number,
  stdout: string,
  stderr: string,
  meta: { tier: Tier; purpose: Purpose; model: string; elapsedMs: number }
): ModelResponse {
  const env = parseLooseJson(stdout) as CliEnvelope | null;
  const models = env?.modelUsage ? Object.keys(env.modelUsage) : [];
  // Claude Code は裏で軽いモデルも呼ぶので、modelUsage には複数のモデルが並ぶ。
  // 先頭を取ると、上位モデルで動かした呼び出しまで軽いモデルとして記録してしまう（実際にそうなった）。
  // 指定したモデル名を含むもの → 無ければ費用が最大のもの を「主なモデル」とする。
  const alias = meta.model.toLowerCase();
  const main =
    models.find((m) => m.toLowerCase() === alias) ??
    models.find((m) => m.toLowerCase().includes(alias)) ??
    [...models].sort((a, b) => (env!.modelUsage![b].costUSD ?? 0) - (env!.modelUsage![a].costUSD ?? 0))[0];
  const mu = models.reduce(
    (acc, m) => {
      const u = env!.modelUsage![m];
      acc.input += (u.inputTokens ?? 0);
      acc.output += (u.outputTokens ?? 0);
      acc.cache += (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0);
      return acc;
    },
    { input: 0, output: 0, cache: 0 }
  );
  const usage: UsageRecord = {
    provider: "claude",
    model: main ?? meta.model,
    tier: meta.tier,
    purpose: meta.purpose,
    ok: false,
    durationMs: env?.duration_ms ?? meta.elapsedMs,
    inputTokens: mu.input || env?.usage?.input_tokens || 0,
    outputTokens: mu.output || env?.usage?.output_tokens || 0,
    cacheTokens: mu.cache || (env?.usage?.cache_creation_input_tokens ?? 0) + (env?.usage?.cache_read_input_tokens ?? 0),
    costUsd: env?.total_cost_usd ?? 0,
    note: models.length > 1 ? `補助: ${models.filter((m) => m !== main).join(", ")}` : "",
  };

  const resultText = typeof env?.result === "string" ? env.result : "";
  if (code !== 0 || !env || env.is_error) {
    const detail = (resultText || stderr || stdout).trim().slice(0, 500);
    const quota = env?.api_error_status === 429 || QUOTA_RE.test(detail);
    const auth = /authenticat|log ?in|認証|invalid api key|oauth/i.test(detail);
    let error = detail || `claude が異常終了しました (exit ${code})`;
    if (/ENOENT/.test(stderr)) error = "claude コマンドが見つかりません。Claude Code を入れて、一度 `claude` を起動して /login してください。";
    else if (auth) error = `Claude にログインできていません。サーバーで \`claude setup-token\` を実行し、CLAUDE_CODE_OAUTH_TOKEN を設定してください（${detail.slice(0, 120)}）`;
    usage.note = quota ? "使用上限" : error.slice(0, 200);
    return { ok: false, data: null, error, quota, usage };
  }

  const data = env.structured_output ?? (resultText ? parseLooseJson(resultText) : null);
  if (data === null || data === undefined) {
    usage.note = "JSONを読めない応答";
    return { ok: false, data: null, error: "応答をJSONとして読めませんでした", usage };
  }
  usage.ok = true;
  return { ok: true, data, usage };
}

// --- 実際の呼び出し -----------------------------------------------------------

function workDir(): string {
  // CLAUDE.md などを拾わないよう、何も置かない専用フォルダで動かす
  const base = process.env.APP_DATA_DIR || path.join(process.cwd(), "data");
  const dir = path.join(base, "job-ai-workdir");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function buildCliArgs(req: ModelRequest, model: string): string[] {
  const web = !!req.web;
  const args = [
    "-p",
    "--safe-mode",
    "--output-format", "json",
    "--no-session-persistence",
    "--model", model,
    "--system-prompt", SYSTEM_PROMPT,
    "--json-schema", JSON.stringify(req.schema),
    "--permission-mode", "dontAsk",
    "--tools", web ? "WebSearch,WebFetch" : "",
    "--max-turns", String(web ? (req.purpose === "author" || req.purpose === "fix" ? 40 : 15) : 3),
  ];
  if (web) args.push("--allowedTools", "WebSearch,WebFetch");
  return args;
}

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (process.env.JOB_CLAUDE_USE_API_KEY !== "1") delete env.ANTHROPIC_API_KEY;
  return env;
}

export async function callClaudeCli(req: ModelRequest): Promise<ModelResponse> {
  const model = req.override?.provider === "claude" ? req.override.model : tierModel(req.tier);
  const bin = process.env.CLAUDE_BIN || "claude";
  const timeoutMs = req.timeoutMs ?? (req.web ? 10 * 60_000 : 3 * 60_000);
  const started = Date.now();

  const { code, out, err } = await new Promise<{ code: number; out: string; err: string }>((resolve) => {
    let child;
    try {
      child = spawn(bin, buildCliArgs(req, model), { cwd: workDir(), env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      resolve({ code: -1, out: "", err: String(e) });
      return;
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      err += `\n${Math.round(timeoutMs / 1000)}秒で打ち切りました`;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (out += d));
    child.stderr.on("data", (d: Buffer) => (err += d));
    child.on("error", (e: Error) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: `${err}\n${String(e)}` });
    });
    child.on("close", (c: number | null) => {
      clearTimeout(timer);
      resolve({ code: c ?? -1, out, err });
    });
    child.stdin.write(req.prompt);
    child.stdin.end();
  });

  return readCliOutput(code, out, err, { tier: req.tier, purpose: req.purpose, model, elapsedMs: Date.now() - started });
}

export interface CallerOptions {
  /** 依頼のデータ区分。confidential のときは Gemini を使わない。 */
  dataClass: "public" | "confidential";
  /** 使用量を残す先。 */
  record: (u: UsageRecord) => void;
  /** 1ジョブで呼べる回数の上限。暴走で週の枠を食い潰さないため。 */
  maxCalls: number;
  claude?: (req: ModelRequest) => Promise<ModelResponse>;
  gemini?: (req: ModelRequest) => Promise<ModelResponse>;
}

/** 記録・回数上限・データ区分の制約を掛けた呼び出し口を作る。 */
export function createCaller(opts: CallerOptions): ModelCaller & { calls: () => number } {
  let calls = 0;
  const claude = opts.claude ?? callClaudeCli;
  const gemini =
    opts.gemini ??
    (async (req: ModelRequest): Promise<ModelResponse> => ({
      ok: false, data: null, error: "Gemini の呼び出し口が用意されていません",
      usage: { provider: "gemini", model: "", tier: req.tier, purpose: req.purpose, ok: false, durationMs: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsd: 0, note: "未接続" },
    }));
  const caller = async (req: ModelRequest): Promise<ModelResponse> => {
    if (calls >= opts.maxCalls) {
      const usage: UsageRecord = {
        provider: "none", model: "", tier: req.tier, purpose: req.purpose, ok: false,
        durationMs: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsd: 0, note: "回数上限",
      };
      return { ok: false, data: null, error: `このジョブのAI呼び出し上限（${opts.maxCalls}回）に達しました`, usage };
    }
    calls++;
    let target = req;
    // 依頼者の資料を無料枠のGeminiに送らない。比較で選ばれていても Claude に戻す。
    if (req.override?.provider === "gemini" && opts.dataClass !== "public") {
      target = { ...req, override: undefined };
    }
    let res = target.override?.provider === "gemini" ? await gemini(target) : await claude(target);
    if (res.quota && target.override?.provider === "gemini") {
      // 無料枠が尽きただけなら、止めずに Claude で続ける
      opts.record(res.usage);
      res = await claude({ ...target, override: undefined });
    }
    opts.record(res.usage);
    if (res.quota) throw new QuotaPauseError(res.error ?? "使用上限に達しました");
    return res;
  };
  return Object.assign(caller, { calls: () => calls });
}
