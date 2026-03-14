"use client";

import { useState, useMemo } from "react";
import {
  GitCompare,
  Plus,
  Minus,
  Edit3,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Clock,
  User,
  FileText,
} from "lucide-react";
import type { WorkStandard, StepDiff, RevisionSnapshot } from "@/types";

interface RevisionDiffViewerProps {
  workStandard: WorkStandard;
}

const SNAPSHOTS_KEY = "videosop-revision-snapshots";

function loadSnapshots(projectId: string): RevisionSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const all = JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || "{}");
    return (all[projectId] || []) as RevisionSnapshot[];
  } catch {
    return [];
  }
}

function saveSnapshot(projectId: string, snapshot: RevisionSnapshot) {
  if (typeof window === "undefined") return;
  const all = JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || "{}");
  if (!all[projectId]) all[projectId] = [];
  all[projectId].push(snapshot);
  localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(all));
}

function computeDiffs(oldWS: WorkStandard, newWS: WorkStandard): StepDiff[] {
  const diffs: StepDiff[] = [];

  // Compare header fields
  const headerFields: { key: keyof typeof oldWS.header; label: string }[] = [
    { key: "processName", label: "工程名" },
    { key: "machineName", label: "機械名" },
    { key: "machineModel", label: "型式" },
    { key: "department", label: "部門" },
    { key: "requiredSkillLevel", label: "必要スキルレベル" },
  ];

  headerFields.forEach(({ key, label }) => {
    const oldVal = String(oldWS.header[key] || "");
    const newVal = String(newWS.header[key] || "");
    if (oldVal !== newVal) {
      diffs.push({
        stepNumber: 0,
        field: label,
        oldValue: oldVal,
        newValue: newVal,
        changeType: "modified",
      });
    }
  });

  // Compare steps
  const oldStepsMap = new Map(oldWS.steps.map((s) => [s.id, s]));
  const newStepsMap = new Map(newWS.steps.map((s) => [s.id, s]));

  // Added steps
  newWS.steps.forEach((newStep) => {
    if (!oldStepsMap.has(newStep.id)) {
      diffs.push({
        stepNumber: newStep.stepNumber,
        field: "ステップ追加",
        oldValue: "",
        newValue: newStep.title,
        changeType: "added",
      });
    }
  });

  // Removed steps
  oldWS.steps.forEach((oldStep) => {
    if (!newStepsMap.has(oldStep.id)) {
      diffs.push({
        stepNumber: oldStep.stepNumber,
        field: "ステップ削除",
        oldValue: oldStep.title,
        newValue: "",
        changeType: "removed",
      });
    }
  });

  // Modified steps
  newWS.steps.forEach((newStep) => {
    const oldStep = oldStepsMap.get(newStep.id);
    if (!oldStep) return;

    if (oldStep.title !== newStep.title) {
      diffs.push({
        stepNumber: newStep.stepNumber,
        field: "タイトル",
        oldValue: oldStep.title,
        newValue: newStep.title,
        changeType: "modified",
      });
    }
    if (oldStep.description !== newStep.description) {
      diffs.push({
        stepNumber: newStep.stepNumber,
        field: "説明",
        oldValue: oldStep.description,
        newValue: newStep.description,
        changeType: "modified",
      });
    }
    if (oldStep.detailedInstructions !== newStep.detailedInstructions) {
      diffs.push({
        stepNumber: newStep.stepNumber,
        field: "詳細手順",
        oldValue: oldStep.detailedInstructions.substring(0, 100) + (oldStep.detailedInstructions.length > 100 ? "..." : ""),
        newValue: newStep.detailedInstructions.substring(0, 100) + (newStep.detailedInstructions.length > 100 ? "..." : ""),
        changeType: "modified",
      });
    }
    if (JSON.stringify(oldStep.keyPoints) !== JSON.stringify(newStep.keyPoints)) {
      diffs.push({
        stepNumber: newStep.stepNumber,
        field: "ポイント",
        oldValue: oldStep.keyPoints.join("; "),
        newValue: newStep.keyPoints.join("; "),
        changeType: "modified",
      });
    }
    if (JSON.stringify(oldStep.cautions) !== JSON.stringify(newStep.cautions)) {
      diffs.push({
        stepNumber: newStep.stepNumber,
        field: "注意事項",
        oldValue: oldStep.cautions.join("; "),
        newValue: newStep.cautions.join("; "),
        changeType: "modified",
      });
    }
    if (oldStep.estimatedTime !== newStep.estimatedTime) {
      diffs.push({
        stepNumber: newStep.stepNumber,
        field: "所要時間",
        oldValue: `${oldStep.estimatedTime}秒`,
        newValue: `${newStep.estimatedTime}秒`,
        changeType: "modified",
      });
    }
    if (oldStep.category !== newStep.category) {
      diffs.push({
        stepNumber: newStep.stepNumber,
        field: "カテゴリ",
        oldValue: oldStep.category,
        newValue: newStep.category,
        changeType: "modified",
      });
    }
  });

  // Compare safety notes count
  if (oldWS.safetyNotes.length !== newWS.safetyNotes.length) {
    diffs.push({
      stepNumber: 0,
      field: "安全注意事項",
      oldValue: `${oldWS.safetyNotes.length}件`,
      newValue: `${newWS.safetyNotes.length}件`,
      changeType: newWS.safetyNotes.length > oldWS.safetyNotes.length ? "added" : "removed",
    });
  }

  // Compare quality checkpoints count
  if (oldWS.qualityCheckpoints.length !== newWS.qualityCheckpoints.length) {
    diffs.push({
      stepNumber: 0,
      field: "品質チェックポイント",
      oldValue: `${oldWS.qualityCheckpoints.length}件`,
      newValue: `${newWS.qualityCheckpoints.length}件`,
      changeType: newWS.qualityCheckpoints.length > oldWS.qualityCheckpoints.length ? "added" : "removed",
    });
  }

  return diffs;
}

