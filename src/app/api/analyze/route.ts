import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const ANALYSIS_PROMPT = `あなたは製造業の作業分析エキスパートです。
動画から抽出されたフレーム画像を分析し、作業手順を構造化してください。

以下の情報を抽出してJSON形式で返してください:

{
  "scenes": [
    {
      "id": "scene-1",
      "startTime": 0,
      "endTime": 30,
      "description": "シーンの説明",
      "confidence": 0.95,
      "category": "preparation|operation|inspection|measurement|adjustment|cleanup|safety-check"
    }
  ],
  "ocrTexts": [
    {
      "timestamp": 10,
      "text": "検出されたテキスト",
      "confidence": 0.9
    }
  ],
  "detectedTools": ["工具名1", "工具名2"],
  "detectedActions": ["動作1", "動作2"],
  "suggestedSteps": [
    {
      "title": "ステップのタイトル",
      "description": "ステップの詳細説明",
      "keyPoints": ["重要ポイント1", "重要ポイント2"],
      "startTime": 0,
      "endTime": 30,
      "category": "preparation|operation|inspection|measurement|adjustment|cleanup|safety-check",
      "confidence": 0.9,
      "detailedInstructions": "詳細な作業指示",
      "cautions": ["注意点1"],
      "tools": ["使用工具1"],
      "estimatedTime": 60,
      "measurements": [
        {
          "parameter": "測定項目",
          "nominalValue": 0,
          "toleranceUpper": 0.01,
          "toleranceLower": -0.01,
          "unit": "mm",
          "instrument": "測定器具"
        }
      ]
    }
  ],
  "safetyNotes": [
    {
      "severity": "info|caution|warning|danger",
      "title": "安全注意事項のタイトル",
      "description": "詳細説明",
      "relatedSteps": [1, 2]
    }
  ],
  "qualityCheckpoints": [
    {
      "stepNumber": 1,
      "checkItem": "確認項目",
      "method": "確認方法",
      "standard": "基準",
      "acceptanceCriteria": "合格基準",
      "measuringInstrument": "測定器具",
      "frequency": "確認頻度",
      "recordRequired": true
    }
  ],
  "toolsRequired": [
    {
      "name": "工具名",
      "specification": "仕様",
      "quantity": 1,
      "category": "measuring|hand-tool|power-tool|fixture|consumable|ppe"
    }
  ],
  "header": {
    "processName": "工程名",
    "requiredSkillLevel": "beginner|intermediate|advanced|expert",
    "requiredPPE": ["安全装備1"],
    "prerequisites": ["前提条件1"]
  }
}

各フレームのタイムスタンプ情報を考慮して、作業の流れを時系列で分析してください。
画像内のテキスト（計器の数値、ラベル、表示など）も可能な限り読み取ってください。
製造業の安全基準と品質管理の観点から、注意事項と品質チェックポイントも提案してください。
JSONのみを返してください。マークダウンのコードブロックは使わないでください。`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { frames, apiKey, projectName, projectCategory } = body;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Gemini APIキーが設定されていません。設定画面からAPIキーを入力してください。" },
        { status: 400 }
      );
    }

    if (!frames || frames.length === 0) {
      return NextResponse.json(
        { error: "分析する動画フレームがありません。" },
        { status: 400 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    // Build the content parts with frame images
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    // Add context about the project
    let contextPrompt = ANALYSIS_PROMPT;
    if (projectName) {
      contextPrompt += `\n\nプロジェクト名: ${projectName}`;
    }
    if (projectCategory) {
      contextPrompt += `\nカテゴリ: ${projectCategory}`;
    }

    parts.push({ text: contextPrompt });

    // Add frame images with timestamps
    for (const frame of frames) {
      parts.push({
        text: `\n--- フレーム (タイムスタンプ: ${frame.timestamp.toFixed(1)}秒) ---`,
      });

      // Extract base64 data from data URL
      const base64Data = frame.dataUrl.replace(/^data:image\/\w+;base64,/, "");
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Data,
        },
      });
    }

    const result = await model.generateContent(parts);
    const response = result.response;
    const text = response.text();

    // Parse the JSON response
    let analysisData;
    try {
      // Try to extract JSON from the response (handle potential markdown wrapping)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("JSONが見つかりません");
      }
    } catch {
      return NextResponse.json(
        { error: "AIの応答を解析できませんでした。再度お試しください。", rawResponse: text },
        { status: 500 }
      );
    }

    // Normalize the response to match our types
    const normalizedResult = normalizeAnalysisResult(analysisData);

    return NextResponse.json(normalizedResult);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "不明なエラー";

    if (message.includes("API_KEY_INVALID") || message.includes("401")) {
      return NextResponse.json(
        { error: "APIキーが無効です。正しいGemini APIキーを設定してください。" },
        { status: 401 }
      );
    }

    if (message.includes("429") || message.includes("RESOURCE_EXHAUSTED")) {
      return NextResponse.json(
        { error: "APIの利用制限に達しました。しばらく待ってから再度お試しください。" },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: `分析中にエラーが発生しました: ${message}` },
      { status: 500 }
    );
  }
}

