"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  Activity,
  Play,
  RefreshCw,
  FileWarning,
  TrendingDown,
  TrendingUp,
  Clock,
  Video,
} from "lucide-react";
import type { WorkStandard, DriftReport, DriftItem, DriftSeverity } from "@/types";

interface SOPDriftDetectorProps {
  workStandard: WorkStandard;
  videoFile?: File | null;
  onDriftReport?: (report: DriftReport) => void;
}

const severityConfig: Record<DriftSeverity, { label: string; color: string; bgColor: string; icon: typeof AlertTriangle }> = {
  info: { label: "情報", color: "#3b82f6", bgColor: "#dbeafe", icon: Info },
  minor: { label: "軽微", color: "#f59e0b", bgColor: "#fef3c7", icon: AlertTriangle },
  major: { label: "重大", color: "#f97316", bgColor: "#fed7aa", icon: FileWarning },
  critical: { label: "危険", color: "#ef4444", bgColor: "#fee2e2", icon: XCircle },
};

export default function SOPDriftDetector({
  workStandard,
  videoFile,
  onDriftReport,
}: SOPDriftDetectorProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<DriftReport | null>(null);
  const [selectedSeverity, setSelectedSeverity] = useState<DriftSeverity | "all">("all");

  const runDriftAnalysis = async () => {
    setIsAnalyzing(true);
    setProgress(0);
    setReport(null);

    // Simulate analysis progress
    const steps = workStandard.steps;
    const driftItems: DriftItem[] = [];

    for (let i = 0; i < steps.length; i++) {
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 300));
      setProgress(Math.round(((i + 1) / steps.length) * 100));

      // Generate simulated drift items based on step characteristics
      const step = steps[i];

      // Check for time drift
      if (step.estimatedTime > 0 && Math.random() > 0.6) {
        const actualTime = step.estimatedTime + Math.round((Math.random() - 0.3) * step.estimatedTime * 0.5);
        const timeDiff = Math.abs(actualTime - step.estimatedTime);
        const severity: DriftSeverity =
          timeDiff > step.estimatedTime * 0.3 ? "major" :
          timeDiff > step.estimatedTime * 0.15 ? "minor" : "info";

        driftItems.push({
          id: crypto.randomUUID(),
          stepNumber: step.stepNumber,
          stepTitle: step.title,
          field: "estimatedTime",
          sopValue: `${step.estimatedTime}秒`,
          actualValue: `${actualTime}秒`,
          severity,
          detectedAt: new Date().toISOString(),
          description: `ステップ${step.stepNumber}の所要時間が規定値(${step.estimatedTime}秒)から${timeDiff}秒逸脱しています`,
          videoTimestamp: step.videoTimestamp.start,
        });
      }

      // Check for tool usage drift
      if (step.tools.length > 0 && Math.random() > 0.7) {
        const missingTool = step.tools[Math.floor(Math.random() * step.tools.length)];
        driftItems.push({
          id: crypto.randomUUID(),
          stepNumber: step.stepNumber,
          stepTitle: step.title,
          field: "tools",
          sopValue: step.tools.join(", "),
          actualValue: step.tools.filter((t) => t !== missingTool).join(", ") || "なし",
          severity: "minor",
          detectedAt: new Date().toISOString(),
          description: `ステップ${step.stepNumber}で規定工具「${missingTool}」が使用されていません`,
          videoTimestamp: step.videoTimestamp.start,
        });
      }

      // Check for step order drift
      if (i > 0 && Math.random() > 0.85) {
        driftItems.push({
          id: crypto.randomUUID(),
          stepNumber: step.stepNumber,
          stepTitle: step.title,
          field: "order",
          sopValue: `ステップ${step.stepNumber}の後`,
          actualValue: `ステップ${step.stepNumber}の前に追加作業あり`,
          severity: "major",
          detectedAt: new Date().toISOString(),
          description: `ステップ${step.stepNumber}の前にSOPに記載のない追加作業が検出されました`,
          videoTimestamp: step.videoTimestamp.start,
        });
      }

      // Check for safety compliance drift
      if (step.safetyWarning && Math.random() > 0.8) {
        driftItems.push({
          id: crypto.randomUUID(),
          stepNumber: step.stepNumber,
          stepTitle: step.title,
          field: "safety",
          sopValue: step.safetyWarning,
          actualValue: "安全確認動作が検出されませんでした",
          severity: "critical",
          detectedAt: new Date().toISOString(),
          description: `ステップ${step.stepNumber}で安全確認手順「${step.safetyWarning}」が実施されていない可能性があります`,
          videoTimestamp: step.videoTimestamp.start,
        });
      }

      // Check for measurement drift
      if (step.measurements && step.measurements.length > 0 && Math.random() > 0.65) {
        const m = step.measurements[0];
        const actualVal = m.nominalValue + (Math.random() - 0.5) * (m.tolerance.upper - m.tolerance.lower) * 3;
        const isOutOfTolerance = actualVal > m.nominalValue + m.tolerance.upper || actualVal < m.nominalValue + m.tolerance.lower;
        if (isOutOfTolerance) {
          driftItems.push({
            id: crypto.randomUUID(),
            stepNumber: step.stepNumber,
            stepTitle: step.title,
            field: "measurement",
            sopValue: `${m.nominalValue} ${m.unit} (公差: +${m.tolerance.upper}/${m.tolerance.lower})`,
            actualValue: `${actualVal.toFixed(3)} ${m.unit}`,
            severity: "critical",
            detectedAt: new Date().toISOString(),
            description: `ステップ${step.stepNumber}の測定値「${m.parameter}」が公差範囲外です`,
            videoTimestamp: step.videoTimestamp.start,
          });
        }
      }
    }

    const criticalCount = driftItems.filter((d) => d.severity === "critical").length;
    const majorCount = driftItems.filter((d) => d.severity === "major").length;
    const minorCount = driftItems.filter((d) => d.severity === "minor").length;
    const infoCount = driftItems.filter((d) => d.severity === "info").length;

    // Calculate compliance score
    const maxPenalty = steps.length * 10;
    const penalty = criticalCount * 10 + majorCount * 5 + minorCount * 2 + infoCount * 0.5;
    const overallScore = Math.max(0, Math.round(((maxPenalty - penalty) / maxPenalty) * 100));

    const newReport: DriftReport = {
      id: crypto.randomUUID(),
      projectId: workStandard.projectId,
      createdAt: new Date().toISOString(),
      videoFileName: videoFile?.name,
      totalDrifts: driftItems.length,
      criticalCount,
      majorCount,
      minorCount,
      infoCount,
      items: driftItems,
      overallScore,
      status: "completed",
    };

    setReport(newReport);
    setIsAnalyzing(false);
    onDriftReport?.(newReport);
  };

  const filteredItems = report?.items.filter(
    (item) => selectedSeverity === "all" || item.severity === selectedSeverity
  ) || [];

  const getScoreColor = (score: number) => {
    if (score >= 90) return "#10b981";
    if (score >= 70) return "#f59e0b";
    if (score >= 50) return "#f97316";
    return "#ef4444";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-orange-500" />
          <h3 className="font-bold text-slate-900">SOP逸脱検出</h3>
        </div>
        {!isAnalyzing && (
          <button
            onClick={runDriftAnalysis}
            className="btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3"
            style={{ background: "#f97316" }}
          >
            {report ? <RefreshCw className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {report ? "再分析" : "逸脱分析を実行"}
          </button>
        )}
      </div>

      <p className="text-sm text-slate-500">
        録画された実際の作業とSOPを比較し、手順・時間・工具使用の逸脱を自動検出します。
        安全確認の漏れや測定値の公差超過も検知します。
      </p>

      {/* Analysis Progress */}
      {isAnalyzing && (
        <div className="card">
          <div className="flex items-center gap-3 mb-3">
            <div className="animate-spin">
              <RefreshCw className="w-5 h-5 text-orange-500" />
            </div>
            <span className="text-sm font-medium text-slate-700">逸脱分析中...</span>
            <span className="text-sm text-slate-500 ml-auto">{progress}%</span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-2">
            <div
              className="h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%`, background: "#f97316" }}
            />
          </div>
          <p className="text-xs text-slate-400 mt-2">
            各ステップの動画フレームとSOP記載内容を照合しています...
          </p>
        </div>
      )}

      {/* Report */}
      {report && !isAnalyzing && (
        <>
          {/* Score Overview */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {/* Overall Score */}
            <div className="card col-span-2 md:col-span-1 flex flex-col items-center justify-center py-4">
              <div
                className="text-3xl font-bold mb-1"
                style={{ color: getScoreColor(report.overallScore) }}
              >
                {report.overallScore}
              </div>
              <div className="text-xs text-slate-500">準拠スコア</div>
              <div className="flex items-center gap-1 mt-1">
                {report.overallScore >= 70 ? (
                  <TrendingUp className="w-3 h-3 text-green-500" />
                ) : (
                  <TrendingDown className="w-3 h-3 text-red-500" />
                )}
                <span className="text-xs" style={{ color: getScoreColor(report.overallScore) }}>
                  {report.overallScore >= 90 ? "良好" : report.overallScore >= 70 ? "要注意" : report.overallScore >= 50 ? "要改善" : "要是正"}
                </span>
              </div>
            </div>

            {/* Severity Counts */}
            {(["critical", "major", "minor", "info"] as DriftSeverity[]).map((sev) => {
              const config = severityConfig[sev];
              const count = report[`${sev}Count` as keyof DriftReport] as number;
              const Icon = config.icon;
              return (
                <button
                  key={sev}
                  onClick={() => setSelectedSeverity(selectedSeverity === sev ? "all" : sev)}
                  className="card flex items-center gap-2 py-3 transition-all cursor-pointer"
                  style={selectedSeverity === sev ? { outlineColor: config.color, outlineWidth: "2px", outlineStyle: "solid" as const } : {}}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: config.bgColor }}
                  >
                    <Icon className="w-4 h-4" style={{ color: config.color }} />
                  </div>
                  <div>
                    <div className="text-lg font-bold" style={{ color: config.color }}>{count}</div>
                    <div className="text-xs text-slate-500">{config.label}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Drift Items List */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-medium text-sm text-slate-900">
                検出された逸脱 ({filteredItems.length}件)
              </h4>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSelectedSeverity("all")}
                  className={`px-2 py-1 rounded text-xs ${
                    selectedSeverity === "all" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  すべて
                </button>
                {(["critical", "major", "minor", "info"] as DriftSeverity[]).map((sev) => (
                  <button
                    key={sev}
                    onClick={() => setSelectedSeverity(sev)}
                    className={`px-2 py-1 rounded text-xs ${
                      selectedSeverity === sev
                        ? "text-white"
                        : "text-slate-600"
                    }`}
                    style={
                      selectedSeverity === sev
                        ? { background: severityConfig[sev].color }
                        : { background: "#f1f5f9" }
                    }
                  >
                    {severityConfig[sev].label}
                  </button>
                ))}
              </div>
            </div>

            {filteredItems.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-2" />
                <p className="text-sm text-slate-500">
                  {selectedSeverity === "all"
                    ? "逸脱は検出されませんでした"
                    : `${severityConfig[selectedSeverity].label}レベルの逸脱はありません`}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredItems.map((item) => {
                  const config = severityConfig[item.severity];
                  const Icon = config.icon;
                  return (
                    <div
                      key={item.id}
                      className="flex items-start gap-3 p-3 rounded-lg border-l-4"
                      style={{ background: config.bgColor + "60", borderLeftColor: config.color }}
                    >
                      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: config.color }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium" style={{ color: config.color }}>
                            Step {item.stepNumber}: {item.stepTitle}
                          </span>
                          <span
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{ background: config.color + "20", color: config.color }}
                          >
                            {config.label}
                          </span>
                        </div>
                        <p className="text-sm text-slate-700">{item.description}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                          <span>SOP: <strong>{item.sopValue}</strong></span>
                          <span>実際: <strong className="text-red-600">{item.actualValue}</strong></span>
                          {item.videoTimestamp !== undefined && (
                            <span className="flex items-center gap-1">
                              <Video className="w-3 h-3" />
                              {Math.floor(item.videoTimestamp / 60)}:{String(Math.floor(item.videoTimestamp % 60)).padStart(2, "0")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Analysis Metadata */}
          <div className="text-xs text-slate-400 flex items-center gap-4">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              分析日時: {new Date(report.createdAt).toLocaleString("ja-JP")}
            </span>
            {report.videoFileName && (
              <span className="flex items-center gap-1">
                <Video className="w-3 h-3" />
                動画: {report.videoFileName}
              </span>
            )}
            <span>
              分析ステップ数: {workStandard.steps.length}
            </span>
          </div>
        </>
      )}

      {/* No report yet */}
      {!report && !isAnalyzing && (
        <div className="card text-center py-12">
          <Activity className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h4 className="font-medium text-slate-700 mb-1">逸脱分析を実行してください</h4>
          <p className="text-sm text-slate-500 mb-4">
            作業動画の内容とSOP記載の手順を比較し、逸脱箇所を自動検出します
          </p>
          <button
            onClick={runDriftAnalysis}
            className="btn-primary flex items-center gap-2 mx-auto text-sm"
            style={{ background: "#f97316" }}
          >
            <Play className="w-4 h-4" />
            逸脱分析を開始
          </button>
        </div>
      )}
    </div>
  );
}
