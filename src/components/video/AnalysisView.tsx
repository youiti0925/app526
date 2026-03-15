"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Brain,
  ScanSearch,
  Type,
  Wrench,
  Zap,
  CheckCircle2,
  Loader2,
  Lightbulb,
  Eye,
  Clock,
  BarChart,
  AlertCircle,
  Settings,
} from "lucide-react";
import type { AnalysisResult, DetectedScene, StepCategory } from "@/types";
import { extractFramesFromVideo } from "@/lib/video-utils";
import { transcribeVideoAudio, isSpeechRecognitionAvailable } from "@/lib/audio-utils";
import { fetchSettings } from "@/lib/settings";
import { formatGlossaryForPrompt } from "@/lib/glossary";
import type { VideoContext } from "@/components/video/VideoUploader";

interface AnalysisViewProps {
  analysisResult: AnalysisResult | null;
  isAnalyzing: boolean;
  onAnalysisComplete: (result: AnalysisResult) => void;
  onStartAnalysis: () => void;
  onSceneClick?: (scene: DetectedScene) => void;
  videoFile?: File | null;
  projectName?: string;
  projectCategory?: string;
  videoContext?: VideoContext | null;
}

const categoryLabels: Record<StepCategory, { label: string; color: string }> = {
  preparation: { label: "準備", color: "#3b82f6" },
  operation: { label: "操作", color: "#8b5cf6" },
  inspection: { label: "検査", color: "#06b6d4" },
  measurement: { label: "測定", color: "#f59e0b" },
  adjustment: { label: "調整", color: "#f97316" },
  cleanup: { label: "後片付け", color: "#64748b" },
  "safety-check": { label: "安全確認", color: "#ef4444" },
};

const analysisStages = [
  { label: "動画の前処理", icon: ScanSearch, key: "preprocessing" },
  { label: "フレーム抽出", icon: Eye, key: "frame_extraction" },
  { label: "音声文字起こし", icon: Type, key: "transcription" },
  { label: "AI分析中", icon: Brain, key: "ai_analysis" },
  { label: "結果構成", icon: Zap, key: "structuring" },
];

