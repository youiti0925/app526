import { NextRequest, NextResponse } from "next/server";
import { getTemplate } from "@/lib/hustle/templates";
import { generateJson, hasApiKey, describeAiError } from "@/lib/hustle/ai";

interface Variant {
  angle: string;
  subject: string;
  body: string;
}

/**
 * テンプレートに沿って成果物の初稿を生成する。
 * APIキーが無い / 無料枠切れの場合でも、穴埋め雛形を 200 で返す。
 * 「今日は生成できないので何もできません」という状態を作らないため。
 */
export async function POST(request: NextRequest) {
  try {
    const { templateId, values = {}, count = 3 } = await request.json();

    const template = getTemplate(templateId);
    if (!template) {
      return NextResponse.json({ error: "テンプレートが見つかりません" }, { status: 400 });
    }

    const missing = template.fields
      .filter((f) => f.required && !String(values[f.name] ?? "").trim())
      .map((f) => f.label);
    if (missing.length > 0) {
      return NextResponse.json({ error: `必須項目が未入力です: ${missing.join(" / ")}` }, { status: 400 });
    }

    const variantCount = Math.max(1, Math.min(3, Number(count) || 1));

    if (!hasApiKey()) {
      return NextResponse.json({
        variants: [{ angle: "雛形", subject: template.name, body: template.fallback(values) }],
        aiUsed: false,
        notice:
          "APIキーが未設定のため、穴埋め式の雛形を返しました。設定画面で無料のGemini APIキーを登録すると、案件ごとに書き分けた初稿が3案生成されます。",
        manualMinutes: template.manualMinutes,
      });
    }

    try {
      const result = await generateJson<{ variants: Variant[] }>(
        template.buildPrompt(values, variantCount),
        { temperature: 0.8, maxOutputTokens: 8192 }
      );

      const variants = (result?.variants ?? []).filter((x) => x && typeof x.body === "string" && x.body.trim());

      if (variants.length === 0) {
        return NextResponse.json({
          variants: [{ angle: "雛形", subject: template.name, body: template.fallback(values) }],
          aiUsed: false,
          notice: "AIの応答を解釈できなかったため、雛形を返しました。もう一度試すと生成される場合があります。",
          manualMinutes: template.manualMinutes,
        });
      }

      return NextResponse.json({ variants, aiUsed: true, manualMinutes: template.manualMinutes });
    } catch (error) {
      const described = describeAiError(error);
      // 生成に失敗しても、手が止まらないよう雛形は返す
      return NextResponse.json({
        variants: [{ angle: "雛形", subject: template.name, body: template.fallback(values) }],
        aiUsed: false,
        notice: `${described.message} 代わりに雛形を返しました。`,
        manualMinutes: template.manualMinutes,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
