import { GoogleGenerativeAI } from "@google/generative-ai";
import { getDb } from "@/lib/db";

/**
 * Gemini は無料枠（Google AI Studio の API キー）で使う前提。
 * キーが無い / 枠を使い切った場合でもアプリが死なないよう、
 * 呼び出し側はテンプレートによるフォールバックを必ず用意すること。
 */

export class NoApiKeyError extends Error {
  constructor() {
    super("APIキーが未設定です");
    this.name = "NoApiKeyError";
  }
}

export class QuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaError";
  }
}

export function getApiKey(): string {
  // 環境変数を優先。無ければ設定画面で保存されたキーを使う。
  const fromEnv = process.env.GEMINI_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'geminiApiKey'").get() as
    | { value: string }
    | undefined;
  return (row?.value ?? "").trim();
}

export function hasApiKey(): boolean {
  return getApiKey().length > 0;
}

/** 無料枠で十分に速く、日本語も扱えるモデル。 */
const MODEL = "gemini-2.0-flash";

export interface GenerateOptions {
  /** JSON だけを返させたいとき true */
  json?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
}

export async function generate(prompt: string, opts: GenerateOptions = {}): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new NoApiKeyError();

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: opts.maxOutputTokens ?? 4096,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  });

  try {
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/quota|rate limit|429|RESOURCE_EXHAUSTED/i.test(message)) {
      throw new QuotaError(
        "無料枠の上限に達しました。1分ほど待つか、明日また試してください（無料枠は毎日リセットされます）"
      );
    }
    if (/API_KEY_INVALID|401|403/i.test(message)) {
      throw new NoApiKeyError();
    }
    throw error;
  }
}

/** JSON を返させて安全にパースする。壊れた JSON は null。 */
export async function generateJson<T>(prompt: string, opts: GenerateOptions = {}): Promise<T | null> {
  const raw = await generate(prompt, { ...opts, json: true });
  return parseLooseJson<T>(raw);
}

/** ```json フェンスや前後の説明文が混ざっていても JSON を取り出す。 */
export function parseLooseJson<T>(raw: string): T | null {
  const trimmed = raw.trim();
  const candidates: string[] = [trimmed];

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidates.push(fence[1]);

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // 次の候補へ
    }
  }
  return null;
}

/** API 由来のエラーを、ユーザーに見せる日本語メッセージと HTTP ステータスに変換する。 */
export function describeAiError(error: unknown): { message: string; status: number; kind: string } {
  if (error instanceof NoApiKeyError) {
    return {
      message:
        "Gemini APIキーが未設定です。設定画面から無料キーを登録すると、AI生成機能が使えるようになります（キーが無くてもテンプレート生成は動きます）。",
      status: 400,
      kind: "no_api_key",
    };
  }
  if (error instanceof QuotaError) {
    return { message: error.message, status: 429, kind: "quota" };
  }
  const message = error instanceof Error ? error.message : "不明なエラー";
  return { message: `生成に失敗しました: ${message}`, status: 500, kind: "unknown" };
}
