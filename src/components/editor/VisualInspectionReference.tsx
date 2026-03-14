"use client";

import { useState } from "react";
import {
  Eye,
  ImagePlus,
  CheckCircle2,
  XCircle,
  ZoomIn,
  ArrowLeftRight,
  Plus,
  Trash2,
  Camera,
  Tag,
} from "lucide-react";

interface ReferenceImage {
  id: string;
  type: "good" | "defect";
  label: string;
  description: string;
  imageUrl: string;
  defectType?: string;
  severity?: "minor" | "major" | "critical";
  category: string;
}

const demoReferences: ReferenceImage[] = [
  {
    id: "ref-1",
    type: "good",
    label: "良品基準 - テーブル面",
    description: "傷・打痕のない良品テーブル面。均一な光沢があること。",
    imageUrl: "/api/placeholder/good-surface.jpg",
    category: "テーブル面",
  },
  {
    id: "ref-2",
    type: "defect",
    label: "不良例 - テーブル面の傷",
    description: "テーブル面に線状の傷が発生。幅0.1mm以上の傷は不合格。",
    imageUrl: "/api/placeholder/defect-scratch.jpg",
    defectType: "傷",
    severity: "major",
    category: "テーブル面",
  },
  {
    id: "ref-3",
    type: "defect",
    label: "不良例 - 打痕",
    description: "テーブル面の打痕。深さ0.05mm以上の打痕は不合格。",
    imageUrl: "/api/placeholder/defect-dent.jpg",
    defectType: "打痕",
    severity: "critical",
    category: "テーブル面",
  },
  {
    id: "ref-4",
    type: "good",
    label: "良品基準 - T溝",
    description: "T溝内部に錆・バリがないこと。溝幅が均一であること。",
    imageUrl: "/api/placeholder/good-tslot.jpg",
    category: "T溝",
  },
  {
    id: "ref-5",
    type: "defect",
    label: "不良例 - T溝の錆",
    description: "T溝内部に錆が発生。防錆処理不良または長期放置が原因。",
    imageUrl: "/api/placeholder/defect-rust.jpg",
    defectType: "錆",
    severity: "minor",
    category: "T溝",
  },
  {
    id: "ref-6",
    type: "good",
    label: "良品基準 - ダイヤルゲージ設置",
    description: "正しいダイヤルゲージ設置例。測定子がテーブル中心に対して直角。",
    imageUrl: "/api/placeholder/good-gauge-setup.jpg",
    category: "測定器設置",
  },
  {
    id: "ref-7",
    type: "defect",
    label: "不良例 - ゲージ設置ミス",
    description: "測定子の角度が不適切。この状態では正確な測定ができない。",
    imageUrl: "/api/placeholder/defect-gauge-bad.jpg",
    defectType: "設置不良",
    severity: "major",
    category: "測定器設置",
  },
];

