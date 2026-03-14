"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Sidebar from "@/components/ui/Sidebar";
import Header from "@/components/ui/Header";
import { useProjectStore } from "@/store/useProjectStore";
import {
  Search,
  Filter,
  Grid3X3,
  List,
  PlusCircle,
  Video,
  MoreVertical,
  Calendar,
  Tag,
  ChevronDown,
} from "lucide-react";
import type { ProjectCategory, ProjectStatus } from "@/types";

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

const categoryLabels: Record<ProjectCategory, string> = {
  inspection: "検査",
  assembly: "組立",
  maintenance: "メンテナンス",
  setup: "段取り",
  "quality-check": "品質チェック",
  other: "その他",
};

export default function ProjectsPage() {
  const { projects, initializeDemoData, deleteProject } = useProjectStore();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"updatedAt" | "name" | "createdAt">("updatedAt");

  useEffect(() => {
    if (projects.length === 0) initializeDemoData();
  }, [projects.length, initializeDemoData]);

  const filteredProjects = projects
    .filter((p) => {
      if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase()) && !p.description.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (filterStatus !== "all" && p.status !== filterStatus) return false;
      if (filterCategory !== "all" && p.category !== filterCategory) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name, "ja");
      return new Date(b[sortBy]).getTime() - new Date(a[sortBy]).getTime();
    });

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 bg-slate-50 p-6">
          <div className="max-w-7xl mx-auto">
            {/* Page Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">プロジェクト一覧</h1>
                <p className="text-slate-500 mt-1">{projects.length}件のプロジェクト</p>
              </div>
              <Link href="/projects/new" className="btn-primary flex items-center gap-2">
                <PlusCircle className="w-5 h-5" />
                新規プロジェクト
              </Link>
            </div>

            {/* Filters Bar */}
            <div className="card mb-6">
              <div className="flex flex-wrap items-center gap-4">
                <div className="relative flex-1 min-w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="プロジェクト名で検索..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    style={{ borderColor: "var(--card-border)" }}
                  />
                </div>

                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm"
                  style={{ borderColor: "var(--card-border)" }}
                >
                  <option value="all">すべてのステータス</option>
                  {Object.entries(statusConfig).map(([value, config]) => (
                    <option key={value} value={value}>{config.label}</option>
                  ))}
                </select>

                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm"
                  style={{ borderColor: "var(--card-border)" }}
                >
                  <option value="all">すべてのカテゴリ</option>
                  {Object.entries(categoryLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className="border rounded-lg px-3 py-2 text-sm"
                  style={{ borderColor: "var(--card-border)" }}
                >
                  <option value="updatedAt">更新日順</option>
                  <option value="createdAt">作成日順</option>
                  <option value="name">名前順</option>
                </select>

                <div className="flex items-center border rounded-lg overflow-hidden" style={{ borderColor: "var(--card-border)" }}>
                  <button
                    onClick={() => setViewMode("grid")}
                    className={`p-2 ${viewMode === "grid" ? "bg-blue-50 text-blue-600" : "text-slate-400 hover:bg-slate-50"}`}
                  >
                    <Grid3X3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setViewMode("list")}
                    className={`p-2 ${viewMode === "list" ? "bg-blue-50 text-blue-600" : "text-slate-400 hover:bg-slate-50"}`}
                  >
                    <List className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Projects Grid/List */}
            {viewMode === "grid" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredProjects.map((project) => {
                  const status = statusConfig[project.status];
                  return (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}`}
                      className="card hover:shadow-md transition-all group"
                    >
                      <div className="h-32 rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 mb-4 flex items-center justify-center relative overflow-hidden">
                        <Video className="w-12 h-12 text-slate-300" />
                        <div className="absolute top-2 right-2">
                          <span
                            className="badge text-xs"
                            style={{ background: status.bgColor, color: status.color }}
                          >
                            {status.label}
                          </span>
                        </div>
                      </div>

                      <h3 className="font-bold text-slate-900 mb-1 group-hover:text-blue-600 transition-colors">
                        {project.name}
                      </h3>
                      <p className="text-sm text-slate-500 mb-3 line-clamp-2">{project.description}</p>

                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(project.updatedAt).toLocaleDateString("ja-JP")}
                        </div>
                        <div className="flex items-center gap-1">
                          <Tag className="w-3 h-3" />
                          {categoryLabels[project.category]}
                        </div>
                      </div>

                      {project.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-3">
                          {project.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </Link>
                  );
                })}

                {/* New Project Card */}
                <Link
                  href="/projects/new"
                  className="card border-2 border-dashed flex flex-col items-center justify-center py-12 hover:border-blue-400 hover:bg-blue-50/50 transition-all"
                  style={{ borderColor: "var(--card-border)" }}
                >
                  <PlusCircle className="w-12 h-12 text-slate-300 mb-3" />
                  <p className="font-medium text-slate-400">新規プロジェクト作成</p>
                </Link>
              </div>
            ) : (
              <div className="card p-0">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left text-sm" style={{ borderColor: "var(--card-border)" }}>
                      <th className="px-4 py-3 font-semibold text-slate-600">プロジェクト名</th>
                      <th className="px-4 py-3 font-semibold text-slate-600">カテゴリ</th>
                      <th className="px-4 py-3 font-semibold text-slate-600">ステータス</th>
                      <th className="px-4 py-3 font-semibold text-slate-600">部門</th>
                      <th className="px-4 py-3 font-semibold text-slate-600">更新日</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProjects.map((project) => {
                      const status = statusConfig[project.status];
                      return (
                        <tr
                          key={project.id}
                          className="border-b hover:bg-slate-50 transition-colors"
                          style={{ borderColor: "var(--card-border)" }}
                        >
                          <td className="px-4 py-3">
                            <Link href={`/projects/${project.id}`} className="font-medium text-slate-900 hover:text-blue-600">
                              {project.name}
                            </Link>
                            <p className="text-xs text-slate-500 mt-0.5">{project.description}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className="badge badge-info text-xs">{categoryLabels[project.category]}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="badge text-xs" style={{ background: status.bgColor, color: status.color }}>
                              {status.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">{project.department || "-"}</td>
                          <td className="px-4 py-3 text-sm text-slate-500">
                            {new Date(project.updatedAt).toLocaleDateString("ja-JP")}
                          </td>
                          <td className="px-4 py-3">
                            <button className="p-1 hover:bg-slate-100 rounded">
                              <MoreVertical className="w-4 h-4 text-slate-400" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
