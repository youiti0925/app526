/**
 * 仕事ラインから Gemini（無料枠）を呼ぶ口。サーバー専用。
 * Web調査はできない。公開情報の依頼でしか使われない（models.ts の createCaller が止める）。
 */
import { generateJson, getModel, describeAiError, hasApiKey } from "../ai";
import type { ModelRequest, ModelResponse, UsageRecord } from "./models";

export function geminiAvailable(): boolean {
  return hasApiKey();
}

export function geminiModel(): string {
  return getModel();
}

export async function callGemini(req: ModelRequest): Promise<ModelResponse> {
  const started = Date.now();
  const model = req.override?.provider === "gemini" ? req.override.model : getModel();
  const base: UsageRecord = {
    provider: "gemini", model, tier: req.tier, purpose: req.purpose, ok: false,
    durationMs: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsd: 0, note: "",
  };
  if (req.web) {
    return { ok: false, data: null, error: "Gemini ではWeb調査の操作は動かせません", usage: { ...base, note: "web不可" } };
  }
  try {
    const data = await generateJson<unknown>(
      `${req.prompt}\n\n返答は次のJSON Schemaに合うJSONだけにしてください:\n${JSON.stringify(req.schema)}`,
      { temperature: 0, maxOutputTokens: 8192 }
    );
    const ok = data !== null && data !== undefined;
    return { ok, data, error: ok ? undefined : "応答をJSONとして読めませんでした", usage: { ...base, ok, durationMs: Date.now() - started } };
  } catch (error) {
    const d = describeAiError(error);
    return {
      ok: false, data: null, error: d.message, quota: d.status === 429,
      usage: { ...base, durationMs: Date.now() - started, note: d.message.slice(0, 200) },
    };
  }
}