export default function AnalysisView({
  analysisResult,
  isAnalyzing,
  onAnalysisComplete,
  onStartAnalysis,
  onSceneClick,
  videoFile,
  projectName,
  projectCategory,
  videoContext,
}: AnalysisViewProps) {
  const [currentStage, setCurrentStage] = useState(0);
  const [completedStages, setCompletedStages] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stageMessage, setStageMessage] = useState("");

  const runAnalysis = useCallback(async () => {
    if (!videoFile) {
      setError("動画ファイルが見つかりません。動画をアップロードしてから分析を開始してください。");
      return;
    }

    const settings = await fetchSettings();
    if (!settings.geminiApiKey) {
      setError("Gemini APIキーが設定されていません。左メニューの「設定」からAPIキーを入力してください。");
      return;
    }

    setError(null);
    setCompletedStages([]);

    try {
      // Stage 0: Preprocessing
      setCurrentStage(0);
      setStageMessage("動画を読み込んでいます...");
      await new Promise((r) => setTimeout(r, 500));
      setCompletedStages([0]);

      // Stage 1: Frame extraction
      setCurrentStage(1);
      setStageMessage("動画からフレームを抽出中...");
      const frames = await extractFramesFromVideo(videoFile, {
        maxFrames: 8,
        maxWidth: 1024,
        quality: 0.7,
      });
      setStageMessage(`${frames.length}フレームを抽出しました`);
      setCompletedStages([0, 1]);

      // Stage 2: Audio transcription
      setCurrentStage(2);
      let transcription = "";
      if (isSpeechRecognitionAvailable()) {
        setStageMessage("音声を文字起こし中...（動画を高速再生しています）");
        try {
          const transcriptionResult = await transcribeVideoAudio(videoFile, {
            language: "ja-JP",
            maxDuration: 120,
            onProgress: (text) => {
              setStageMessage(`文字起こし中: ${text.substring(0, 60)}${text.length > 60 ? "..." : ""}`);
            },
          });
          transcription = transcriptionResult.text;
          setStageMessage(transcription ? `文字起こし完了: ${transcription.length}文字` : "音声が検出されませんでした");
        } catch {
          setStageMessage("音声文字起こしをスキップしました");
        }
      } else {
        setStageMessage("このブラウザでは音声文字起こしに対応していません（スキップ）");
      }
      await new Promise((r) => setTimeout(r, 500));
      setCompletedStages([0, 1, 2]);

      // Stage 3: AI Analysis
      setCurrentStage(3);
      setStageMessage("Gemini AIで分析中...（30秒〜1分かかります）");

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frames: frames.map((f) => ({
            timestamp: f.timestamp,
            dataUrl: f.dataUrl,
          })),
          apiKey: settings.geminiApiKey,
          projectName,
          projectCategory,
          transcription,
          videoContext: videoContext || undefined,
          glossary: formatGlossaryForPrompt() || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `分析に失敗しました (${response.status})`);
      }

      const result = await response.json();
      setCompletedStages([0, 1, 2, 3]);

      // Stage 4: Structuring
      setCurrentStage(4);
      setStageMessage("分析結果を構成中...");
      await new Promise((r) => setTimeout(r, 500));
      setCompletedStages([0, 1, 2, 3, 4]);

      // Complete
      onAnalysisComplete(result as AnalysisResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : "分析中に予期しないエラーが発生しました";
      setError(message);
    }
  }, [videoFile, projectName, projectCategory, onAnalysisComplete]);

  useEffect(() => {
    if (isAnalyzing) {
      runAnalysis();
    }
  }, [isAnalyzing, runAnalysis]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Pre-analysis view
  if (!isAnalyzing && !analysisResult) {
    return (
      <div className="space-y-4">
        {error && (
          <div className="card border-red-200 bg-red-50">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-red-700 font-medium">エラー</p>
                <p className="text-sm text-red-600 mt-1">{error}</p>
                {error.includes("APIキー") && (
                  <a href="/settings" className="inline-flex items-center gap-1 text-sm text-red-700 underline mt-2">
                    <Settings className="w-4 h-4" />
                    設定画面を開く
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="card text-center py-12">
          <Brain className="w-16 h-16 text-blue-500 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-slate-900 mb-2">AI動画分析</h3>
          <p className="text-slate-500 mb-6 max-w-md mx-auto">
            動画からフレームを抽出し、Google Gemini AIが分析して
            作業ステップを自動的に構成します。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
            {analysisStages.map((stage, i) => {
              const Icon = stage.icon;
              return (
                <div key={i} className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-full">
                  <Icon className="w-3.5 h-3.5" />
                  {stage.label}
                </div>
              );
            })}
          </div>

          {!videoFile && (
            <p className="text-sm text-amber-600 mb-4">
              ※ まず「動画」タブで動画をアップロードしてください
            </p>
          )}

          <button
            onClick={onStartAnalysis}
            disabled={!videoFile}
            className="btn-primary text-lg px-8 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="flex items-center gap-2">
              <Zap className="w-5 h-5" />
              AI分析を開始
            </span>
          </button>
        </div>
      </div>
    );
  }

  // Analyzing view
  if (isAnalyzing) {
    return (
      <div className="space-y-4">
        {error && (
          <div className="card border-red-200 bg-red-50">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-red-700 font-medium">分析エラー</p>
                <p className="text-sm text-red-600 mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="flex items-center gap-2 mb-6">
            {error ? (
              <AlertCircle className="w-5 h-5 text-red-500" />
            ) : (
              <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
            )}
            <h3 className="font-bold text-slate-900">
              {error ? "分析が中断されました" : "AI分析実行中..."}
            </h3>
          </div>

          <div className="space-y-4">
            {analysisStages.map((stage, i) => {
              const Icon = stage.icon;
              const isCompleted = completedStages.includes(i);
              const isCurrent = currentStage === i && !error;
              return (
                <div
                  key={i}
                  className={`flex items-center gap-4 p-3 rounded-lg transition-all ${
                    isCurrent ? "bg-blue-50 border border-blue-200" : isCompleted ? "bg-green-50" : "bg-slate-50"
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      isCompleted
                        ? "bg-green-100"
                        : isCurrent
                        ? "bg-blue-100"
                        : "bg-slate-200"
                    }`}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                    ) : isCurrent ? (
                      <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                    ) : (
                      <Icon className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${isCompleted ? "text-green-700" : isCurrent ? "text-blue-700" : "text-slate-500"}`}>
                      {stage.label}
                    </p>
                    {isCurrent && stageMessage && (
                      <p className="text-xs text-blue-500 mt-1">{stageMessage}</p>
                    )}
                  </div>
                  {isCompleted && (
                    <span className="text-xs text-green-600 font-medium">完了</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Analysis Result View
  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <CheckCircle2 className="w-5 h-5 text-green-500" />
          <h3 className="font-bold text-slate-900">分析完了</h3>
          <span className="text-xs text-slate-500 ml-auto">
            処理時間: {analysisResult!.processingTime.toFixed(1)}秒
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-blue-50 rounded-lg">
            <p className="text-2xl font-bold text-blue-600">{analysisResult!.scenes.length}</p>
            <p className="text-xs text-blue-700">検出シーン</p>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <p className="text-2xl font-bold text-green-600">{analysisResult!.suggestedSteps.length}</p>
            <p className="text-xs text-green-700">推奨ステップ</p>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg">
            <p className="text-2xl font-bold text-purple-600">{analysisResult!.ocrTexts.length}</p>
            <p className="text-xs text-purple-700">テキスト検出</p>
          </div>
          <div className="text-center p-3 bg-amber-50 rounded-lg">
            <p className="text-2xl font-bold text-amber-600">{analysisResult!.detectedTools.length}</p>
            <p className="text-xs text-amber-700">検出工具</p>
          </div>
        </div>
      </div>

      {/* Detected Scenes */}
      <div className="card">
        <h4 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Eye className="w-5 h-5 text-blue-500" />
          検出されたシーン
        </h4>
        <div className="space-y-3">
          {analysisResult!.scenes.map((scene, i) => {
            const cat = categoryLabels[scene.category] || categoryLabels.operation;
            return (
              <div
                key={scene.id}
                className="flex items-center gap-4 p-3 rounded-lg border hover:bg-slate-50 cursor-pointer transition-colors"
                style={{ borderColor: "var(--card-border)" }}
                onClick={() => onSceneClick?.(scene)}
              >
                <div className="w-24 h-16 rounded-lg bg-slate-200 flex items-center justify-center flex-shrink-0 text-xs text-slate-500 relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-slate-200 to-slate-300" />
                  <span className="relative z-10">Scene {i + 1}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="badge text-xs"
                      style={{ background: cat.color + "20", color: cat.color }}
                    >
                      {cat.label}
                    </span>
                    <span className="text-xs text-slate-400">
                      {formatTime(scene.startTime)} - {formatTime(scene.endTime)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700">{scene.description}</p>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1">
                    <BarChart className="w-3 h-3 text-slate-400" />
                    <span className="text-xs text-slate-500">
                      {Math.round(scene.confidence * 100)}%
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detected Tools & OCR */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <h4 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
            <Wrench className="w-5 h-5 text-amber-500" />
            検出された工具・器具
          </h4>
          <div className="flex flex-wrap gap-2">
            {analysisResult!.detectedTools.map((tool, i) => (
              <span key={i} className="badge badge-info">
                {tool}
              </span>
            ))}
          </div>
        </div>

        <div className="card">
          <h4 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
            <Type className="w-5 h-5 text-purple-500" />
            検出されたテキスト（OCR）
          </h4>
          <div className="space-y-2">
            {analysisResult!.ocrTexts.map((ocr, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-xs text-slate-400 tabular-nums">
                  {formatTime(ocr.timestamp)}
                </span>
                <span className="text-slate-700 font-mono bg-slate-50 px-2 py-0.5 rounded">
                  {ocr.text}
                </span>
                <span className="text-xs text-slate-400">
                  {Math.round(ocr.confidence * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Suggested Steps */}
      <div className="card">
        <h4 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-yellow-500" />
          AI推奨ステップ構成
        </h4>
        <p className="text-sm text-slate-500 mb-4">
          AIが動画分析から推奨する作業ステップです。このまま作業標準書に適用できます。
        </p>
        <div className="relative">
          {analysisResult!.suggestedSteps.map((step, i) => {
            const cat = categoryLabels[step.category] || categoryLabels.operation;
            return (
              <div key={i} className="step-card">
                {i < analysisResult!.suggestedSteps.length - 1 && (
                  <div className="timeline-connector" />
                )}
                <div className="step-number">{i + 1}</div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <h5 className="font-bold text-slate-900">{step.title}</h5>
                    <span
                      className="badge text-xs"
                      style={{ background: cat.color + "20", color: cat.color }}
                    >
                      {cat.label}
                    </span>
                    <span className="text-xs text-slate-400 ml-auto flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatTime(step.startTime)} - {formatTime(step.endTime)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 mb-2">{step.description}</p>
                  {step.keyPoints.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {step.keyPoints.map((kp, j) => (
                        <span key={j} className="text-xs bg-yellow-50 text-yellow-700 px-2 py-1 rounded">
                          {kp}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
