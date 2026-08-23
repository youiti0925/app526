import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { combineSignals, scoreScam } from "@/lib/hustle/scam-rules";
import { generateJson, hasApiKey, describeAiError } from "@/lib/hustle/ai";
import { insertScamCheck } from "@/lib/hustle/repo";
import type { ScamSignalHit } from "@/lib/hustle/types";

interface AiVerdict {
  extraSignals?: { label: string; weight: number; why: string; excerpt?: string }[];
  summary?: string;
  /** 相手が何を狙っているかの推定 */
  intent?: string;
}

const AI_PROMPT = (text: string, ruleHits: string[]) => `あなたは日本の消費生活相談員です。以下は、ある人が受け取った副業の勧誘文・求人票です。
この人は現在お金に困っており、判断を誤ると生活が破綻します。厳しめに評価してください。

すでにルールベースの検査で以下が検出されています（重複して報告しないでください）:
${ruleHits.length ? ruleHits.map((h) => `- ${h}`).join("\n") : "- （検出なし）"}

ルールでは拾えなかった危険な点だけを抽出し、次のJSONで返してください。
危険な点が無い場合は extraSignals を空配列にしてください。無理に危険を作り出さないでください。

{
  "extraSignals": [
    { "label": "短い見出し", "weight": 1から10の整数, "why": "なぜ危険か。日本語で2文以内", "excerpt": "根拠になった原文の抜粋" }
  ],
  "intent": "この募集主が本当に得ようとしているものの推定（金銭、個人情報、口座、労働力の買い叩き、など）。1文。",
  "summary": "この人が取るべき行動を2〜3文で。断定的に。"
}

=== 勧誘文 ===
${text.slice(0, 6000)}
=== ここまで ===`;

export async function POST(request: NextRequest) {
  try {
    const { text, source = "", useAi = true } = await request.json();

    if (typeof text !== "string" || text.trim().length < 10) {
      return NextResponse.json({ error: "判定する本文を10文字以上入力してください" }, { status: 400 });
    }

    // ルールベースは必ず動く。APIキーが無くてもここまでは返る。
    const base = scoreScam(text);
    const signals: ScamSignalHit[] = [...base.signals];
    let aiSummary = "";
    let aiIntent = "";
    let aiError: string | null = null;

    if (useAi && hasApiKey()) {
      try {
        const verdict = await generateJson<AiVerdict>(
          AI_PROMPT(text, base.signals.map((s) => s.label)),
          { temperature: 0.2, maxOutputTokens: 2048 }
        );
        if (verdict) {
          for (const extra of verdict.extraSignals ?? []) {
            if (!extra?.label) continue;
            signals.push({
              id: `ai-${randomUUID().slice(0, 8)}`,
              label: extra.label,
              weight: Math.max(1, Math.min(10, Math.round(extra.weight ?? 5))),
              why: extra.why ?? "",
              excerpt: extra.excerpt,
            });
          }
          aiSummary = verdict.summary ?? "";
          aiIntent = verdict.intent ?? "";
        }
      } catch (error) {
        // AI が落ちてもルールベースの結果は返す
        aiError = describeAiError(error).message;
      }
    }

    // AI が追加したシグナルも含めて、ルールベースと同じ式で再スコアリングする
    const combined = combineSignals(signals);
    const { score, verdict } = combined;

    const advice = [combined.advice, aiSummary && `\n【AIの所見】\n${aiSummary}`, aiIntent && `\n【相手の狙い（推定）】\n${aiIntent}`]
      .filter(Boolean)
      .join("\n");

    const record = insertScamCheck({ source, text, score, verdict, signals, advice });

    return NextResponse.json({ check: record, aiUsed: Boolean(aiSummary), aiError });
  } catch (error) {
    const message = error instanceof Error ? error.message : "判定に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
