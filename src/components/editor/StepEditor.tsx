"use client";

import { useState } from "react";
import {
  GripVertical,
  Edit3,
  Trash2,
  ChevronDown,
  ChevronUp,
  Plus,
  Clock,
  AlertTriangle,
  Lightbulb,
  Camera,
  Ruler,
  Tag,
  Save,
  X,
} from "lucide-react";
import type { WorkStep, StepCategory, MeasurementSpec } from "@/types";

interface StepEditorProps {
  steps: WorkStep[];
  onUpdateStep: (stepId: string, updates: Partial<WorkStep>) => void;
  onDeleteStep: (stepId: string) => void;
  onAddStep: () => void;
  onReorderSteps: (fromIndex: number, toIndex: number) => void;
  onStepSelect?: (step: WorkStep) => void;
  selectedStepId?: string;
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
}: StepEditorProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const toggleExpand = (stepId: string) => {
    const newExpanded = new Set(expandedSteps);
    if (newExpanded.has(stepId)) {
      newExpanded.delete(stepId);
    } else {
      newExpanded.add(stepId);
    }
    setExpandedSteps(newExpanded);
  };

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== index) {
      onReorderSteps(dragIndex, index);
      setDragIndex(index);
    }
  };

  const handleDragEnd = () => {
    setDragIndex(null);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}分${s > 0 ? `${s}秒` : ""}`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-900">作業ステップ ({steps.length})</h3>
        <button onClick={onAddStep} className="btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3">
          <Plus className="w-4 h-4" />
          ステップ追加
        </button>
      </div>

      <div className="relative">
        {steps.map((step, index) => {
          const isExpanded = expandedSteps.has(step.id);
          const isSelected = selectedStepId === step.id;
          const isEditing = editingStep === step.id;
          const cat = categoryOptions.find((c) => c.value === step.category);

          return (
            <div
              key={step.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={`step-card slide-in ${isSelected ? "ring-2 ring-blue-400" : ""}`}
              style={{ animationDelay: `${index * 50}ms` }}
              onClick={() => onStepSelect?.(step)}
            >
              {index < steps.length - 1 && <div className="timeline-connector" />}
              <div className="step-number" style={{ background: cat?.color || "#3b82f6" }}>
                {step.stepNumber}
              </div>

              <div className="bg-white rounded-lg border shadow-sm" style={{ borderColor: "var(--card-border)" }}>
                {/* Step Header */}
                <div className="flex items-center gap-2 p-3 cursor-pointer" onClick={() => toggleExpand(step.id)}>
                  <GripVertical className="w-4 h-4 text-slate-300 cursor-grab flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <input
                        type="text"
                        value={step.title}
                        onChange={(e) => onUpdateStep(step.id, { title: e.target.value })}
                        className="font-medium text-sm w-full border rounded px-2 py-1"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <h4 className="font-medium text-sm text-slate-900 truncate">{step.title}</h4>
                    )}
                    <div className="flex items-center gap-2 mt-1">
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
                      {step.qualityCheck && (
                        <span className="text-xs text-green-600 flex items-center gap-1">
                          <Ruler className="w-3 h-3" />
                          品質チェック
                        </span>
                      )}
                      {step.safetyWarning && (
                        <span className="text-xs text-red-600 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          安全注意
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingStep(isEditing ? null : step.id);
                      }}
                      className="p-1 hover:bg-slate-100 rounded"
                    >
                      {isEditing ? <Save className="w-4 h-4 text-green-500" /> : <Edit3 className="w-4 h-4 text-slate-400" />}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteStep(step.id);
                      }}
                      className="p-1 hover:bg-red-50 rounded"
                    >
                      <Trash2 className="w-4 h-4 text-slate-400 hover:text-red-500" />
                    </button>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="border-t p-4 space-y-4" style={{ borderColor: "var(--card-border)" }}>
                    {/* Description */}
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">説明</label>
                      {isEditing ? (
                        <textarea
                          value={step.description}
                          onChange={(e) => onUpdateStep(step.id, { description: e.target.value })}
                          className="w-full border rounded-lg p-2 text-sm"
                          rows={2}
                        />
                      ) : (
                        <p className="text-sm text-slate-700">{step.description}</p>
                      )}
                    </div>

                    {/* Detailed Instructions */}
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">詳細手順</label>
                      {isEditing ? (
                        <textarea
                          value={step.detailedInstructions}
                          onChange={(e) => onUpdateStep(step.id, { detailedInstructions: e.target.value })}
                          className="w-full border rounded-lg p-2 text-sm font-mono"
                          rows={4}
                        />
                      ) : (
                        <pre className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 p-3 rounded-lg">
                          {step.detailedInstructions}
                        </pre>
                      )}
                    </div>

                    {/* Key Points */}
                    {step.keyPoints.length > 0 && (
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase mb-1 flex items-center gap-1">
                          <Lightbulb className="w-3 h-3" />
                          ポイント
                        </label>
                        <div className="space-y-1">
                          {step.keyPoints.map((kp, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm">
                              <span className="text-yellow-500 mt-0.5">&#9679;</span>
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={kp}
                                  onChange={(e) => {
                                    const newKp = [...step.keyPoints];
                                    newKp[i] = e.target.value;
                                    onUpdateStep(step.id, { keyPoints: newKp });
                                  }}
                                  className="flex-1 border rounded px-2 py-0.5 text-sm"
                                />
                              ) : (
                                <span className="text-slate-700">{kp}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Cautions */}
                    {step.cautions.length > 0 && (
                      <div>
                        <label className="text-xs font-semibold text-red-500 uppercase mb-1 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          注意事項
                        </label>
                        <div className="space-y-1">
                          {step.cautions.map((c, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm bg-red-50 px-3 py-1.5 rounded">
                              <span className="text-red-500 mt-0.5">&#9888;</span>
                              <span className="text-red-700">{c}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

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

                    {/* Tools */}
                    {step.tools.length > 0 && (
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase mb-1 flex items-center gap-1">
                          <Tag className="w-3 h-3" />
                          使用工具
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {step.tools.map((tool, i) => (
                            <span key={i} className="badge badge-info">{tool}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Category & Time Edit */}
                    {isEditing && (
                      <div className="grid grid-cols-2 gap-4 pt-2 border-t" style={{ borderColor: "var(--card-border)" }}>
                        <div>
                          <label className="text-xs font-semibold text-slate-500 mb-1 block">カテゴリ</label>
                          <select
                            value={step.category}
                            onChange={(e) => onUpdateStep(step.id, { category: e.target.value as StepCategory })}
                            className="w-full border rounded px-2 py-1.5 text-sm"
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
                            className="w-full border rounded px-2 py-1.5 text-sm"
                          />
                        </div>
                      </div>
                    )}
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
