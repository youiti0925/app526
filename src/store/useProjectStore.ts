"use client";

import { create } from "zustand";
import type {
  Project,
  WorkStandard,
  WorkStep,
  AnalysisResult,
  DashboardStats,
} from "@/types";
import { v4 as uuidv4 } from "uuid";

interface ProjectStore {
  projects: Project[];
  currentProject: Project | null;
  currentWorkStandard: WorkStandard | null;
  analysisResult: AnalysisResult | null;
  isAnalyzing: boolean;
  isLoading: boolean;
  dashboardStats: DashboardStats;

  // Data fetching
  fetchProjects: () => Promise<void>;

  // Project actions
  addProject: (project: Omit<Project, "id" | "createdAt" | "updatedAt" | "status">) => Promise<Project>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  setCurrentProject: (project: Project | null) => void;

  // Work Standard actions
  setWorkStandard: (ws: WorkStandard | null) => void;
  updateWorkStandard: (updates: Partial<WorkStandard>) => void;
  addStep: (step: Omit<WorkStep, "id">) => void;
  updateStep: (stepId: string, updates: Partial<WorkStep>) => void;
  deleteStep: (stepId: string) => void;
  reorderSteps: (fromIndex: number, toIndex: number) => void;

  // Analysis
  setAnalysisResult: (result: AnalysisResult | null) => void;
  setIsAnalyzing: (analyzing: boolean) => void;

  // Initialize with demo data
  initializeDemoData: () => Promise<void>;
}

function computeStats(projects: Project[]): DashboardStats {
  return {
    totalProjects: projects.length,
    publishedStandards: projects.filter((p) => p.status === "published").length,
    pendingReview: projects.filter((p) => p.status === "review").length,
    activeAnalysis: projects.filter((p) => p.status === "analyzing").length,
    recentActivity: [],
  };
}

