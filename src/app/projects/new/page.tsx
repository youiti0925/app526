"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/ui/Sidebar";
import Header from "@/components/ui/Header";
import VideoUploader from "@/components/video/VideoUploader";
import { useProjectStore } from "@/store/useProjectStore";
import { inspectionTemplates } from "@/lib/demo-data";
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  Video,
  Settings,
  CheckCircle2,
  Sparkles,
  Layout,
} from "lucide-react";
import type { ProjectCategory } from "@/types";

const categoryOptions: { value: ProjectCategory; label: string; description: string }[] = [
  { value: "inspection", label: "検査", description: "精度検査・品質検査など" },
  { value: "assembly", label: "組立", description: "製品・部品の組立作業" },
  { value: "maintenance", label: "メンテナンス", description: "設備保全・定期点検" },
  { value: "setup", label: "段取り", description: "機械のセットアップ作業" },
  { value: "quality-check", label: "品質チェック", description: "品質確認・受入検査" },
  { value: "other", label: "その他", description: "その他の作業" },
];

type Step = 1 | 2 | 3 | 4;

export default function NewProjectPage() {
  const router = useRouter();
  const { addProject } = useProjectStore();
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    category: "inspection" as ProjectCategory,
    department: "",
    machineModel: "",
    inspectionType: "",
    tags: [] as string[],
    templateId: "",
  });
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string>("");
  const [tagInput, setTagInput] = useState("");

  const steps = [
    { num: 1, label: "基本情報", icon: FileText },
    { num: 2, label: "動画アップロード", icon: Video },
    { num: 3, label: "テンプレート選択", icon: Layout },
    { num: 4, label: "確認", icon: CheckCircle2 },
  ];

  const handleAddTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData({ ...formData, tags: [...formData.tags, tagInput.trim()] });
      setTagInput("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    setFormData({ ...formData, tags: formData.tags.filter((t) => t !== tag) });
  };

  const handleCreate = async () => {
    const project = await addProject({
      name: formData.name,
      description: formData.description,
      category: formData.category,
      tags: formData.tags,
      department: formData.department,
      machineModel: formData.machineModel,
      inspectionType: formData.inspectionType,
    });
    router.push(`/projects/${project.id}`);
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1: return formData.name.trim() !== "";
      case 2: return true; // Video is optional
      case 3: return true;
      case 4: return true;
      default: return false;
    }
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 bg-slate-50 p-6">
          <div className="max-w-3xl mx-auto">
            {/* Back Button */}
            <button
              onClick={() => router.back()}
              className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 mb-6"
            >
              <ArrowLeft className="w-4 h-4" />
              戻る
            </button>

            <h1 className="text-2xl font-bold text-slate-900 mb-2">新規プロジェクト作成</h1>
            <p className="text-slate-500 mb-8">動画から作業標準書を作成します</p>

            {/* Step Indicator */}
            <div className="flex items-center justify-between mb-8">
              {steps.map((step, i) => {
                const Icon = step.icon;
                const isActive = currentStep === step.num;
                const isComplete = currentStep > step.num;
                return (
                  <div key={step.num} className="flex items-center gap-3 flex-1">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                        isActive
                          ? "bg-blue-600 text-white"
                          : isComplete
                          ? "bg-green-500 text-white"
                          : "bg-slate-200 text-slate-400"
                      }`}
                    >
                      {isComplete ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                    </div>
                    <span className={`text-sm font-medium ${isActive ? "text-blue-600" : isComplete ? "text-green-600" : "text-slate-400"}`}>
                      {step.label}
                    </span>
                    {i < steps.length - 1 && (
                      <div className={`flex-1 h-0.5 mx-4 ${isComplete ? "bg-green-500" : "bg-slate-200"}`} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Step Content */}
            {currentStep === 1 && (
              <div className="card space-y-6 slide-in">
                <div>
                  <label className="text-sm font-semibold text-slate-700 mb-2 block">
                    プロジェクト名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="例: 円テーブル回転精度検査"
                    className="w-full border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    style={{ borderColor: "var(--card-border)" }}
                  />
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700 mb-2 block">説明</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="この作業標準書の概要を記入してください"
                    rows={3}
                    className="w-full border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    style={{ borderColor: "var(--card-border)" }}
                  />
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700 mb-2 block">カテゴリ</label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {categoryOptions.map((cat) => (
                      <button
                        key={cat.value}
                        onClick={() => setFormData({ ...formData, category: cat.value })}
                        className={`p-3 rounded-lg border-2 text-left transition-all ${
                          formData.category === cat.value
                            ? "border-blue-500 bg-blue-50"
                            : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <p className={`text-sm font-medium ${formData.category === cat.value ? "text-blue-700" : "text-slate-700"}`}>
                          {cat.label}
                        </p>
                        <p className="text-xs text-slate-500">{cat.description}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-sm font-semibold text-slate-700 mb-2 block">部門</label>
                    <input
                      type="text"
                      value={formData.department}
                      onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                      placeholder="品質管理部"
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      style={{ borderColor: "var(--card-border)" }}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700 mb-2 block">機械型式</label>
                    <input
                      type="text"
                      value={formData.machineModel}
                      onChange={(e) => setFormData({ ...formData, machineModel: e.target.value })}
                      placeholder="CRT-320"
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      style={{ borderColor: "var(--card-border)" }}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700 mb-2 block">検査種別</label>
                    <input
                      type="text"
                      value={formData.inspectionType}
                      onChange={(e) => setFormData({ ...formData, inspectionType: e.target.value })}
                      placeholder="定期検査"
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      style={{ borderColor: "var(--card-border)" }}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700 mb-2 block">タグ</label>
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddTag())}
                      placeholder="タグを入力してEnter"
                      className="flex-1 border rounded-lg px-3 py-2 text-sm"
                      style={{ borderColor: "var(--card-border)" }}
                    />
                    <button onClick={handleAddTag} className="btn-secondary text-sm">追加</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {formData.tags.map((tag) => (
                      <span key={tag} className="badge badge-info flex items-center gap-1">
                        {tag}
                        <button onClick={() => handleRemoveTag(tag)} className="text-blue-500 hover:text-blue-700 ml-1">×</button>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className="slide-in">
                <VideoUploader
                  onUploadComplete={(file, url) => {
                    setVideoFile(file);
                    setVideoPreviewUrl(url);
                  }}
                />
                <div className="card mt-4">
                  <div className="flex items-center gap-2 text-amber-600 mb-2">
                    <Sparkles className="w-5 h-5" />
                    <p className="font-medium text-sm">動画をスキップすることもできます</p>
                  </div>
                  <p className="text-sm text-slate-500">
                    動画なしでもテンプレートから作業標準書を作成できます。後から動画を追加することも可能です。
                  </p>
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className="space-y-4 slide-in">
                <div className="card">
                  <h3 className="font-bold text-slate-900 mb-4">テンプレートを選択（任意）</h3>
                  <div className="space-y-3">
                    <button
                      onClick={() => setFormData({ ...formData, templateId: "" })}
                      className={`w-full p-4 rounded-lg border-2 text-left transition-all ${
                        formData.templateId === "" ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <p className="font-medium text-sm">テンプレートなし（空のプロジェクト）</p>
                      <p className="text-xs text-slate-500 mt-1">AI分析の結果からゼロベースで作業標準書を作成</p>
                    </button>
                    {inspectionTemplates.map((tmpl) => (
                      <button
                        key={tmpl.id}
                        onClick={() => setFormData({ ...formData, templateId: tmpl.id })}
                        className={`w-full p-4 rounded-lg border-2 text-left transition-all ${
                          formData.templateId === tmpl.id ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-medium text-sm">{tmpl.name}</p>
                          <span className="badge badge-info text-xs">{tmpl.presetSteps.length}ステップ</span>
                        </div>
                        <p className="text-xs text-slate-500">{tmpl.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {currentStep === 4 && (
              <div className="card space-y-4 slide-in">
                <h3 className="font-bold text-slate-900 mb-2">プロジェクト設定の確認</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-2 border-b" style={{ borderColor: "var(--card-border)" }}>
                    <span className="text-sm text-slate-500">プロジェクト名</span>
                    <span className="text-sm font-medium">{formData.name}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b" style={{ borderColor: "var(--card-border)" }}>
                    <span className="text-sm text-slate-500">カテゴリ</span>
                    <span className="text-sm font-medium">{categoryOptions.find((c) => c.value === formData.category)?.label}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b" style={{ borderColor: "var(--card-border)" }}>
                    <span className="text-sm text-slate-500">部門</span>
                    <span className="text-sm font-medium">{formData.department || "未設定"}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b" style={{ borderColor: "var(--card-border)" }}>
                    <span className="text-sm text-slate-500">機械型式</span>
                    <span className="text-sm font-medium">{formData.machineModel || "未設定"}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b" style={{ borderColor: "var(--card-border)" }}>
                    <span className="text-sm text-slate-500">動画</span>
                    <span className="text-sm font-medium">{videoFile ? videoFile.name : "なし"}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b" style={{ borderColor: "var(--card-border)" }}>
                    <span className="text-sm text-slate-500">テンプレート</span>
                    <span className="text-sm font-medium">
                      {formData.templateId
                        ? inspectionTemplates.find((t) => t.id === formData.templateId)?.name
                        : "なし"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Navigation Buttons */}
            <div className="flex items-center justify-between mt-6">
              <button
                onClick={() => setCurrentStep((currentStep - 1) as Step)}
                disabled={currentStep === 1}
                className="btn-secondary flex items-center gap-2 disabled:opacity-50"
              >
                <ArrowLeft className="w-4 h-4" />
                前へ
              </button>

              {currentStep < 4 ? (
                <button
                  onClick={() => setCurrentStep((currentStep + 1) as Step)}
                  disabled={!canProceed()}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50"
                >
                  次へ
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button onClick={handleCreate} className="btn-primary flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  プロジェクトを作成
                </button>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