export default function VisualInspectionReference() {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"grid" | "comparison">("grid");
  const [compareGood, setCompareGood] = useState<ReferenceImage | null>(null);
  const [compareDefect, setCompareDefect] = useState<ReferenceImage | null>(null);

  const categories = [...new Set(demoReferences.map((r) => r.category))];
  const filtered =
    selectedCategory === "all"
      ? demoReferences
      : demoReferences.filter((r) => r.category === selectedCategory);

  const goodItems = filtered.filter((r) => r.type === "good");
  const defectItems = filtered.filter((r) => r.type === "defect");

  const severityConfig = {
    minor: { label: "軽微", color: "#f59e0b", bg: "#fef3c7" },
    major: { label: "重大", color: "#f97316", bg: "#fed7aa" },
    critical: { label: "致命的", color: "#ef4444", bg: "#fee2e2" },
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Eye className="w-6 h-6 text-blue-500" />
            ビジュアル検査基準（良品/不良品比較）
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode("grid")}
              className={`px-3 py-1.5 text-sm rounded-lg ${
                viewMode === "grid" ? "bg-blue-100 text-blue-700" : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              一覧表示
            </button>
            <button
              onClick={() => setViewMode("comparison")}
              className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-1 ${
                viewMode === "comparison"
                  ? "bg-blue-100 text-blue-700"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              <ArrowLeftRight className="w-4 h-4" />
              比較モード
            </button>
            <button className="btn-primary flex items-center gap-1.5 text-sm">
              <ImagePlus className="w-4 h-4" />
              画像追加
            </button>
          </div>
        </div>

        {/* Category Filter */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setSelectedCategory("all")}
            className={`px-3 py-1.5 text-sm rounded-full ${
              selectedCategory === "all"
                ? "bg-blue-500 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            すべて
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 text-sm rounded-full ${
                selectedCategory === cat
                  ? "bg-blue-500 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {viewMode === "grid" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Good Examples */}
          <div>
            <h3 className="font-bold text-green-700 mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              良品基準（{goodItems.length}件）
            </h3>
            <div className="space-y-3">
              {goodItems.map((item) => (
                <div
                  key={item.id}
                  className="card border-l-4"
                  style={{ borderLeftColor: "#10b981" }}
                >
                  <div className="flex gap-4">
                    <div className="w-32 h-24 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0 text-xs text-green-400 border border-green-200">
                      良品画像
                    </div>
                    <div>
                      <h4 className="font-medium text-sm text-slate-900 mb-1">{item.label}</h4>
                      <p className="text-xs text-slate-600">{item.description}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="badge badge-success text-xs">良品</span>
                        <span className="text-xs text-slate-400">{item.category}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Defect Examples */}
          <div>
            <h3 className="font-bold text-red-700 mb-3 flex items-center gap-2">
              <XCircle className="w-5 h-5" />
              不良品例（{defectItems.length}件）
            </h3>
            <div className="space-y-3">
              {defectItems.map((item) => {
                const sev = item.severity ? severityConfig[item.severity] : null;
                return (
                  <div
                    key={item.id}
                    className="card border-l-4"
                    style={{ borderLeftColor: sev?.color || "#ef4444" }}
                  >
                    <div className="flex gap-4">
                      <div className="w-32 h-24 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0 text-xs text-red-400 border border-red-200">
                        不良画像
                      </div>
                      <div>
                        <h4 className="font-medium text-sm text-slate-900 mb-1">{item.label}</h4>
                        <p className="text-xs text-slate-600">{item.description}</p>
                        <div className="flex items-center gap-2 mt-2">
                          {sev && (
                            <span
                              className="badge text-xs"
                              style={{ background: sev.bg, color: sev.color }}
                            >
                              {sev.label}
                            </span>
                          )}
                          {item.defectType && (
                            <span className="badge badge-danger text-xs flex items-center gap-1">
                              <Tag className="w-3 h-3" />
                              {item.defectType}
                            </span>
                          )}
                          <span className="text-xs text-slate-400">{item.category}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* Comparison Mode */
        <div className="card">
          <h3 className="font-bold text-slate-900 mb-4 text-center">良品 / 不良品 比較ビュー</h3>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium text-green-700 mb-3 text-center flex items-center justify-center gap-1">
                <CheckCircle2 className="w-4 h-4" />
                良品基準
              </h4>
              <div className="space-y-3">
                {goodItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setCompareGood(item)}
                    className={`w-full p-3 rounded-lg border-2 text-left transition-all ${
                      compareGood?.id === item.id
                        ? "border-green-500 bg-green-50"
                        : "border-slate-200 hover:border-green-300"
                    }`}
                  >
                    <div className="h-32 bg-green-50 rounded-lg mb-2 flex items-center justify-center text-sm text-green-400">
                      良品画像
                    </div>
                    <p className="text-sm font-medium">{item.label}</p>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <h4 className="font-medium text-red-700 mb-3 text-center flex items-center justify-center gap-1">
                <XCircle className="w-4 h-4" />
                不良品例
              </h4>
              <div className="space-y-3">
                {defectItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setCompareDefect(item)}
                    className={`w-full p-3 rounded-lg border-2 text-left transition-all ${
                      compareDefect?.id === item.id
                        ? "border-red-500 bg-red-50"
                        : "border-slate-200 hover:border-red-300"
                    }`}
                  >
                    <div className="h-32 bg-red-50 rounded-lg mb-2 flex items-center justify-center text-sm text-red-400">
                      不良画像
                    </div>
                    <p className="text-sm font-medium">{item.label}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {(compareGood || compareDefect) && (
            <div className="mt-6 p-4 bg-slate-50 rounded-lg">
              <h4 className="font-bold text-slate-900 mb-3 text-center">比較詳細</h4>
              <div className="grid grid-cols-2 gap-6">
                <div className="text-center">
                  {compareGood ? (
                    <>
                      <div className="h-48 bg-green-100 rounded-lg mb-2 flex items-center justify-center text-green-500 border-2 border-green-300">
                        良品画像（拡大）
                      </div>
                      <p className="text-sm font-medium text-green-700">{compareGood.label}</p>
                      <p className="text-xs text-slate-500 mt-1">{compareGood.description}</p>
                    </>
                  ) : (
                    <div className="h-48 bg-slate-200 rounded-lg flex items-center justify-center text-slate-400 text-sm">
                      良品画像を選択
                    </div>
                  )}
                </div>
                <div className="text-center">
                  {compareDefect ? (
                    <>
                      <div className="h-48 bg-red-100 rounded-lg mb-2 flex items-center justify-center text-red-500 border-2 border-red-300">
                        不良品画像（拡大）
                      </div>
                      <p className="text-sm font-medium text-red-700">{compareDefect.label}</p>
                      <p className="text-xs text-slate-500 mt-1">{compareDefect.description}</p>
                    </>
                  ) : (
                    <div className="h-48 bg-slate-200 rounded-lg flex items-center justify-center text-slate-400 text-sm">
                      不良品画像を選択
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
