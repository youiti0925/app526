"use client";

import { useState } from "react";
import {
  FileText,
  Save,
  Eye,
  Download,
  History,
  Shield,
  Wrench,
  ClipboardCheck,
  AlertTriangle,
  Settings,
  ChevronRight,
  BookOpen,
} from "lucide-react";
import type { WorkStandard, SafetyNote, QualityCheckpoint, ToolItem, SkillLevel } from "@/types";
import StepEditor from "./StepEditor";

interface WorkStandardEditorProps {
  workStandard: WorkStandard;
  onUpdate: (updates: Partial<WorkStandard>) => void;
  onStepUpdate: (stepId: string, updates: Record<string, unknown>) => void;
  onStepDelete: (stepId: string) => void;
  onStepAdd: () => void;
  onStepReorder: (from: number, to: number) => void;
  onExport: () => void;
  onPreview: () => void;
}

type TabId = "steps" | "header" | "safety" | "quality" | "tools" | "history";

const tabs: { id: TabId; label: string; icon: typeof FileText }[] = [
  { id: "steps", label: "作業ステップ", icon: BookOpen },
  { id: "header", label: "基本情報", icon: FileText },
  { id: "safety", label: "安全注意事項", icon: Shield },
  { id: "quality", label: "品質チェックポイント", icon: ClipboardCheck },
  { id: "tools", label: "必要工具・器具", icon: Wrench },
  { id: "history", label: "改訂履歴", icon: History },
];

const skillLevelLabels: Record<SkillLevel, string> = {
  beginner: "初級",
  intermediate: "中級",
  advanced: "上級",
  expert: "熟練",
};

