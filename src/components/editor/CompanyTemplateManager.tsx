"use client";

import { useState, useEffect } from "react";
import {
  FileText,
  Plus,
  Trash2,
  X,
  GripVertical,
  Eye,
  EyeOff,
  Upload,
  Settings,
  Save,
  Copy,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { CompanyTemplate, TemplateSectionConfig, ProjectCategory } from "@/types";

const COMPANY_TEMPLATES_KEY = "videosop-company-templates";

function loadTemplates(): CompanyTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(COMPANY_TEMPLATES_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveTemplates(templates: CompanyTemplate[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(COMPANY_TEMPLATES_KEY, JSON.stringify(templates));
}

const defaultSections: TemplateSectionConfig[] = [
  { id: "s-header", name: "ヘッダー情報", enabled: true, order: 1, type: "header" },
  { id: "s-steps", name: "作業ステップ", enabled: true, order: 2, type: "steps" },
  { id: "s-safety", name: "安全注意事項", enabled: true, order: 3, type: "safety" },
  { id: "s-quality", name: "品質チェックポイント", enabled: true, order: 4, type: "quality" },
  { id: "s-tools", name: "必要工具一覧", enabled: true, order: 5, type: "tools" },
  { id: "s-approval", name: "承認欄", enabled: true, order: 6, type: "approval" },
  { id: "s-revision", name: "改訂履歴", enabled: true, order: 7, type: "revision-history" },
];

const categoryLabels: Record<ProjectCategory, string> = {
  inspection: "検査",
  assembly: "組立",
  maintenance: "保全",
  setup: "段取り",
  "quality-check": "品質確認",
  other: "その他",
};

export default function CompanyTemplateManager() {
  const [templates, setTemplates] = useState<CompanyTemplate[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newTemplate, setNewTemplate] = useState({
    name: "",
    description: "",
    category: "inspection" as ProjectCategory,
    format: "pdf" as "pdf" | "excel" | "word",
    footerText: "",
  });

  useEffect(() => {
    setTemplates(loadTemplates());
  }, []);

  const handleCreate = () => {
    if (!newTemplate.name.trim()) return;
    const template: CompanyTemplate = {
      id: crypto.randomUUID(),
      name: newTemplate.name.trim(),
      description: newTemplate.description.trim(),
      category: newTemplate.category,
      format: newTemplate.format,
      sections: defaultSections.map((s) => ({ ...s })),
      headerFields: [
        { fieldId: "doc-number", label: "文書番号", source: "auto" },
        { fieldId: "revision", label: "改訂番号", source: "auto" },
        { fieldId: "dept", label: "部門", source: "auto" },
        { fieldId: "author", label: "作成者", source: "manual", value: "" },
        { fieldId: "approver", label: "承認者", source: "manual", value: "" },
      ],
      footerText: newTemplate.footerText.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updated = [...templates, template];
    setTemplates(updated);
    saveTemplates(updated);
    setNewTemplate({ name: "", description: "", category: "inspection", format: "pdf", footerText: "" });
    setShowCreate(false);
    setExpandedId(template.id);
  };

  const handleDelete = (id: string) => {
    const updated = templates.filter((t) => t.id !== id);
    setTemplates(updated);
    saveTemplates(updated);
  };

  const handleDuplicate = (template: CompanyTemplate) => {
    const dup: CompanyTemplate = {
      ...template,
      id: crypto.randomUUID(),
      name: `${template.name}（コピー）`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updated = [...templates, dup];
    setTemplates(updated);
    saveTemplates(updated);
  };

  const toggleSection = (templateId: string, sectionId: string) => {
    const updated = templates.map((t) => {
      if (t.id !== templateId) return t;
      return {
        ...t,
        sections: t.sections.map((s) =>
          s.id === sectionId ? { ...s, enabled: !s.enabled } : s
        ),
        updatedAt: new Date().toISOString(),
      };
    });
    setTemplates(updated);
    saveTemplates(updated);
  };

  const moveSectionUp = (templateId: string, sectionId: string) => {
    const updated = templates.map((t) => {
      if (t.id !== templateId) return t;
      const sections = [...t.sections].sort((a, b) => a.order - b.order);
      const idx = sections.findIndex((s) => s.id === sectionId);
      if (idx <= 0) return t;
      const temp = sections[idx].order;
      sections[idx].order = sections[idx - 1].order;
      sections[idx - 1].order = temp;
      return { ...t, sections, updatedAt: new Date().toISOString() };
    });
    setTemplates(updated);
    saveTemplates(updated);
  };

  const moveSectionDown = (templateId: string, sectionId: string) => {
    const updated = templates.map((t) => {
      if (t.id !== templateId) return t;
      const sections = [...t.sections].sort((a, b) => a.order - b.order);
      const idx = sections.findIndex((s) => s.id === sectionId);
      if (idx >= sections.length - 1) return t;
      const temp = sections[idx].order;
      sections[idx].order = sections[idx + 1].order;
      sections[idx + 1].order = temp;
      return { ...t, sections, updatedAt: new Date().toISOString() };
    });
    setTemplates(updated);
    saveTemplates(updated);
  };

  const updateFooter = (templateId: string, footerText: string) => {
    const updated = templates.map((t) =>
      t.id === templateId ? { ...t, footerText, updatedAt: new Date().toISOString() } : t
    );
    setTemplates(updated);
    saveTemplates(updated);
  };

  const sectionTypeIcons: Record<string, string> = {
    header: "📋",
    steps: "📝",
    safety: "🛡️",
    quality: "✅",
    tools: "🔧",
    "revision-history": "📜",
    approval: "✍️",
    custom: "📄",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-500" />
            会社テンプレート管理
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            自社の文書フォーマットに合わせたエクスポートテンプレートを管理します
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="btn-primary flex items-center gap-1.5 text-sm"
        >
          <Plus className="w-4 h-4" />
          テンプレート作成
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="card border-2 border-indigo-200" style={{ background: "#eef2ff" }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-indigo-900">新しいテンプレートを作成</h3>
            <button onClick={() => setShowCreate(false)} className="p-1 hover:bg-indigo-100 rounded">
              <X className="w-4 h-4 text-indigo-500" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">テンプレート名 *</label>
              <input
                type="text"
                value={newTemplate.name}
                onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                placeholder="例: ISO 9001 作業手順書"
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">対象カテゴリ</label>
              <select
                value={newTemplate.category}
                onChange={(e) => setNewTemplate({ ...newTemplate, category: e.target.value as ProjectCategory })}
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
              >
                {Object.entries(categoryLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-600 mb-1 block">説明</label>
              <input
                type="text"
                value={newTemplate.description}
                onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
                placeholder="例: ISO 9001に準拠した標準的な作業手順書フォーマット"
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">出力形式</label>
              <select
                value={newTemplate.format}
                onChange={(e) => setNewTemplate({ ...newTemplate, format: e.target.value as "pdf" | "excel" | "word" })}
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="pdf">PDF</option>
                <option value="excel">Excel</option>
                <option value="word">Word</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">フッターテキスト</label>
              <input
                type="text"
                value={newTemplate.footerText}
                onChange={(e) => setNewTemplate({ ...newTemplate, footerText: e.target.value })}
                placeholder="例: 社外秘 - 株式会社○○"
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={!newTemplate.name.trim()}
            className="mt-4 btn-primary text-sm py-2 px-6 disabled:opacity-50 flex items-center gap-1.5"
          >
            <Save className="w-4 h-4" />
            作成
          </button>
        </div>
      )}

      {/* Template List */}
      {templates.length === 0 && !showCreate ? (
        <div className="card text-center py-12">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="font-bold text-slate-900 mb-2">テンプレートがありません</h3>
          <p className="text-sm text-slate-500 mb-4">
            自社のISO文書フォーマットや社内規定に合わせたテンプレートを作成できます
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary text-sm inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            最初のテンプレートを作成
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((template) => {
            const isExpanded = expandedId === template.id;
            const sortedSections = [...template.sections].sort((a, b) => a.order - b.order);
            const enabledCount = template.sections.filter((s) => s.enabled).length;

            return (
              <div key={template.id} className="card">
                {/* Template Header */}
                <div
                  className="flex items-center gap-3 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : template.id)}
                >
                  <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm text-slate-900">{template.name}</h3>
                      <span className="badge text-xs" style={{ background: "#e0e7ff", color: "#4338ca" }}>
                        {categoryLabels[template.category]}
                      </span>
                      <span className="badge text-xs" style={{ background: "#f1f5f9", color: "#64748b" }}>
                        {template.format.toUpperCase()}
                      </span>
                    </div>
                    {template.description && (
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{template.description}</p>
                    )}
                    <p className="text-xs text-slate-400 mt-0.5">
                      {enabledCount}/{template.sections.length} セクション有効
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDuplicate(template); }}
                      className="p-1.5 hover:bg-slate-100 rounded"
                      title="複製"
                    >
                      <Copy className="w-4 h-4 text-slate-400" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`テンプレート「${template.name}」を削除しますか？`)) {
                          handleDelete(template.id);
                        }
                      }}
                      className="p-1.5 hover:bg-red-50 rounded"
                      title="削除"
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

                {/* Expanded Section Editor */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t space-y-4" style={{ borderColor: "var(--card-border)" }}>
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase mb-3">セクション構成（ドラッグ&ドロップで並び替え）</h4>
                      <div className="space-y-1.5">
                        {sortedSections.map((section, idx) => (
                          <div
                            key={section.id}
                            className={`flex items-center gap-2 p-2.5 rounded-lg border transition-colors ${
                              section.enabled
                                ? "bg-white border-slate-200"
                                : "bg-slate-50 border-slate-100 opacity-60"
                            }`}
                          >
                            <GripVertical className="w-4 h-4 text-slate-300 cursor-grab" />
                            <span className="text-sm">{sectionTypeIcons[section.type]}</span>
                            <span className={`text-sm flex-1 ${section.enabled ? "text-slate-900" : "text-slate-400"}`}>
                              {section.name}
                            </span>
                            <div className="flex items-center gap-0.5">
                              {idx > 0 && (
                                <button
                                  onClick={() => moveSectionUp(template.id, section.id)}
                                  className="p-1 hover:bg-slate-100 rounded"
                                >
                                  <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                                </button>
                              )}
                              {idx < sortedSections.length - 1 && (
                                <button
                                  onClick={() => moveSectionDown(template.id, section.id)}
                                  className="p-1 hover:bg-slate-100 rounded"
                                >
                                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                                </button>
                              )}
                              <button
                                onClick={() => toggleSection(template.id, section.id)}
                                className="p-1 hover:bg-slate-100 rounded"
                                title={section.enabled ? "無効にする" : "有効にする"}
                              >
                                {section.enabled ? (
                                  <Eye className="w-4 h-4 text-green-500" />
                                ) : (
                                  <EyeOff className="w-4 h-4 text-slate-300" />
                                )}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">フッターテキスト</h4>
                      <input
                        type="text"
                        value={template.footerText}
                        onChange={(e) => updateFooter(template.id, e.target.value)}
                        placeholder="例: 社外秘 - 株式会社○○"
                        className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
                        style={{ borderColor: "var(--card-border)" }}
                      />
                    </div>

                    {/* Preview */}
                    <div className="bg-slate-50 rounded-lg p-4">
                      <h4 className="text-xs font-semibold text-slate-500 uppercase mb-3">出力プレビュー</h4>
                      <div className="bg-white border rounded-lg p-4 shadow-sm" style={{ borderColor: "var(--card-border)" }}>
                        <div className="text-center border-b pb-3 mb-3" style={{ borderColor: "var(--card-border)" }}>
                          <p className="text-xs text-slate-400">文書番号: WS-XXXXX | 改訂: 1.0</p>
                          <h5 className="font-bold text-sm text-slate-900 mt-1">{template.name}</h5>
                        </div>
                        <div className="space-y-2">
                          {sortedSections
                            .filter((s) => s.enabled)
                            .map((s) => (
                              <div key={s.id} className="flex items-center gap-2 text-xs text-slate-500">
                                <span>{sectionTypeIcons[s.type]}</span>
                                <span>{s.name}</span>
                                <div className="flex-1 border-b border-dashed" style={{ borderColor: "#e2e8f0" }} />
                              </div>
                            ))}
                        </div>
                        {template.footerText && (
                          <div className="text-center text-xs text-slate-400 mt-3 pt-3 border-t" style={{ borderColor: "var(--card-border)" }}>
                            {template.footerText}
                          </div>
                        )}
                      </div>
                    </div>
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
