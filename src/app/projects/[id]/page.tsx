"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Sidebar from "@/components/ui/Sidebar";
import Header from "@/components/ui/Header";
import VideoPlayer from "@/components/video/VideoPlayer";
import AnalysisView from "@/components/video/AnalysisView";
import WorkStandardEditor from "@/components/editor/WorkStandardEditor";
import ExportDialog from "@/components/editor/ExportDialog";
import PreviewDialog from "@/components/editor/PreviewDialog";
import InspectionChecklist from "@/components/editor/InspectionChecklist";
import VisualInspectionReference from "@/components/editor/VisualInspectionReference";
import SpeechToText from "@/components/video/SpeechToText";
import MobileViewer from "@/components/ui/MobileViewer";
import TrainingManagement from "@/components/dashboard/TrainingManagement";
import AnalyticsDashboard from "@/components/dashboard/AnalyticsDashboard";
import { useProjectStore } from "@/store/useProjectStore";
import { generateDemoWorkStandard, generateDemoAnalysisResult } from "@/lib/demo-data";
import {
  ArrowLeft,
  Video,
  Brain,
  FileEdit,
  Download,
  CheckCircle2,
  Settings,
  Clock,
  Users,
  Send,
  ClipboardCheck,
  Eye,
  Smartphone,
  GraduationCap,
  BarChart3,
  Mic,
} from "lucide-react";
import type { AnalysisResult, WorkStandard, ExportOptions, ProjectStatus } from "@/types";
import { v4 as uuidv4 } from "uuid";

type ViewMode = "video" | "analysis" | "editor" | "checklist" | "visual-ref" | "mobile" | "training" | "analytics";