export default function WorkStandardEditor({
  workStandard,
  onUpdate,
  onStepUpdate,
  onStepDelete,
  onStepAdd,
  onStepReorder,
  onExport,
  onPreview,
}: WorkStandardEditorProps) {
  const [activeTab, setActiveTab] = useState<TabId>("steps");

  const totalTime = workStandard.steps.reduce((sum, s) => sum + s.estimatedTime, 0);

  return (
    <div className="space-y-4">
      {/* Document Header Bar */}
      <div className="card flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <span>文書番号: {workStandard.documentNumber}</span>
            <ChevronRight className="w-3 h-3" />
            <span>バージョン: {workStandard.version}</span>
            <ChevronRight className="w-3 h-3" />
            <span>
              総作業時間: {Math.floor(totalTime / 60)}分{totalTime % 60 > 0 ? `${totalTime % 60}秒` : ""}
            </span>
          </div>
          <h2 className="text-lg font-bold text-slate-900">{workStandard.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onPreview} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Eye className="w-4 h-4" />
            プレビュー
          </button>
          <button onClick={onExport} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Download className="w-4 h-4" />
            エクスポート
          </button>
          <button className="btn-primary flex items-center gap-1.5 text-sm">
            <Save className="w-4 h-4" />
            保存
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto" style={{ borderColor: "var(--card-border)" }}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "steps" && (
        <StepEditor
          steps={workStandard.steps}
          onUpdateStep={onStepUpdate}
          onDeleteStep={onStepDelete}
          onAddStep={onStepAdd}
          onReorderSteps={onStepReorder}
        />
      )}

      {activeTab === "header" && (
        <div className="card space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">工程名</label>
              <input
                type="text"
                value={workStandard.header.processName}
                onChange={(e) =>
                  onUpdate({
                    header: { ...workStandard.header, processName: e.target.value },
                  })
                }
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">機械名</label>
              <input
                type="text"
                value={workStandard.header.machineName}
                onChange={(e) =>
                  onUpdate({
                    header: { ...workStandard.header, machineName: e.target.value },
                  })
                }
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">型式</label>
              <input
                type="text"
                value={workStandard.header.machineModel}
                onChange={(e) =>
                  onUpdate({
                    header: { ...workStandard.header, machineModel: e.target.value },
                  })
                }
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">部門</label>
              <input
                type="text"
                value={workStandard.header.department}
                onChange={(e) =>
                  onUpdate({
                    header: { ...workStandard.header, department: e.target.value },
                  })
                }
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">必要スキルレベル</label>
              <select
                value={workStandard.header.requiredSkillLevel}
                onChange={(e) =>
                  onUpdate({
                    header: { ...workStandard.header, requiredSkillLevel: e.target.value as SkillLevel },
                  })
                }
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                {Object.entries(skillLevelLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">前提条件</label>
            <div className="space-y-2">
              {workStandard.header.prerequisites.map((pre, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-slate-400 text-sm">{i + 1}.</span>
                  <input
                    type="text"
                    value={pre}
                    onChange={(e) => {
                      const newPre = [...workStandard.header.prerequisites];
                      newPre[i] = e.target.value;
                      onUpdate({ header: { ...workStandard.header, prerequisites: newPre } });
                    }}
                    className="flex-1 border rounded px-3 py-1.5 text-sm"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">必要保護具</label>
            <div className="flex flex-wrap gap-2">
              {workStandard.header.requiredPPE.map((ppe, i) => (
                <span key={i} className="badge badge-warning">{ppe}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === "safety" && (
        <div className="card space-y-4">
          <h3 className="font-bold text-slate-900 flex items-center gap-2">
            <Shield className="w-5 h-5 text-red-500" />
            安全注意事項
          </h3>
          {workStandard.safetyNotes.map((note) => {
            const severityColors = {
              info: { bg: "#dbeafe", color: "#1e40af", border: "#93c5fd" },
              caution: { bg: "#fef3c7", color: "#92400e", border: "#fcd34d" },
              warning: { bg: "#fed7aa", color: "#9a3412", border: "#fdba74" },
              danger: { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5" },
            };
            const colors = severityColors[note.severity];
            return (
              <div
                key={note.id}
                className="p-4 rounded-lg border-l-4"
                style={{ background: colors.bg, borderLeftColor: colors.border }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-5 h-5" style={{ color: colors.color }} />
                  <h4 className="font-bold text-sm" style={{ color: colors.color }}>
                    {note.title}
                  </h4>
                  <span className="badge text-xs ml-auto" style={{ background: colors.border + "40", color: colors.color }}>
                    {note.severity === "info" ? "情報" : note.severity === "caution" ? "注意" : note.severity === "warning" ? "警告" : "危険"}
                  </span>
                </div>
                <p className="text-sm" style={{ color: colors.color }}>{note.description}</p>
                <p className="text-xs mt-2" style={{ color: colors.color + "aa" }}>
                  関連ステップ: {note.relatedSteps.join(", ")}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === "quality" && (
        <div className="card">
          <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-green-500" />
            品質チェックポイント
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">ステップ</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">検査項目</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">検査方法</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">基準</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">合格基準</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">測定器</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">頻度</th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600">記録</th>
                </tr>
              </thead>
              <tbody>
                {workStandard.qualityCheckpoints.map((qc) => (
                  <tr key={qc.id} className="border-t" style={{ borderColor: "var(--card-border)" }}>
                    <td className="px-4 py-3">Step {qc.stepNumber}</td>
                    <td className="px-4 py-3 font-medium">{qc.checkItem}</td>
                    <td className="px-4 py-3">{qc.method}</td>
                    <td className="px-4 py-3 tabular-nums">{qc.standard}</td>
                    <td className="px-4 py-3">{qc.acceptanceCriteria}</td>
                    <td className="px-4 py-3">{qc.measuringInstrument}</td>
                    <td className="px-4 py-3">{qc.frequency}</td>
                    <td className="px-4 py-3 text-center">
                      {qc.recordRequired ? (
                        <span className="badge badge-success">必須</span>
                      ) : (
                        <span className="badge" style={{ background: "#f1f5f9", color: "#64748b" }}>任意</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "tools" && (
        <div className="card">
          <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Wrench className="w-5 h-5 text-amber-500" />
            必要工具・器具一覧
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {workStandard.toolsRequired.map((tool) => {
              const categoryLabels: Record<string, { label: string; color: string }> = {
                measuring: { label: "測定器", color: "#3b82f6" },
                "hand-tool": { label: "手工具", color: "#10b981" },
                "power-tool": { label: "電動工具", color: "#f59e0b" },
                fixture: { label: "治具", color: "#8b5cf6" },
                consumable: { label: "消耗品", color: "#64748b" },
                ppe: { label: "保護具", color: "#ef4444" },
              };
              const cat = categoryLabels[tool.category] || { label: "その他", color: "#64748b" };
              return (
                <div key={tool.id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                    style={{ background: cat.color }}
                  >
                    {tool.quantity}
                  </div>
                  <div>
                    <p className="font-medium text-sm text-slate-900">{tool.name}</p>
                    <p className="text-xs text-slate-500">{tool.specification}</p>
                  </div>
                  <span
                    className="badge text-xs ml-auto"
                    style={{ background: cat.color + "20", color: cat.color }}
                  >
                    {cat.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === "history" && (
        <div className="card">
          <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
            <History className="w-5 h-5 text-slate-500" />
            改訂履歴
          </h3>
          <div className="space-y-3">
            {workStandard.revisionHistory.map((rev, i) => (
              <div
                key={i}
                className={`flex items-center gap-4 p-3 rounded-lg ${
                  i === 0 ? "bg-blue-50 border border-blue-200" : "bg-slate-50"
                }`}
              >
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center font-bold text-sm ${
                  i === 0 ? "bg-blue-100 text-blue-600" : "bg-slate-200 text-slate-500"
                }`}>
                  v{rev.version}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm text-slate-900">{rev.changes}</p>
                  <p className="text-xs text-slate-500">
                    {rev.author} | {rev.date}
                  </p>
                </div>
                {i === 0 && <span className="badge badge-info">最新</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
