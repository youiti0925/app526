"use client";

import { useState } from "react";
import {
  ClipboardCheck,
  Plus,
  Trash2,
  Edit3,
  Save,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Camera,
  Ruler,
  ThermometerSun,
  Eye,
  Gauge,
  Download,
  Printer,
} from "lucide-react";

interface ChecklistItem {
  id: string;
  category: "dimensional" | "visual" | "functional" | "surface" | "environmental";
  checkItem: string;
  standard: string;
  tolerance: string;
  method: string;
  instrument: string;
  frequency: string;
  result: "pass" | "fail" | "pending" | "na";
  measuredValue: string;
  notes: string;
  requiresPhoto: boolean;
  photoUrl?: string;
}

interface InspectionChecklistProps {
  projectName: string;
  machineModel: string;
}

const categoryConfig = {
  dimensional: { label: "寸法検査", icon: Ruler, color: "#3b82f6" },
  visual: { label: "外観検査", icon: Eye, color: "#8b5cf6" },
  functional: { label: "機能検査", icon: Gauge, color: "#10b981" },
  surface: { label: "表面検査", icon: ThermometerSun, color: "#f59e0b" },
  environmental: { label: "環境条件", icon: ThermometerSun, color: "#64748b" },
};

const demoChecklist: ChecklistItem[] = [
  {
    id: "chk-1",
    category: "environmental",
    checkItem: "室温",
    standard: "20℃",
    tolerance: "±2℃",
    method: "温度計で測定",
    instrument: "デジタル温度計 DT-200",
    frequency: "検査開始時",
    result: "pass",
    measuredValue: "20.3℃",
    notes: "",
    requiresPhoto: false,
  },
  {
    id: "chk-2",
    category: "environmental",
    checkItem: "湿度",
    standard: "50%以下",
    tolerance: "-",
    method: "湿度計で測定",
    instrument: "デジタル湿度計",
    frequency: "検査開始時",
    result: "pass",
    measuredValue: "42%",
    notes: "",
    requiresPhoto: false,
  },
  {
    id: "chk-3",
    category: "dimensional",
    checkItem: "テーブル面振れ",
    standard: "0mm",
    tolerance: "≦0.005mm",
    method: "ダイヤルゲージ 360°回転測定",
    instrument: "ダイヤルゲージ 0.001mm",
    frequency: "3回測定平均",
    result: "pass",
    measuredValue: "0.003mm",
    notes: "3回測定値: 0.003, 0.004, 0.003",
    requiresPhoto: true,
    photoUrl: "/api/placeholder/measurement1.jpg",
  },
  {
    id: "chk-4",
    category: "dimensional",
    checkItem: "テーブル外周振れ",
    standard: "0mm",
    tolerance: "≦0.008mm",
    method: "ダイヤルゲージ 360°回転測定",
    instrument: "ダイヤルゲージ 0.001mm",
    frequency: "3回測定平均",
    result: "pass",
    measuredValue: "0.005mm",
    notes: "",
    requiresPhoto: true,
  },
  {
    id: "chk-5",
    category: "functional",
    checkItem: "割出し精度 (0°)",
    standard: "0秒",
    tolerance: "±10秒",
    method: "ロータリーエンコーダ",
    instrument: "ロータリーエンコーダ RE-500",
    frequency: "正転・逆転各1回",
    result: "pass",
    measuredValue: "+3秒",
    notes: "",
    requiresPhoto: false,
  },
  {
    id: "chk-6",
    category: "functional",
    checkItem: "割出し精度 (90°)",
    standard: "0秒",
    tolerance: "±10秒",
    method: "ロータリーエンコーダ",
    instrument: "ロータリーエンコーダ RE-500",
    frequency: "正転・逆転各1回",
    result: "pass",
    measuredValue: "-5秒",
    notes: "",
    requiresPhoto: false,
  },
  {
    id: "chk-7",
    category: "functional",
    checkItem: "割出し精度 (180°)",
    standard: "0秒",
    tolerance: "±10秒",
    method: "ロータリーエンコーダ",
    instrument: "ロータリーエンコーダ RE-500",
    frequency: "正転・逆転各1回",
    result: "pending",
    measuredValue: "",
    notes: "",
    requiresPhoto: false,
  },
  {
    id: "chk-8",
    category: "functional",
    checkItem: "割出し精度 (270°)",
    standard: "0秒",
    tolerance: "±10秒",
    method: "ロータリーエンコーダ",
    instrument: "ロータリーエンコーダ RE-500",
    frequency: "正転・逆転各1回",
    result: "pending",
    measuredValue: "",
    notes: "",
    requiresPhoto: false,
  },
  {
    id: "chk-9",
    category: "visual",
    checkItem: "テーブル面の傷・打痕",
    standard: "傷・打痕なし",
    tolerance: "-",
    method: "目視検査",
    instrument: "目視 + ルーペ",
    frequency: "全面確認",
    result: "pass",
    measuredValue: "-",
    notes: "異常なし",
    requiresPhoto: true,
  },
  {
    id: "chk-10",
    category: "surface",
    checkItem: "テーブル面粗さ",
    standard: "Ra 0.8μm以下",
    tolerance: "-",
    method: "表面粗さ計",
    instrument: "表面粗さ計 SJ-310",
    frequency: "3点測定",
    result: "pending",
    measuredValue: "",
    notes: "",
    requiresPhoto: false,
  },
];

