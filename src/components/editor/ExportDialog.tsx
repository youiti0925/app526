"use client";

import { useState } from "react";
import {
  X,
  Download,
  FileText,
  Table,
  FileType,
  Globe,
  Printer,
  QrCode,
  CheckSquare,
  Layout,
  History,
  Image,
  Link2,
} from "lucide-react";
import type { ExportOptions } from "@/types";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (options: ExportOptions) => void;
  documentTitle: string;
}

const formatOptions = [
  { value: "pdf" as const, label: "PDF", icon: FileText, description: "印刷向き、配布用" },
  { value: "excel" as const, label: "Excel", icon: Table, description: "データ編集、帳票管理" },
  { value: "word" as const, label: "Word", icon: FileType, description: "文書編集、レビュー用" },
  { value: "html" as const, label: "HTML", icon: Globe, description: "Web表示、オンライン共有" },
];

const languageOptions = [
  { value: "ja" as const, label: "日本語" },
  { value: "en" as const, label: "English" },
  { value: "zh" as const, label: "中文" },
  { value: "ko" as const, label: "한국어" },
  { value: "vi" as const, label: "Tiếng Việt" },
  { value: "th" as const, label: "ภาษาไทย" },
];

const templateOptions = [
  { value: "standard" as const, label: "標準", description: "一般的な作業標準書フォーマット" },
  { value: "detailed" as const, label: "詳細", description: "全情報を含む詳細版" },
  { value: "simplified" as const, label: "簡易版", description: "要点のみのクイックリファレンス" },
  { value: "training" as const, label: "教育用", description: "トレーニング・研修向け" },
];

export default function ExportDialog({ isOpen, onClose, onExport, documentTitle }: ExportDialogProps) {
  const [options, setOptions] = useState<ExportOptions>({
    format: "pdf",
    includeImages: true,
    includeVideoLinks: true,
    language: "ja",
    template: "standard",
    paperSize: "A4",
    orientation: "portrait",
    includeQRCode: true,
    includeRevisionHistory: true,
  });

  if (!isOpen) return null;

  const handleExport = () => {
    onExport(options);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "var(--card-border)" }}>
          <div>
            <h2 className="text-lg font-bold text-slate-900">エクスポート設定</h2>
            <p className="text-sm text-slate-500">{documentTitle}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Format Selection */}
          <div>
            <label className="text-sm font-semibold text-slate-700 mb-3 block">出力フォーマット</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {formatOptions.map((fmt) => {
                const Icon = fmt.icon;
                const isSelected = options.format === fmt.value;
                return (
                  <button
                    key={fmt.value}
                    onClick={() => setOptions({ ...options, format: fmt.value })}
                    className={`p-4 rounded-lg border-2 text-center transition-all ${
                      isSelected
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <Icon className={`w-8 h-8 mx-auto mb-2 ${isSelected ? "text-blue-500" : "text-slate-400"}`} />
                    <p className={`text-sm font-medium ${isSelected ? "text-blue-700" : "text-slate-700"}`}>{fmt.label}</p>
                    <p className="text-xs text-slate-500 mt-1">{fmt.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Template */}
          <div>
            <label className="text-sm font-semibold text-slate-700 mb-3 block">テンプレート</label>
            <div className="grid grid-cols-2 gap-3">
              {templateOptions.map((tmpl) => {
                const isSelected = options.template === tmpl.value;
                return (
                  <button
                    key={tmpl.value}
                    onClick={() => setOptions({ ...options, template: tmpl.value })}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      isSelected
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <p className={`text-sm font-medium ${isSelected ? "text-blue-700" : "text-slate-700"}`}>{tmpl.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{tmpl.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Language */}
          <div>
            <label className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Globe className="w-4 h-4" />
              出力言語
            </label>
            <div className="flex flex-wrap gap-2">
              {languageOptions.map((lang) => (
                <button
                  key={lang.value}
                  onClick={() => setOptions({ ...options, language: lang.value })}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    options.language === lang.value
                      ? "bg-blue-500 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>

          {/* Paper Settings */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                <Printer className="w-4 h-4" />
                用紙サイズ
              </label>
              <select
                value={options.paperSize}
                onChange={(e) => setOptions({ ...options, paperSize: e.target.value as ExportOptions["paperSize"] })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                <option value="A4">A4</option>
                <option value="A3">A3</option>
                <option value="Letter">Letter</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                <Layout className="w-4 h-4" />
                向き
              </label>
              <select
                value={options.orientation}
                onChange={(e) => setOptions({ ...options, orientation: e.target.value as ExportOptions["orientation"] })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                <option value="portrait">縦向き</option>
                <option value="landscape">横向き</option>
              </select>
            </div>
          </div>

          {/* Toggle Options */}
          <div>
            <label className="text-sm font-semibold text-slate-700 mb-3 block">含める項目</label>
            <div className="space-y-3">
              {[
                { key: "includeImages" as const, label: "ステップ画像", icon: Image },
                { key: "includeVideoLinks" as const, label: "動画リンク（QRコード）", icon: Link2 },
                { key: "includeQRCode" as const, label: "アクセスQRコード", icon: QrCode },
                { key: "includeRevisionHistory" as const, label: "改訂履歴", icon: History },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <label key={item.key} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={options[item.key]}
                      onChange={(e) => setOptions({ ...options, [item.key]: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <Icon className="w-4 h-4 text-slate-400" />
                    <span className="text-sm text-slate-700">{item.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-5 border-t" style={{ borderColor: "var(--card-border)" }}>
          <button onClick={onClose} className="btn-secondary">
            キャンセル
          </button>
          <button onClick={handleExport} className="btn-primary flex items-center gap-2">
            <Download className="w-4 h-4" />
            エクスポート
          </button>
        </div>
      </div>
    </div>
  );
}
