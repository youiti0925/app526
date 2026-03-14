"use client";

import { useState } from "react";
import {
  GripVertical,
  Trash2,
  ChevronDown,
  ChevronUp,
  Plus,
  Clock,
  AlertTriangle,
  Lightbulb,
  Ruler,
  Tag,
  ChevronsUpDown,
  Copy,
  ArrowUp,
  ArrowDown,
  X,
} from "lucide-react";
import type { WorkStep, StepCategory } from "@/types";
import StepFeedback from "./StepFeedback";

interface StepEditorProps {
  steps: WorkStep[];
  onUpdateStep: (stepId: string, updates: Partial<WorkStep>) => void;
  onDeleteStep: (stepId: string) => void;
  onAddStep: () => void;
  onReorderSteps: (fromIndex: number, toIndex: number) => void;
  onStepSelect?: (step: WorkStep) => void;
  selectedStepId?: string;
  projectId?: string;
}

const categoryOptions: { value: StepCategory; label: string; color: string }[] = [
  { value: "preparation", label: "準備", color: "#3b82f6" },
  { value: "operation", label: "操作", color: "#8b5cf6" },
  { value: "inspection", label: "検査", color: "#06b6d4" },
  { value: "measurement", label: "測定", color: "#f59e0b" },
  { value: "adjustment", label: "調整", color: "#f97316" },
  { value: "cleanup", label: "後片付け", color: "#64748b" },
  { value: "safety-check", label: "安全確認", color: "#ef4444" },
];

