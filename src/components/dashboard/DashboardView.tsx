"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useProjectStore } from "@/store/useProjectStore";
import {
  FolderOpen,
  FileCheck,
  Clock,
  Activity,
  PlusCircle,
  ArrowRight,
  Video,
  CheckCircle2,
  AlertCircle,
  Edit3,
  Eye,
  TrendingUp,
  BarChart3,
  Calendar,
  ClipboardCheck,
} from "lucide-react";
import type { ProjectStatus, ActivityItem } from "@/types";

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

const activityIcons: Record<ActivityItem["type"], typeof CheckCircle2> = {
  created: PlusCircle,
  updated: Edit3,
  published: CheckCircle2,
  reviewed: Eye,
  exported: FileCheck,
};

export default function DashboardView() {
  const { projects, dashboardStats, initializeDemoData, fetchProjects } = useProjectStore();

  useEffect(() => {
    fetchProjects().then(() => {
      const { projects } = useProjectStore.getState();
      if (projects.length === 0) initializeDemoData();
    });
  }, [fetchProjects, initializeDemoData]);

  const statCards = [
    {
      label: "全プロジェクト",
      value: dashboardStats.totalProjects,
      icon: FolderOpen,
      color: "#3b82f6",
      bgColor: "#dbeafe",
    },
    {
      label: "公開済み標準書",
      value: dashboardStats.publishedStandards,
      icon: FileCheck,
      color: "#10b981",
      bgColor: "#d1fae5",
    },
    {
      label: "レビュー待ち",
      value: dashboardStats.pendingReview,
      icon: Clock,
      color: "#f59e0b",
      bgColor: "#fef3c7",
    },
    {
      label: "分析中",
      value: dashboardStats.activeAnalysis,
      icon: Activity,
      color: "#8b5cf6",
      bgColor: "#ede9fe",
    },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">ダッシュボード</h1>
          <p className="text-slate-500 mt-1">動画から作業標準書を自動生成</p>
        </div>
        <Link href="/projects/new" className="btn-primary flex items-center gap-2">
          <PlusCircle className="w-5 h-5" />
          新規プロジェクト
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="card flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ background: stat.bgColor }}
              >
                <Icon className="w-6 h-6" style={{ color: stat.color }} />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{stat.value}</p>
                <p className="text-sm text-slate-500">{stat.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Projects */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-slate-900">最近のプロジェクト</h2>
            <Link
              href="/projects"
              className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              すべて表示 <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="space-y-3">
            {projects.slice(0, 5).map((project) => {
              const status = statusConfig[project.status];
              return (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-colors border"
                  style={{ borderColor: "var(--card-border)" }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                      <Video className="w-5 h-5 text-slate-500" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 text-sm">{project.name}</p>
                      <p className="text-xs text-slate-500">
                        {project.department} | {project.machineModel || "未設定"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className="badge text-xs"
                      style={{ background: status.bgColor, color: status.color }}
                    >
                      {status.label}
                    </span>
                    <span className="text-xs text-slate-400">
                      {new Date(project.updatedAt).toLocaleDateString("ja-JP")}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Activity Feed */}
        <div className="card">
          <h2 className="text-lg font-bold text-slate-900 mb-4">最近のアクティビティ</h2>
          <div className="space-y-4">
            {dashboardStats.recentActivity.map((activity) => {
              const Icon = activityIcons[activity.type] || Activity;
              return (
                <div key={activity.id} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-900">
                      <span className="font-medium">{activity.user}</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">{activity.details}</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {new Date(activity.timestamp).toLocaleString("ja-JP")}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Quick Actions & Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* Quick Actions */}
        <div className="card">
          <h2 className="text-lg font-bold text-slate-900 mb-4">クイックアクション</h2>
          <div className="grid grid-cols-2 gap-3">
            <Link
              href="/projects/new"
              className="p-4 rounded-lg border-2 border-dashed hover:border-blue-400 hover:bg-blue-50 transition-all text-center"
              style={{ borderColor: "var(--card-border)" }}
            >
              <Video className="w-8 h-8 mx-auto mb-2 text-blue-500" />
              <p className="text-sm font-medium">動画からSOP作成</p>
            </Link>
            <Link
              href="/projects/new"
              className="p-4 rounded-lg border-2 border-dashed hover:border-green-400 hover:bg-green-50 transition-all text-center"
              style={{ borderColor: "var(--card-border)" }}
            >
              <FileCheck className="w-8 h-8 mx-auto mb-2 text-green-500" />
              <p className="text-sm font-medium">テンプレートから作成</p>
            </Link>
            <Link
              href="/projects"
              className="p-4 rounded-lg border-2 border-dashed hover:border-purple-400 hover:bg-purple-50 transition-all text-center"
              style={{ borderColor: "var(--card-border)" }}
            >
              <ClipboardCheck className="w-8 h-8 mx-auto mb-2 text-purple-500" />
              <p className="text-sm font-medium">レビュー一覧</p>
            </Link>
            <Link
              href="/projects"
              className="p-4 rounded-lg border-2 border-dashed hover:border-amber-400 hover:bg-amber-50 transition-all text-center"
              style={{ borderColor: "var(--card-border)" }}
            >
              <BarChart3 className="w-8 h-8 mx-auto mb-2 text-amber-500" />
              <p className="text-sm font-medium">分析レポート</p>
            </Link>
          </div>
        </div>

        {/* Monthly Stats Chart */}
        <div className="card">
          <h2 className="text-lg font-bold text-slate-900 mb-4">月次サマリー</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-500" />
                <span className="text-sm text-slate-600">今月の作成数</span>
              </div>
              <span className="font-bold text-slate-900">3件</span>
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: "60%" }} />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-500" />
                <span className="text-sm text-slate-600">今月の公開数</span>
              </div>
              <span className="font-bold text-slate-900">1件</span>
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: "20%" }} />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500" />
                <span className="text-sm text-slate-600">改訂率</span>
              </div>
              <span className="font-bold text-slate-900">15%</span>
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: "15%" }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
