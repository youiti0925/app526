"use client";

import { useState } from "react";
import {
  GitBranch,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Settings,
  X,
  Copy,
} from "lucide-react";
import type { WorkStep, BranchPoint, StepBranch, BranchCondition } from "@/types";

interface ConditionalBranchEditorProps {
  steps: WorkStep[];
  branchPoints: BranchPoint[];
  onBranchPointsChange: (branchPoints: BranchPoint[]) => void;
}

const operatorLabels: Record<BranchCondition["operator"], string> = {
  equals: "等しい",
  "not-equals": "等しくない",
  includes: "含む",
  "greater-than": "より大きい",
  "less-than": "より小さい",
};

export default function ConditionalBranchEditor({
  steps,
  branchPoints,
  onBranchPointsChange,
}: ConditionalBranchEditorProps) {
  const [expandedBranch, setExpandedBranch] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newBranch, setNewBranch] = useState({
    stepId: "",
    description: "",
    variableName: "",
    variableLabel: "",
  });

  const addBranchPoint = () => {
    if (!newBranch.stepId || !newBranch.variableName) return;

    const bp: BranchPoint = {
      id: crypto.randomUUID(),
      stepId: newBranch.stepId,
      description: newBranch.description || `${newBranch.variableLabel}による分岐`,
      variableName: newBranch.variableName,
      variableLabel: newBranch.variableLabel || newBranch.variableName,
      branches: [],
      defaultBranch: [],
    };

    onBranchPointsChange([...branchPoints, bp]);
    setNewBranch({ stepId: "", description: "", variableName: "", variableLabel: "" });
    setShowAddDialog(false);
    setExpandedBranch(bp.id);
  };

  const removeBranchPoint = (id: string) => {
    onBranchPointsChange(branchPoints.filter((bp) => bp.id !== id));
  };

  const addBranch = (bpId: string) => {
    onBranchPointsChange(
      branchPoints.map((bp) => {
        if (bp.id !== bpId) return bp;
        const newStepBranch: StepBranch = {
          id: crypto.randomUUID(),
          condition: {
            id: crypto.randomUUID(),
            field: bp.variableName,
            operator: "equals",
            value: "",
            label: "",
          },
          steps: [],
        };
        return { ...bp, branches: [...bp.branches, newStepBranch] };
      })
    );
  };

  const updateBranch = (bpId: string, branchId: string, updates: Partial<StepBranch>) => {
    onBranchPointsChange(
      branchPoints.map((bp) => {
        if (bp.id !== bpId) return bp;
        return {
          ...bp,
          branches: bp.branches.map((b) =>
            b.id === branchId ? { ...b, ...updates } : b
          ),
        };
      })
    );
  };

  const removeBranch = (bpId: string, branchId: string) => {
    onBranchPointsChange(
      branchPoints.map((bp) => {
        if (bp.id !== bpId) return bp;
        return { ...bp, branches: bp.branches.filter((b) => b.id !== branchId) };
      })
    );
  };

  const updateCondition = (
    bpId: string,
    branchId: string,
    updates: Partial<BranchCondition>
  ) => {
    onBranchPointsChange(
      branchPoints.map((bp) => {
        if (bp.id !== bpId) return bp;
        return {
          ...bp,
          branches: bp.branches.map((b) =>
            b.id === branchId
              ? { ...b, condition: { ...b.condition, ...updates } }
              : b
          ),
        };
      })
    );
  };

  const toggleStepInBranch = (bpId: string, branchId: string, stepId: string) => {
    onBranchPointsChange(
      branchPoints.map((bp) => {
        if (bp.id !== bpId) return bp;
        return {
          ...bp,
          branches: bp.branches.map((b) => {
            if (b.id !== branchId) return b;
            const has = b.steps.includes(stepId);
            return {
              ...b,
              steps: has ? b.steps.filter((s) => s !== stepId) : [...b.steps, stepId],
            };
          }),
        };
      })
    );
  };

  const getStepTitle = (stepId: string) => {
    const step = steps.find((s) => s.id === stepId);
    return step ? `Step ${step.stepNumber}: ${step.title}` : stepId;
  };

  const getBranchPointStep = (bpStepId: string) => {
    return steps.find((s) => s.id === bpStepId);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-purple-500" />
          <h3 className="font-bold text-slate-900">条件分岐設定</h3>
        </div>
        <button
          onClick={() => setShowAddDialog(true)}
          className="btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3"
        >
          <Plus className="w-4 h-4" />
          分岐ポイント追加
        </button>
      </div>

      <p className="text-sm text-slate-500">
        製品バリエーションや条件に応じて、異なる作業ステップを実行する分岐を設定できます。
        例: コネクタタイプAの場合はステップ3-5、タイプBの場合はステップ3,6-7を実行
      </p>

      {/* Add Branch Point Dialog */}
      {showAddDialog && (
        <div className="border rounded-lg p-4 bg-purple-50" style={{ borderColor: "#c4b5fd" }}>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-bold text-purple-900">新しい分岐ポイント</h4>
            <button onClick={() => setShowAddDialog(false)} className="p-1 hover:bg-purple-100 rounded">
              <X className="w-4 h-4 text-purple-500" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">分岐するステップ *</label>
              <select
                value={newBranch.stepId}
                onChange={(e) => setNewBranch({ ...newBranch, stepId: e.target.value })}
                className="w-full border rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-purple-400"
              >
                <option value="">選択してください</option>
                {steps.map((s) => (
                  <option key={s.id} value={s.id}>
                    Step {s.stepNumber}: {s.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">分岐変数名 *</label>
              <input
                type="text"
                value={newBranch.variableName}
                onChange={(e) => setNewBranch({ ...newBranch, variableName: e.target.value })}
                placeholder="例: connectorType"
                className="w-full border rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-purple-400"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">分岐変数ラベル</label>
              <input
                type="text"
                value={newBranch.variableLabel}
                onChange={(e) => setNewBranch({ ...newBranch, variableLabel: e.target.value })}
                placeholder="例: コネクタタイプ"
                className="w-full border rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-purple-400"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">説明</label>
              <input
                type="text"
                value={newBranch.description}
                onChange={(e) => setNewBranch({ ...newBranch, description: e.target.value })}
                placeholder="例: コネクタタイプによって分岐"
                className="w-full border rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-purple-400"
              />
            </div>
          </div>
          <button
            onClick={addBranchPoint}
            disabled={!newBranch.stepId || !newBranch.variableName}
            className="mt-3 btn-primary text-sm py-1.5 px-4 disabled:opacity-50"
          >
            追加
          </button>
        </div>
      )}

      {/* Branch Points List */}
      {branchPoints.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          <GitBranch className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p>条件分岐はまだ設定されていません</p>
          <p className="text-xs mt-1">製品バリエーションがある場合に分岐を追加してください</p>
        </div>
      ) : (
        <div className="space-y-3">
          {branchPoints.map((bp) => {
            const isExpanded = expandedBranch === bp.id;
            const bpStep = getBranchPointStep(bp.stepId);

            return (
              <div
                key={bp.id}
                className="border rounded-lg bg-white overflow-hidden"
                style={{ borderColor: "var(--card-border)" }}
              >
                {/* Branch Point Header */}
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-slate-50"
                  onClick={() => setExpandedBranch(isExpanded ? null : bp.id)}
                >
                  <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                    <GitBranch className="w-4 h-4 text-purple-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm text-slate-900">{bp.description}</h4>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-slate-500">
                        分岐点: {bpStep ? `Step ${bpStep.stepNumber}` : "不明"}
                      </span>
                      <span className="text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
                        {bp.variableLabel}: {bp.branches.length}パターン
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("この分岐ポイントを削除しますか？")) removeBranchPoint(bp.id);
                    }}
                    className="p-1 hover:bg-red-50 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" />
                  </button>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </div>

                {/* Expanded: Branch Details */}
                {isExpanded && (
                  <div className="border-t p-4 space-y-4" style={{ borderColor: "var(--card-border)" }}>
                    {/* Visual Branch Diagram */}
                    <div className="bg-slate-50 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                          {bpStep ? `Step ${bpStep.stepNumber}: ${bpStep.title}` : "分岐点"}
                        </div>
                        <ArrowRight className="w-4 h-4 text-slate-400" />
                        <div className="px-3 py-1.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">
                          {bp.variableLabel}を確認
                        </div>
                      </div>
                      <div className="ml-8 space-y-2">
                        {bp.branches.map((branch, idx) => (
                          <div key={branch.id} className="flex items-center gap-2">
                            <div className="w-px h-4 bg-purple-300 ml-4" />
                            <ArrowRight className="w-3 h-3 text-purple-400" />
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                              {branch.condition.label || `条件${idx + 1}`}: {branch.condition.value || "未設定"}
                            </span>
                            <ArrowRight className="w-3 h-3 text-slate-400" />
                            <span className="text-xs text-slate-600">
                              {branch.steps.length > 0
                                ? branch.steps.map((sid) => {
                                    const s = steps.find((st) => st.id === sid);
                                    return s ? `Step ${s.stepNumber}` : "";
                                  }).filter(Boolean).join(", ")
                                : "ステップ未選択"}
                            </span>
                          </div>
                        ))}
                        {bp.defaultBranch && bp.defaultBranch.length > 0 && (
                          <div className="flex items-center gap-2">
                            <div className="w-px h-4 bg-slate-300 ml-4" />
                            <ArrowRight className="w-3 h-3 text-slate-400" />
                            <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded">
                              デフォルト
                            </span>
                            <ArrowRight className="w-3 h-3 text-slate-400" />
                            <span className="text-xs text-slate-600">
                              {bp.defaultBranch.map((sid) => {
                                const s = steps.find((st) => st.id === sid);
                                return s ? `Step ${s.stepNumber}` : "";
                              }).filter(Boolean).join(", ")}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Branch Conditions */}
                    {bp.branches.map((branch, idx) => (
                      <div
                        key={branch.id}
                        className="border rounded-lg p-3 space-y-3"
                        style={{ borderColor: "#c4b5fd" }}
                      >
                        <div className="flex items-center justify-between">
                          <h5 className="text-sm font-medium text-purple-800">
                            パターン {idx + 1}
                          </h5>
                          <button
                            onClick={() => removeBranch(bp.id, branch.id)}
                            className="p-1 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="w-3 h-3 text-slate-400 hover:text-red-500" />
                          </button>
                        </div>

                        {/* Condition Editor */}
                        <div className="grid grid-cols-4 gap-2">
                          <div>
                            <label className="text-xs text-slate-500 mb-0.5 block">ラベル</label>
                            <input
                              type="text"
                              value={branch.condition.label}
                              onChange={(e) =>
                                updateCondition(bp.id, branch.id, { label: e.target.value })
                              }
                              placeholder="例: タイプA"
                              className="w-full border rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-purple-400"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-slate-500 mb-0.5 block">条件</label>
                            <select
                              value={branch.condition.operator}
                              onChange={(e) =>
                                updateCondition(bp.id, branch.id, {
                                  operator: e.target.value as BranchCondition["operator"],
                                })
                              }
                              className="w-full border rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-purple-400"
                            >
                              {Object.entries(operatorLabels).map(([val, label]) => (
                                <option key={val} value={val}>{label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-2">
                            <label className="text-xs text-slate-500 mb-0.5 block">値</label>
                            <input
                              type="text"
                              value={branch.condition.value}
                              onChange={(e) =>
                                updateCondition(bp.id, branch.id, { value: e.target.value })
                              }
                              placeholder="例: TypeA"
                              className="w-full border rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-purple-400"
                            />
                          </div>
                        </div>

                        {/* Step Selection */}
                        <div>
                          <label className="text-xs text-slate-500 mb-1 block">
                            この条件で実行するステップを選択
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            {steps.map((s) => {
                              const isSelected = branch.steps.includes(s.id);
                              return (
                                <button
                                  key={s.id}
                                  onClick={() => toggleStepInBranch(bp.id, branch.id, s.id)}
                                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                                    isSelected
                                      ? "bg-purple-500 text-white"
                                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                  }`}
                                >
                                  Step {s.stepNumber}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ))}

                    <button
                      onClick={() => addBranch(bp.id)}
                      className="w-full py-2 border-2 border-dashed rounded-lg text-purple-400 hover:text-purple-600 hover:border-purple-400 transition-colors flex items-center justify-center gap-2 text-sm"
                      style={{ borderColor: "#c4b5fd" }}
                    >
                      <Plus className="w-4 h-4" />
                      条件パターンを追加
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