export default function StepEditor({
  steps,
  onUpdateStep,
  onDeleteStep,
  onAddStep,
  onReorderSteps,
  onStepSelect,
  selectedStepId,
  projectId,
}: StepEditorProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const toggleExpand = (stepId: string) => {
    const newExpanded = new Set(expandedSteps);
    if (newExpanded.has(stepId)) {
      newExpanded.delete(stepId);
    } else {
      newExpanded.add(stepId);
    }
    setExpandedSteps(newExpanded);
  };

  const expandAll = () => {
    setExpandedSteps(new Set(steps.map((s) => s.id)));
  };

  const collapseAll = () => {
    setExpandedSteps(new Set());
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== index) {
      onReorderSteps(dragIndex, index);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}分${s > 0 ? `${s}秒` : ""}`;
  };

  const addKeyPoint = (stepId: string, keyPoints: string[]) => {
    onUpdateStep(stepId, { keyPoints: [...keyPoints, ""] });
  };

  const removeKeyPoint = (stepId: string, keyPoints: string[], index: number) => {
    onUpdateStep(stepId, { keyPoints: keyPoints.filter((_, i) => i !== index) });
  };

  const addCaution = (stepId: string, cautions: string[]) => {
    onUpdateStep(stepId, { cautions: [...cautions, ""] });
  };

  const removeCaution = (stepId: string, cautions: string[], index: number) => {
    onUpdateStep(stepId, { cautions: cautions.filter((_, i) => i !== index) });
  };

  const addTool = (stepId: string, tools: string[]) => {
    onUpdateStep(stepId, { tools: [...tools, ""] });
  };

  const removeTool = (stepId: string, tools: string[], index: number) => {
    onUpdateStep(stepId, { tools: tools.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-900">作業ステップ ({steps.length})</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={expandedSteps.size === steps.length ? collapseAll : expandAll}
            className="btn-secondary flex items-center gap-1 text-xs py-1 px-2"
          >
            <ChevronsUpDown className="w-3.5 h-3.5" />
            {expandedSteps.size === steps.length ? "すべて閉じる" : "すべて開く"}
          </button>
          <button onClick={onAddStep} className="btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3">
            <Plus className="w-4 h-4" />
            ステップ追加
          </button>
        </div>
      </div>

      <div className="relative">
        {steps.map((step, index) => {
          const isExpanded = expandedSteps.has(step.id);
          const isSelected = selectedStepId === step.id;
          const isDragging = dragIndex === index;
          const isDragOver = dragOverIndex === index;
          const cat = categoryOptions.find((c) => c.value === step.category);

          return (
            <div
              key={step.id}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              className={`step-card slide-in ${isSelected ? "ring-2 ring-blue-400" : ""} ${
                isDragging ? "opacity-50" : ""
              } ${isDragOver ? "border-t-2 border-blue-400" : ""}`}
              style={{ animationDelay: `${index * 50}ms` }}
              onClick={() => onStepSelect?.(step)}
            >
              {index < steps.length - 1 && <div className="timeline-connector" />}
              <div className="step-number" style={{ background: cat?.color || "#3b82f6" }}>
                {step.stepNumber}
              </div>

              <div className="bg-white rounded-lg border shadow-sm w-full" style={{ borderColor: "var(--card-border)" }}>
                {/* Step Header - always clickable */}
                <div className="flex items-center gap-2 p-3 cursor-pointer" onClick={() => toggleExpand(step.id)}>
                  <div
                    className="cursor-grab active:cursor-grabbing flex-shrink-0 p-1 hover:bg-slate-100 rounded"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <GripVertical className="w-4 h-4 text-slate-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm text-slate-900 truncate">{step.title}</h4>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span
                        className="badge text-xs"
                        style={{ background: (cat?.color || "#3b82f6") + "20", color: cat?.color || "#3b82f6" }}
                      >
                        {cat?.label || "操作"}
                      </span>
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTime(step.estimatedTime)}
                      </span>
                      {step.keyPoints.length > 0 && (
                        <span className="text-xs text-yellow-600 flex items-center gap-1">
                          <Lightbulb className="w-3 h-3" />
                          {step.keyPoints.length}
                        </span>
                      )}
                      {step.cautions.length > 0 && (
                        <span className="text-xs text-red-600 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          {step.cautions.length}
                        </span>
                      )}
                      {step.tools.length > 0 && (
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Tag className="w-3 h-3" />
                          {step.tools.length}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {/* Quick move buttons */}
                    {index > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onReorderSteps(index, index - 1); }}
                        className="p-1 hover:bg-slate-100 rounded"
                        title="上に移動"
                      >
                        <ArrowUp className="w-3.5 h-3.5 text-slate-400" />
                      </button>
                    )}
                    {index < steps.length - 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onReorderSteps(index, index + 1); }}
                        className="p-1 hover:bg-slate-100 rounded"
                        title="下に移動"
                      >
                        <ArrowDown className="w-3.5 h-3.5 text-slate-400" />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`ステップ「${step.title}」を削除しますか？`)) {
                          onDeleteStep(step.id);
                        }
                      }}
                      className="p-1 hover:bg-red-50 rounded ml-1"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" />
                    </button>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-slate-400 ml-1" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400 ml-1" />
                    )}
                  </div>
                </div>

                {/* Expanded Content - All inline editable */}
                {isExpanded && (
                  <div className="border-t p-4 space-y-4" style={{ borderColor: "var(--card-border)" }}>
                    {/* Title */}
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">タイトル</label>
                      <input
                        type="text"
                        value={step.title}
                        onChange={(e) => onUpdateStep(step.id, { title: e.target.value })}
                        className="w-full border rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        style={{ borderColor: "var(--card-border)" }}
                      />
                    </div>

                    {/* Description */}
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">説明</label>
                      <textarea
                        value={step.description}
                        onChange={(e) => onUpdateStep(step.id, { description: e.target.value })}
                        className="w-full border rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        style={{ borderColor: "var(--card-border)" }}
                        rows={2}
                        placeholder="ステップの説明を入力..."
                      />
                    </div>

                    {/* Detailed Instructions */}
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">詳細手順</label>
                      <textarea
                        value={step.detailedInstructions}
                        onChange={(e) => onUpdateStep(step.id, { detailedInstructions: e.target.value })}
                        className="w-full border rounded-lg p-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        style={{ borderColor: "var(--card-border)" }}
                        rows={4}
                        placeholder="詳細な作業手順を記述..."
                      />
                    </div>

                    {/* Key Points - editable list */}
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase mb-1 flex items-center gap-1">
                        <Lightbulb className="w-3 h-3 text-yellow-500" />
                        ポイント
                      </label>
                      <div className="space-y-1.5">
                        {step.keyPoints.map((kp, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-yellow-500 text-sm">●</span>
                            <input
                              type="text"
                              value={kp}
                              onChange={(e) => {
                                const newKp = [...step.keyPoints];
                                newKp[i] = e.target.value;
                                onUpdateStep(step.id, { keyPoints: newKp });
                              }}
                              className="flex-1 border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                              style={{ borderColor: "var(--card-border)" }}
                              placeholder="ポイントを入力..."
                            />
                            <button
                              onClick={() => removeKeyPoint(step.id, step.keyPoints, i)}
                              className="p-0.5 hover:bg-red-50 rounded"
                            >
                              <X className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => addKeyPoint(step.id, step.keyPoints)}
                          className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 mt-1"
                        >
                          <Plus className="w-3 h-3" /> ポイントを追加
                        </button>
                      </div>
                    </div>

                    {/* Cautions - editable list */}
                    <div>
                      <label className="text-xs font-semibold text-red-500 uppercase mb-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        注意事項
                      </label>
                      <div className="space-y-1.5">
                        {step.cautions.map((c, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-red-500 text-sm">⚠</span>
                            <input
                              type="text"
                              value={c}
                              onChange={(e) => {
                                const newC = [...step.cautions];
                                newC[i] = e.target.value;
                                onUpdateStep(step.id, { cautions: newC });
                              }}
                              className="flex-1 border rounded px-2 py-1 text-sm bg-red-50 focus:ring-2 focus:ring-red-300 focus:border-red-300 outline-none"
                              style={{ borderColor: "#fecaca" }}
                              placeholder="注意事項を入力..."
                            />
                            <button
                              onClick={() => removeCaution(step.id, step.cautions, i)}
                              className="p-0.5 hover:bg-red-50 rounded"
                            >
                              <X className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => addCaution(step.id, step.cautions)}
                          className="text-xs text-red-600 hover:text-red-800 flex items-center gap-1 mt-1"
                        >
                          <Plus className="w-3 h-3" /> 注意事項を追加
                        </button>
                      </div>
                    </div>

                    {/* Measurements */}
                    {step.measurements && step.measurements.length > 0 && (
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase mb-1 flex items-center gap-1">
                          <Ruler className="w-3 h-3" />
                          測定仕様
                        </label>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-slate-50">
                                <th className="text-left px-3 py-2 font-medium text-slate-600">測定項目</th>
                                <th className="text-left px-3 py-2 font-medium text-slate-600">基準値</th>
                                <th className="text-left px-3 py-2 font-medium text-slate-600">公差</th>
                                <th className="text-left px-3 py-2 font-medium text-slate-600">測定器</th>
                              </tr>
                            </thead>
                            <tbody>
                              {step.measurements.map((m, i) => (
                                <tr key={i} className="border-t" style={{ borderColor: "var(--card-border)" }}>
                                  <td className="px-3 py-2">{m.parameter}</td>
                                  <td className="px-3 py-2 tabular-nums">{m.nominalValue} {m.unit}</td>
                                  <td className="px-3 py-2 tabular-nums">+{m.tolerance.upper} / {m.tolerance.lower}</td>
                                  <td className="px-3 py-2">{m.instrument}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Tools - editable */}
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase mb-1 flex items-center gap-1">
                        <Tag className="w-3 h-3" />
                        使用工具
                      </label>
                      <div className="flex flex-wrap gap-2 items-center">
                        {step.tools.map((tool, i) => (
                          <div key={i} className="flex items-center gap-1 bg-blue-50 rounded-full pl-3 pr-1 py-0.5">
                            <input
                              type="text"
                              value={tool}
                              onChange={(e) => {
                                const newTools = [...step.tools];
                                newTools[i] = e.target.value;
                                onUpdateStep(step.id, { tools: newTools });
                              }}
                              className="bg-transparent text-sm text-blue-700 outline-none w-24"
                              style={{ minWidth: "60px", width: `${Math.max(60, tool.length * 14)}px` }}
                            />
                            <button
                              onClick={() => removeTool(step.id, step.tools, i)}
                              className="p-0.5 hover:bg-blue-100 rounded-full"
                            >
                              <X className="w-3 h-3 text-blue-400" />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => addTool(step.id, step.tools)}
                          className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" /> 工具追加
                        </button>
                      </div>
                    </div>

                    {/* Operator Feedback */}
                    {projectId && (
                      <StepFeedback
                        stepNumber={step.stepNumber}
                        stepTitle={step.title}
                        projectId={projectId}
                      />
                    )}

                    {/* Category & Time */}
                    <div className="grid grid-cols-2 gap-4 pt-3 border-t" style={{ borderColor: "var(--card-border)" }}>
                      <div>
                        <label className="text-xs font-semibold text-slate-500 mb-1 block">カテゴリ</label>
                        <select
                          value={step.category}
                          onChange={(e) => onUpdateStep(step.id, { category: e.target.value as StepCategory })}
                          className="w-full border rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                          style={{ borderColor: "var(--card-border)" }}
                        >
                          {categoryOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-500 mb-1 block">所要時間（秒）</label>
                        <input
                          type="number"
                          value={step.estimatedTime}
                          onChange={(e) => onUpdateStep(step.id, { estimatedTime: Number(e.target.value) })}
                          className="w-full border rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                          style={{ borderColor: "var(--card-border)" }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Step Button */}
      <button
        onClick={onAddStep}
        className="w-full py-4 border-2 border-dashed rounded-lg text-slate-400 hover:text-blue-500 hover:border-blue-400 transition-colors flex items-center justify-center gap-2"
        style={{ borderColor: "var(--card-border)" }}
      >
        <Plus className="w-5 h-5" />
        新しいステップを追加
      </button>
    </div>
  );
}
