import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getApiKey, getModel } from "@/lib/hustle/ai";

export async function POST(request: NextRequest) {
  try {
    const { apiKey } = await request.json();

    // 入力が空なら保存済みキーを試す（GET がキーを返さなくなったため、
    // 画面のキー欄は保存済みでも空のことがある）。
    const key = (typeof apiKey === "string" && apiKey.trim()) || getApiKey();
    if (!key) {
      return NextResponse.json({ error: "APIキーが必要です" }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: getModel() });

    // Simple test request
    const result = await model.generateContent("Reply with: OK");
    const text = result.response.text();

    return NextResponse.json({ success: true, message: `API接続成功: ${text.substring(0, 50)}` });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "不明なエラー";

    if (message.includes("API_KEY_INVALID") || message.includes("401")) {
      return NextResponse.json({ error: "APIキーが無効です" }, { status: 401 });
    }

    return NextResponse.json({ error: `接続エラー: ${message}` }, { status: 500 });
  }
}