export default function InspectionChecklist({ projectName, machineModel }: InspectionChecklistProps) {
  const [checklist, setChecklist] = useState<ChecklistItem[]>(demoChecklist);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterResult, setFilterResult] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);

  const updateItem = (id: string, updates: Partial<ChecklistItem>) => {
    setChecklist((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const filteredItems = checklist.filter((item) => {
    if (filterCategory !== "all" && item.category !== filterCategory) return false;
    if (filterResult !== "all" && item.result !== filterResult) return false;
    return true;
  });

  const stats = {
    total: checklist.length,
    pass: checklist.filter((i) => i.result === "pass").length,
    fail: checklist.filter((i) => i.result === "fail").length,
    pending: checklist.filter((i) => i.result === "pending").length,
  };

  const overallResult =
    stats.fail > 0 ? "fail" : stats.pending > 0 ? "pending" : "pass";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <ClipboardCheck className="w-6 h-6 text-green-500" />
              検査チェックリスト
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {projectName} | {machineModel}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary flex items-center gap-1.5 text-sm">
              <Printer className="w-4 h-4" />
              印刷
            </button>
            <button className="btn-secondary flex items-center gap-1.5 text-sm">
              <Download className="w-4 h-4" />
              CSV出力
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          <div className="text-center p-3 bg-slate-50 rounded-lg">
            <p className="text-2xl font-bold text-slate-700">{stats.total}</p>
            <p className="text-xs text-slate-500">検査項目</p>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <p className="text-2xl font-bold text-green-600">{stats.pass}</p>
            <p className="text-xs text-green-700">合格</p>
          </div>
          <div className="text-center p-3 bg-red-50 rounded-lg">
            <p className="text-2xl font-bold text-red-600">{stats.fail}</p>
            <p className="text-xs text-red-700">不合格</p>
          </div>
          <div className="text-center p-3 bg-amber-50 rounded-lg">
            <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
            <p className="text-xs text-amber-700">未検査</p>
          </div>
        </div>

        {/* Overall Judgment */}
        <div
          className={`mt-4 p-4 rounded-lg text-center ${
            overallResult === "pass"
              ? "bg-green-100 border border-green-300"
              : overallResult === "fail"
              ? "bg-red-100 border border-red-300"
              : "bg-amber-100 border border-amber-300"
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            {overallResult === "pass" ? (
              <CheckCircle2 className="w-6 h-6 text-green-600" />
            ) : overallResult === "fail" ? (
              <XCircle className="w-6 h-6 text-red-600" />
            ) : (
              <AlertTriangle className="w-6 h-6 text-amber-600" />
            )}
            <span
              className={`text-lg font-bold ${
                overallResult === "pass"
                  ? "text-green-700"
                  : overallResult === "fail"
                  ? "text-red-700"
                  : "text-amber-700"
              }`}
            >
              総合判定:{" "}
              {overallResult === "pass"
                ? "合格"
                : overallResult === "fail"
                ? "不合格"
                : "検査中"}
            </span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">すべてのカテゴリ</option>
          {Object.entries(categoryConfig).map(([key, config]) => (
            <option key={key} value={key}>{config.label}</option>
          ))}
        </select>
        <select
          value={filterResult}
          onChange={(e) => setFilterResult(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">すべての結果</option>
          <option value="pass">合格</option>
          <option value="fail">不合格</option>
          <option value="pending">未検査</option>
        </select>
      </div>

      {/* Checklist Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b" style={{ borderColor: "var(--card-border)" }}>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 w-8">#</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">カテゴリ</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">検査項目</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">基準値</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">公差</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">測定器</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">測定値</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">判定</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">写真</th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item, index) => {
                const cat = categoryConfig[item.category];
                const Icon = cat.icon;
                const isEditing = editingId === item.id;

                return (
                  <tr
                    key={item.id}
                    className={`border-b hover:bg-slate-50 transition-colors ${
                      item.result === "fail" ? "bg-red-50/50" : ""
                    }`}
                    style={{ borderColor: "var(--card-border)" }}
                  >
                    <td className="px-4 py-3 text-slate-400">{index + 1}</td>
                    <td className="px-4 py-3">
                      <span
                        className="badge text-xs flex items-center gap-1 w-fit"
                        style={{ background: cat.color + "15", color: cat.color }}
                      >
                        <Icon className="w-3 h-3" />
                        {cat.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">{item.checkItem}</td>
                    <td className="px-4 py-3 tabular-nums">{item.standard}</td>
                    <td className="px-4 py-3 tabular-nums">{item.tolerance}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{item.instrument}</td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          type="text"
                          value={item.measuredValue}
                          onChange={(e) => updateItem(item.id, { measuredValue: e.target.value })}
                          className="w-24 border rounded px-2 py-1 text-sm tabular-nums"
                          autoFocus
                        />
                      ) : (
                        <span className="tabular-nums font-medium">{item.measuredValue || "-"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isEditing ? (
                        <select
                          value={item.result}
                          onChange={(e) =>
                            updateItem(item.id, { result: e.target.value as ChecklistItem["result"] })
                          }
                          className="border rounded px-2 py-1 text-xs"
                        >
                          <option value="pending">未検査</option>
                          <option value="pass">合格</option>
                          <option value="fail">不合格</option>
                          <option value="na">N/A</option>
                        </select>
                      ) : (
                        <span
                          className={`badge text-xs ${
                            item.result === "pass"
                              ? "badge-success"
                              : item.result === "fail"
                              ? "badge-danger"
                              : item.result === "na"
                              ? ""
                              : "badge-warning"
                          }`}
                          style={item.result === "na" ? { background: "#f1f5f9", color: "#64748b" } : {}}
                        >
                          {item.result === "pass"
                            ? "合格"
                            : item.result === "fail"
                            ? "不合格"
                            : item.result === "na"
                            ? "N/A"
                            : "未検査"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item.requiresPhoto && (
                        <button className="p-1 hover:bg-slate-100 rounded" title="証跡写真を撮影">
                          <Camera
                            className={`w-4 h-4 ${item.photoUrl ? "text-green-500" : "text-slate-400"}`}
                          />
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setEditingId(isEditing ? null : item.id)}
                        className="p-1 hover:bg-slate-100 rounded"
                      >
                        {isEditing ? (
                          <Save className="w-4 h-4 text-green-500" />
                        ) : (
                          <Edit3 className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