function normalizeAnalysisResult(data: Record<string, unknown>) {
  const scenes = Array.isArray(data.scenes)
    ? data.scenes.map((s: Record<string, unknown>, i: number) => ({
        id: (s.id as string) || `scene-${i + 1}`,
        startTime: Number(s.startTime) || 0,
        endTime: Number(s.endTime) || 0,
        description: String(s.description || ""),
        confidence: Number(s.confidence) || 0.8,
        thumbnailUrl: "",
        category: validateCategory(s.category as string),
      }))
    : [];

  const ocrTexts = Array.isArray(data.ocrTexts)
    ? data.ocrTexts.map((o: Record<string, unknown>) => ({
        timestamp: Number(o.timestamp) || 0,
        text: String(o.text || ""),
        boundingBox: { x: 0, y: 0, width: 100, height: 20 },
        confidence: Number(o.confidence) || 0.8,
      }))
    : [];

  const detectedTools = Array.isArray(data.detectedTools)
    ? data.detectedTools.map(String)
    : [];

  const detectedActions = Array.isArray(data.detectedActions)
    ? data.detectedActions.map(String)
    : [];

  const suggestedSteps = Array.isArray(data.suggestedSteps)
    ? data.suggestedSteps.map((s: Record<string, unknown>) => ({
        title: String(s.title || ""),
        description: String(s.description || ""),
        keyPoints: Array.isArray(s.keyPoints) ? s.keyPoints.map(String) : [],
        startTime: Number(s.startTime) || 0,
        endTime: Number(s.endTime) || 0,
        category: validateCategory(s.category as string),
        confidence: Number(s.confidence) || 0.8,
        // Extended fields for work standard generation
        detailedInstructions: String(s.detailedInstructions || s.description || ""),
        cautions: Array.isArray(s.cautions) ? s.cautions.map(String) : [],
        tools: Array.isArray(s.tools) ? s.tools.map(String) : [],
        estimatedTime: Number(s.estimatedTime) || 60,
        measurements: Array.isArray(s.measurements)
          ? s.measurements.map((m: Record<string, unknown>) => ({
              parameter: String(m.parameter || ""),
              nominalValue: Number(m.nominalValue) || 0,
              tolerance: {
                upper: Number(m.toleranceUpper ?? m.tolerance_upper ?? 0),
                lower: Number(m.toleranceLower ?? m.tolerance_lower ?? 0),
              },
              unit: String(m.unit || ""),
              instrument: String(m.instrument || ""),
            }))
          : [],
      }))
    : [];

  const processingTime = scenes.length * 2 + suggestedSteps.length * 3;

  // Extended data for work standard generation
  const safetyNotes = Array.isArray(data.safetyNotes) ? data.safetyNotes : [];
  const qualityCheckpoints = Array.isArray(data.qualityCheckpoints) ? data.qualityCheckpoints : [];
  const toolsRequired = Array.isArray(data.toolsRequired) ? data.toolsRequired : [];
  const header = data.header || {};

  return {
    scenes,
    ocrTexts,
    detectedTools,
    detectedActions,
    suggestedSteps,
    processingTime,
    // Extended data
    safetyNotes,
    qualityCheckpoints,
    toolsRequired,
    header,
  };
}

const validCategories = [
  "preparation", "operation", "inspection",
  "measurement", "adjustment", "cleanup", "safety-check",
];

function validateCategory(category: string): string {
  return validCategories.includes(category) ? category : "operation";
}