export const useProjectStore = create<ProjectStore>()((set, get) => ({
  projects: [],
  currentProject: null,
  currentWorkStandard: null,
  analysisResult: null,
  isAnalyzing: false,
  isLoading: false,
  dashboardStats: {
    totalProjects: 0,
    publishedStandards: 0,
    pendingReview: 0,
    activeAnalysis: 0,
    recentActivity: [],
  },

  fetchProjects: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      const projects: Project[] = await res.json();
      set({ projects, dashboardStats: computeStats(projects), isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  addProject: async (projectData) => {
    const now = new Date().toISOString();
    const project: Project = {
      ...projectData,
      id: uuidv4(),
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };

    // Optimistic update
    set((state) => ({
      projects: [...state.projects, project],
      dashboardStats: computeStats([...state.projects, project]),
    }));

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(project),
      });
      if (!res.ok) throw new Error("Failed to create project");
      const saved: Project = await res.json();
      set((state) => ({
        projects: state.projects.map((p) => (p.id === project.id ? saved : p)),
      }));
      return saved;
    } catch {
      // Rollback
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== project.id),
        dashboardStats: computeStats(state.projects.filter((p) => p.id !== project.id)),
      }));
      return project;
    }
  },

  updateProject: async (id, updates) => {
    // Optimistic update
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
      ),
      currentProject:
        state.currentProject?.id === id
          ? { ...state.currentProject, ...updates, updatedAt: new Date().toISOString() }
          : state.currentProject,
    }));

    try {
      await fetch(`/api/projects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    } catch {
      // Refetch on error
      get().fetchProjects();
    }
  },

  deleteProject: async (id) => {
    const prev = get().projects;
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      currentProject: state.currentProject?.id === id ? null : state.currentProject,
      dashboardStats: computeStats(state.projects.filter((p) => p.id !== id)),
    }));

    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    } catch {
      set({ projects: prev, dashboardStats: computeStats(prev) });
    }
  },

  setCurrentProject: (project) => set({ currentProject: project }),

  setWorkStandard: (ws) => set({ currentWorkStandard: ws }),

  updateWorkStandard: (updates) => {
    set((state) => ({
      currentWorkStandard: state.currentWorkStandard
        ? { ...state.currentWorkStandard, ...updates, updatedAt: new Date().toISOString() }
        : null,
    }));
  },

  addStep: (stepData) => {
    const step: WorkStep = { ...stepData, id: uuidv4() };
    set((state) => ({
      currentWorkStandard: state.currentWorkStandard
        ? {
            ...state.currentWorkStandard,
            steps: [...state.currentWorkStandard.steps, step],
          }
        : null,
    }));
  },

  updateStep: (stepId, updates) => {
    set((state) => ({
      currentWorkStandard: state.currentWorkStandard
        ? {
            ...state.currentWorkStandard,
            steps: state.currentWorkStandard.steps.map((s) =>
              s.id === stepId ? { ...s, ...updates } : s
            ),
          }
        : null,
    }));
  },

  deleteStep: (stepId) => {
    set((state) => ({
      currentWorkStandard: state.currentWorkStandard
        ? {
            ...state.currentWorkStandard,
            steps: state.currentWorkStandard.steps
              .filter((s) => s.id !== stepId)
              .map((s, i) => ({ ...s, stepNumber: i + 1 })),
          }
        : null,
    }));
  },

  reorderSteps: (fromIndex, toIndex) => {
    set((state) => {
      if (!state.currentWorkStandard) return state;
      const steps = [...state.currentWorkStandard.steps];
      const [moved] = steps.splice(fromIndex, 1);
      steps.splice(toIndex, 0, moved);
      return {
        currentWorkStandard: {
          ...state.currentWorkStandard,
          steps: steps.map((s, i) => ({ ...s, stepNumber: i + 1 })),
        },
      };
    });
  },

  setAnalysisResult: (result) => set({ analysisResult: result }),
  setIsAnalyzing: (analyzing) => set({ isAnalyzing: analyzing }),

  initializeDemoData: async () => {
    const now = new Date().toISOString();
    const demoProjects: Project[] = [
      {
        id: "demo-1",
        name: "円テーブル回転精度検査",
        description: "CNC工作機械用円テーブルの回転精度検査手順",
        category: "inspection",
        status: "published",
        createdAt: "2026-03-01T09:00:00Z",
        updatedAt: "2026-03-10T15:30:00Z",
        tags: ["円テーブル", "回転精度", "CNC"],
        department: "品質管理部",
        machineModel: "CRT-320",
        inspectionType: "定期検査",
      },
      {
        id: "demo-2",
        name: "円テーブル割出し精度検査",
        description: "割出し精度の測定手順と合否判定基準",
        category: "inspection",
        status: "review",
        createdAt: "2026-03-05T10:00:00Z",
        updatedAt: "2026-03-12T11:00:00Z",
        tags: ["円テーブル", "割出し精度"],
        department: "品質管理部",
        machineModel: "CRT-320",
        inspectionType: "出荷検査",
      },
      {
        id: "demo-3",
        name: "円テーブルクランプ力検査",
        description: "クランプ機構の保持力検査作業標準",
        category: "quality-check",
        status: "editing",
        createdAt: "2026-03-08T14:00:00Z",
        updatedAt: "2026-03-11T16:00:00Z",
        tags: ["円テーブル", "クランプ力"],
        department: "品質管理部",
        machineModel: "CRT-500",
        inspectionType: "受入検査",
      },
      {
        id: "demo-4",
        name: "円テーブル組立手順",
        description: "円テーブルユニットの組立作業標準",
        category: "assembly",
        status: "analyzing",
        createdAt: "2026-03-10T08:00:00Z",
        updatedAt: now,
        tags: ["円テーブル", "組立"],
        department: "製造部",
        machineModel: "CRT-320",
      },
      {
        id: "demo-5",
        name: "定期メンテナンス手順",
        description: "円テーブルの定期メンテナンス作業標準",
        category: "maintenance",
        status: "draft",
        createdAt: "2026-03-12T09:00:00Z",
        updatedAt: now,
        tags: ["メンテナンス", "定期点検"],
        department: "保全部",
        machineModel: "CRT-320",
      },
    ];

    // Insert demo projects via API
    for (const project of demoProjects) {
      try {
        await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(project),
        });
      } catch {
        // ignore duplicate inserts
      }
    }

    set({
      projects: demoProjects,
      dashboardStats: computeStats(demoProjects),
    });
  },
}));