const statusConfig: Record<ProjectStatus, { label: string; color: string; bgColor: string }> = {
  draft: { label: "下書き", color: "#64748b", bgColor: "#f1f5f9" },
  "video-uploaded": { label: "動画アップロード済", color: "#8b5cf6", bgColor: "#ede9fe" },
  analyzing: { label: "AI分析中", color: "#f59e0b", bgColor: "#fef3c7" },
  analyzed: { label: "分析完了", color: "#06b6d4", bgColor: "#cffafe" },
  editing: { label: "編集中", color: "#3b82f6", bgColor: "#dbeafe" },
  review: { label: "レビュー中", color: "#f97316", bgColor: "#fed7aa" },
  approved: { label: "承認済", color: "#10b981", bgColor: "#d1fae5" },
  published: { label: "公開済", color: "#059669", bgColor: "#a7f3d0" },
};

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const {
    projects,
    currentProject,
    setCurrentProject,
    updateProject,
    currentWorkStandard,
    setWorkStandard,
    updateWorkStandard,
    analysisResult,
    setAnalysisResult,
    isAnalyzing,
    setIsAnalyzing,
    updateStep,
    deleteStep,
    addStep,
    reorderSteps,
    initializeDemoData,
  } = useProjectStore();

  const [viewMode, setViewMode] = useState<ViewMode>("video");
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [videoTime, setVideoTime] = useState(0);

  useEffect(() => {
    if (projects.length === 0) initializeDemoData();
  }, [projects.length, initializeDemoData]);

  useEffect(() => {
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      setCurrentProject(project);
      // Load demo work standard for published/review/editing projects
      if (["published", "review", "editing", "analyzed", "approved"].includes(project.status)) {
        const ws = generateDemoWorkStandard(projectId);
        setWorkStandard(ws);
        setAnalysisResult(generateDemoAnalysisResult());
        if (["editing", "published", "review", "approved"].includes(project.status)) {
          setViewMode("editor");
        }
      }
    }
  }, [projectId, projects, setCurrentProject, setWorkStandard, setAnalysisResult]);

  if (!currentProject) {
    return (
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex-1 flex flex-col">
          <Header />
          <main className="flex-1 bg-slate-50 flex items-center justify-center">
            <div className="text-center">
              <p className="text-slate-500 mb-4">プロジェクトを読み込み中...</p>
            </div>
          </main>
        </div>
      </div>
    );
  }

  const status = statusConfig[currentProject.status];

  const handleStartAnalysis = () => {
    setIsAnalyzing(true);
    updateProject(projectId, { status: "analyzing" });
  };

  const handleAnalysisComplete = (result: AnalysisResult) => {
    setAnalysisResult(result);
    setIsAnalyzing(false);
    updateProject(projectId, { status: "analyzed" });
  };

  const handleGenerateWorkStandard = () => {
    const ws = generateDemoWorkStandard(projectId);
    setWorkStandard(ws);
    updateProject(projectId, { status: "editing" });
    setViewMode("editor");
  };

  const handleExport = (options: ExportOptions) => {
    // Simulate export
    alert(`${options.format.toUpperCase()} 形式でエクスポートを開始しました。\nテンプレート: ${options.template}\n言語: ${options.language}`);
  };

  const handleAddStep = () => {
    addStep({
      stepNumber: (currentWorkStandard?.steps.length || 0) + 1,
      title: "新しいステップ",
      description: "",
      detailedInstructions: "",
      keyPoints: [],
      cautions: [],
      thumbnailUrl: "",
      videoTimestamp: { start: 0, end: 0 },
      estimatedTime: 60,
      tools: [],
      annotations: [],
      category: "operation",
    });
  };

  const handleSubmitForReview = () => {
    updateProject(projectId, { status: "review" });
  };

  const handleApprove = () => {
    updateProject(projectId, { status: "approved" });
  };

  const handlePublish = () => {
    updateProject(projectId, { status: "published" });
  };

  const modeButtons = [
    { mode: "video" as ViewMode, label: "動画", icon: Video },
    { mode: "analysis" as ViewMode, label: "AI分析", icon: Brain },
    { mode: "editor" as ViewMode, label: "編集", icon: FileEdit },
    { mode: "checklist" as ViewMode, label: "検査チェック", icon: ClipboardCheck },
    { mode: "visual-ref" as ViewMode, label: "外観基準", icon: Eye },
    { mode: "training" as ViewMode, label: "トレーニング", icon: GraduationCap },
    { mode: "mobile" as ViewMode, label: "モバイル", icon: Smartphone },
    { mode: "analytics" as ViewMode, label: "分析", icon: BarChart3 },
  ];

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 bg-slate-50">
          {/* Project Header */}
          <div className="border-b px-6 py-4" style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
            <div className="max-w-7xl mx-auto">
              <button
                onClick={() => router.push("/projects")}
                className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-3"
              >
                <ArrowLeft className="w-4 h-4" />
                プロジェクト一覧
              </button>

              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h1 className="text-xl font-bold text-slate-900">{currentProject.name}</h1>
                    <span
                      className="badge"
                      style={{ background: status.bgColor, color: status.color }}
                    >
                      {status.label}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500">{currentProject.description}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      更新: {new Date(currentProject.updatedAt).toLocaleString("ja-JP")}
                    </span>
                    {currentProject.department && (
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {currentProject.department}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {currentProject.status === "editing" && (
                    <button onClick={handleSubmitForReview} className="btn-secondary flex items-center gap-1.5 text-sm">
                      <Send className="w-4 h-4" />
                      レビュー依頼
                    </button>
                  )}
                  {currentProject.status === "review" && (
                    <button onClick={handleApprove} className="btn-primary flex items-center gap-1.5 text-sm" style={{ background: "#10b981" }}>
                      <CheckCircle2 className="w-4 h-4" />
                      承認
                    </button>
                  )}
                  {currentProject.status === "approved" && (
                    <button onClick={handlePublish} className="btn-primary flex items-center gap-1.5 text-sm" style={{ background: "#059669" }}>
                      <Send className="w-4 h-4" />
                      公開
                    </button>
                  )}
                  {currentWorkStandard && (
                    <button onClick={() => setShowExportDialog(true)} className="btn-secondary flex items-center gap-1.5 text-sm">
                      <Download className="w-4 h-4" />
                      エクスポート
                    </button>
                  )}
                </div>
              </div>

              {/* View Mode Tabs */}
              <div className="flex gap-1 mt-4">
                {modeButtons.map((btn) => {
                  const Icon = btn.icon;
                  return (
                    <button
                      key={btn.mode}
                      onClick={() => setViewMode(btn.mode)}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                        viewMode === btn.mode
                          ? "bg-slate-50 text-blue-600 border border-b-0"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                      style={viewMode === btn.mode ? { borderColor: "var(--card-border)" } : {}}
                    >
                      <Icon className="w-4 h-4" />
                      {btn.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Content Area */}
          <div className="p-6 max-w-7xl mx-auto">
            {viewMode === "video" && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  <VideoPlayer
                    currentTime={videoTime}
                    onTimeUpdate={setVideoTime}
                    markers={
                      analysisResult?.scenes.map((s) => ({
                        time: s.startTime,
                        label: s.description,
                        color: "#3b82f6",
                      })) || []
                    }
                  />
                </div>
                <div className="space-y-4">
                  <div className="card">
                    <h3 className="font-bold text-slate-900 mb-3">プロジェクト情報</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">カテゴリ</span>
                        <span className="font-medium">{currentProject.category}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">機械型式</span>
                        <span className="font-medium">{currentProject.machineModel || "未設定"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">部門</span>
                        <span className="font-medium">{currentProject.department || "未設定"}</span>
                      </div>
                    </div>
                  </div>

                  {!analysisResult && !isAnalyzing && (
                    <button
                      onClick={handleStartAnalysis}
                      className="w-full btn-primary flex items-center justify-center gap-2 py-3"
                    >
                      <Brain className="w-5 h-5" />
                      AI分析を開始
                    </button>
                  )}

                  {analysisResult && !currentWorkStandard && (
                    <button
                      onClick={handleGenerateWorkStandard}
                      className="w-full btn-primary flex items-center justify-center gap-2 py-3"
                      style={{ background: "#10b981" }}
                    >
                      <FileEdit className="w-5 h-5" />
                      作業標準書を生成
                    </button>
                  )}

                  <SpeechToText hasAudio={false} />
                </div>
              </div>
            )}

            {viewMode === "analysis" && (
              <AnalysisView
                analysisResult={analysisResult}
                isAnalyzing={isAnalyzing}
                onAnalysisComplete={handleAnalysisComplete}
                onStartAnalysis={handleStartAnalysis}
                onSceneClick={(scene) => setVideoTime(scene.startTime)}
              />
            )}

            {viewMode === "editor" && currentWorkStandard && (
              <WorkStandardEditor
                workStandard={currentWorkStandard}
                onUpdate={updateWorkStandard}
                onStepUpdate={updateStep}
                onStepDelete={deleteStep}
                onStepAdd={handleAddStep}
                onStepReorder={reorderSteps}
                onExport={() => setShowExportDialog(true)}
                onPreview={() => setShowPreviewDialog(true)}
              />
            )}

            {viewMode === "editor" && !currentWorkStandard && (
              <div className="card text-center py-16">
                <FileEdit className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-slate-900 mb-2">作業標準書がありません</h3>
                <p className="text-slate-500 mb-6">
                  まずAI分析を実行してから、作業標準書を生成してください。
                </p>
                <button
                  onClick={() => setViewMode("analysis")}
                  className="btn-primary flex items-center gap-2 mx-auto"
                >
                  <Brain className="w-5 h-5" />
                  AI分析へ進む
                </button>
              </div>
            )}

            {viewMode === "checklist" && (
              <InspectionChecklist
                projectName={currentProject.name}
                machineModel={currentProject.machineModel || "CRT-320"}
              />
            )}

            {viewMode === "visual-ref" && <VisualInspectionReference />}

            {viewMode === "training" && <TrainingManagement />}

            {viewMode === "mobile" && (
              <MobileViewer
                sopTitle={currentProject.name}
                currentStep={0}
                totalSteps={7}
              />
            )}

            {viewMode === "analytics" && <AnalyticsDashboard />}
          </div>

          {/* Export Dialog */}
          {currentWorkStandard && (
            <>
              <ExportDialog
                isOpen={showExportDialog}
                onClose={() => setShowExportDialog(false)}
                onExport={handleExport}
                documentTitle={currentWorkStandard.title}
              />
              <PreviewDialog
                isOpen={showPreviewDialog}
                onClose={() => setShowPreviewDialog(false)}
                workStandard={currentWorkStandard}
              />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