const changeTypeConfig = {
  added: { label: "追加", icon: Plus, color: "#10b981", bg: "#d1fae5" },
  removed: { label: "削除", icon: Minus, color: "#ef4444", bg: "#fee2e2" },
  modified: { label: "変更", icon: Edit3, color: "#f59e0b", bg: "#fef3c7" },
};

export default function RevisionDiffViewer({ workStandard }: RevisionDiffViewerProps) {
  const [snapshots, setSnapshots] = useState<RevisionSnapshot[]>(() =>
    loadSnapshots(workStandard.projectId)
  );
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [expandedDiffs, setExpandedDiffs] = useState<Set<number>>(new Set());

  const handleSaveSnapshot = () => {
    const snapshot: RevisionSnapshot = {
      id: crypto.randomUUID(),
      version: workStandard.version,
      date: new Date().toISOString(),
      author: "現在のユーザー",
      workStandard: JSON.parse(JSON.stringify(workStandard)),
    };
    saveSnapshot(workStandard.projectId, snapshot);
    setSnapshots([...snapshots, snapshot]);
  };

  const selectedSnapshot = useMemo(
    () => snapshots.find((s) => s.id === selectedSnapshotId),
    [snapshots, selectedSnapshotId]
  );

  const diffs = useMemo(() => {
    if (!selectedSnapshot) return [];
    return computeDiffs(selectedSnapshot.workStandard, workStandard);
  }, [selectedSnapshot, workStandard]);

  const diffsByStep = useMemo(() => {
    const grouped = new Map<number, StepDiff[]>();
    diffs.forEach((d) => {
      const key = d.stepNumber;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(d);
    });
    return grouped;
  }, [diffs]);

  const toggleExpandStep = (stepNum: number) => {
    const newSet = new Set(expandedDiffs);
    if (newSet.has(stepNum)) {
      newSet.delete(stepNum);
    } else {
      newSet.add(stepNum);
    }
    setExpandedDiffs(newSet);
  };

  const addedCount = diffs.filter((d) => d.changeType === "added").length;
  const removedCount = diffs.filter((d) => d.changeType === "removed").length;
  const modifiedCount = diffs.filter((d) => d.changeType === "modified").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <GitCompare className="w-5 h-5 text-cyan-500" />
            改訂比較（Diff表示）
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            過去のバージョンと現在の作業標準書の差分を確認できます
          </p>
        </div>
        <button
          onClick={handleSaveSnapshot}
          className="btn-primary flex items-center gap-1.5 text-sm"
        >
          <FileText className="w-4 h-4" />
          現在のバージョンを保存
        </button>
      </div>

      {snapshots.length === 0 ? (
        <div className="card text-center py-12">
          <GitCompare className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="font-bold text-slate-900 mb-2">バージョン履歴がありません</h3>
          <p className="text-sm text-slate-500 mb-4">
            「現在のバージョンを保存」でスナップショットを作成すると、
            <br />
            以降の変更を差分表示で比較できるようになります。
          </p>
          <button
            onClick={handleSaveSnapshot}
            className="btn-primary text-sm inline-flex items-center gap-1.5"
          >
            <FileText className="w-4 h-4" />
            最初のスナップショットを保存
          </button>
        </div>
      ) : (
        <>
          {/* Version Selector */}
          <div className="card">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">比較元バージョンを選択</h3>
            <div className="space-y-2">
              {snapshots.map((snapshot, i) => {
                const isSelected = selectedSnapshotId === snapshot.id;
                return (
                  <button
                    key={snapshot.id}
                    onClick={() => {
                      setSelectedSnapshotId(snapshot.id);
                      setShowDiff(true);
                      setExpandedDiffs(new Set());
                    }}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                      isSelected
                        ? "border-cyan-500 bg-cyan-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm ${
                        isSelected
                          ? "bg-cyan-100 text-cyan-600"
                          : i === snapshots.length - 1
                          ? "bg-blue-100 text-blue-600"
                          : "bg-slate-200 text-slate-500"
                      }`}
                    >
                      v{snapshot.version}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${isSelected ? "text-cyan-700" : "text-slate-900"}`}>
                        バージョン {snapshot.version}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(snapshot.date).toLocaleString("ja-JP")}
                        </span>
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {snapshot.author}
                        </span>
                      </div>
                    </div>
                    {isSelected && (
                      <span className="badge text-xs" style={{ background: "#cffafe", color: "#0891b2" }}>
                        比較中
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Diff Results */}
          {showDiff && selectedSnapshot && (
            <>
              {/* Summary */}
              <div className="card">
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="badge text-xs" style={{ background: "#d1fae5", color: "#10b981" }}>
                      v{selectedSnapshot.version}
                    </span>
                    <ArrowRight className="w-4 h-4 text-slate-400" />
                    <span className="badge text-xs" style={{ background: "#dbeafe", color: "#3b82f6" }}>
                      v{workStandard.version} (現在)
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="flex items-center gap-3 p-3 rounded-lg" style={{ background: "#d1fae5" }}>
                    <Plus className="w-5 h-5 text-green-600" />
                    <div>
                      <p className="text-lg font-bold text-green-700">{addedCount}</p>
                      <p className="text-xs text-green-600">追加</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg" style={{ background: "#fee2e2" }}>
                    <Minus className="w-5 h-5 text-red-600" />
                    <div>
                      <p className="text-lg font-bold text-red-700">{removedCount}</p>
                      <p className="text-xs text-red-600">削除</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg" style={{ background: "#fef3c7" }}>
                    <Edit3 className="w-5 h-5 text-amber-600" />
                    <div>
                      <p className="text-lg font-bold text-amber-700">{modifiedCount}</p>
                      <p className="text-xs text-amber-600">変更</p>
                    </div>
                  </div>
                </div>

                {diffs.length === 0 && (
                  <div className="text-center py-6 mt-4">
                    <p className="text-sm text-slate-500">差分はありません。変更が検出されませんでした。</p>
                  </div>
                )}
              </div>

              {/* Detailed Diffs */}
              {diffs.length > 0 && (
                <div className="space-y-3">
                  {Array.from(diffsByStep.entries())
                    .sort(([a], [b]) => a - b)
                    .map(([stepNum, stepDiffs]) => {
                      const isExpanded = expandedDiffs.has(stepNum);
                      const label = stepNum === 0 ? "基本情報" : `ステップ ${stepNum}`;

                      return (
                        <div key={stepNum} className="card">
                          <button
                            className="w-full flex items-center gap-3 text-left"
                            onClick={() => toggleExpandStep(stepNum)}
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <h4 className="font-bold text-sm text-slate-900">{label}</h4>
                                <div className="flex items-center gap-1">
                                  {stepDiffs.map((d, i) => {
                                    const config = changeTypeConfig[d.changeType];
                                    return (
                                      <span
                                        key={i}
                                        className="badge text-xs"
                                        style={{ background: config.bg, color: config.color }}
                                      >
                                        {d.field}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-slate-400" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-400" />
                            )}
                          </button>

                          {isExpanded && (
                            <div className="mt-3 pt-3 border-t space-y-3" style={{ borderColor: "var(--card-border)" }}>
                              {stepDiffs.map((diff, i) => {
                                const config = changeTypeConfig[diff.changeType];
                                const Icon = config.icon;

                                return (
                                  <div key={i} className="space-y-1">
                                    <div className="flex items-center gap-2">
                                      <Icon
                                        className="w-4 h-4"
                                        style={{ color: config.color }}
                                      />
                                      <span className="text-xs font-semibold text-slate-500">{diff.field}</span>
                                      <span
                                        className="badge text-xs"
                                        style={{ background: config.bg, color: config.color }}
                                      >
                                        {config.label}
                                      </span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 ml-6">
                                      {diff.oldValue && (
                                        <div className="p-2 rounded text-sm bg-red-50 border border-red-200">
                                          <span className="text-xs text-red-400 block mb-0.5">変更前</span>
                                          <span className="text-red-700 line-through">{diff.oldValue}</span>
                                        </div>
                                      )}
                                      {diff.newValue && (
                                        <div className="p-2 rounded text-sm bg-green-50 border border-green-200">
                                          <span className="text-xs text-green-400 block mb-0.5">変更後</span>
                                          <span className="text-green-700">{diff.newValue}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
