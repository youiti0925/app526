"use client";

import { create } from "zustand";
import type {
  HustleAsset,
  HustleBackup,
  HustleEntry,
  HustlePath,
  HustleProfile,
  HustleTask,
  ScamCheck,
} from "@/lib/hustle/types";

const MIRROR_KEY = "hustle-backup-v1";

/**
 * サーバー（SQLite）を正としつつ、全データをブラウザにもミラーする。
 *
 * Vercel の無料プランのようにサーバー側ストレージが揮発する環境では、
 * サーバーが空で返ってきた時点でミラーから自動復元する。これで
 * 「無料でデプロイしたら記録が消えた」を防ぐ。
 */
function readMirror(): HustleBackup | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MIRROR_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as HustleBackup;
  } catch {
    return null;
  }
}

function writeMirror(backup: HustleBackup): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MIRROR_KEY, JSON.stringify(backup));
  } catch {
    // 容量超過などは致命的ではないので黙って諦める
  }
}

function hasContent(backup: HustleBackup | null): boolean {
  if (!backup) return false;
  return Boolean(
    backup.profile ||
      backup.paths?.length ||
      backup.tasks?.length ||
      backup.entries?.length ||
      backup.assets?.length
  );
}

export interface HustleStoreMeta {
  ephemeralStorage: boolean;
  serverEmpty: boolean;
  aiEnabled: boolean;
}

interface HustleStore {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  meta: HustleStoreMeta;

  profile: HustleProfile | null;
  paths: HustlePath[];
  tasks: HustleTask[];
  entries: HustleEntry[];
  assets: HustleAsset[];
  scamChecks: ScamCheck[];

  load: () => Promise<void>;
  saveProfile: (profile: HustleProfile) => Promise<void>;

  addPath: (input: Partial<HustlePath> & { pathKey: HustlePath["pathKey"]; name: string }) => Promise<HustlePath | null>;
  updatePath: (id: string, patch: Partial<HustlePath>) => Promise<void>;
  removePath: (id: string) => Promise<void>;

  addTasks: (tasks: (Partial<HustleTask> & { title: string })[]) => Promise<void>;
  addTask: (task: Partial<HustleTask> & { title: string }) => Promise<void>;
  updateTask: (id: string, patch: Partial<HustleTask>) => Promise<void>;
  removeTask: (id: string) => Promise<void>;

  addEntry: (entry: Partial<HustleEntry> & { kind: HustleEntry["kind"] }) => Promise<void>;
  updateEntry: (id: string, patch: Partial<HustleEntry>) => Promise<void>;
  removeEntry: (id: string) => Promise<void>;

  addAsset: (asset: Partial<HustleAsset> & { title: string }) => Promise<HustleAsset | null>;
  updateAsset: (id: string, patch: Partial<HustleAsset>) => Promise<void>;
  removeAsset: (id: string) => Promise<void>;

  recordScamCheck: (check: ScamCheck) => void;

  exportBackup: () => HustleBackup;
  importBackup: (backup: Partial<HustleBackup>) => Promise<void>;
}

const emptyMeta: HustleStoreMeta = { ephemeralStorage: false, serverEmpty: true, aiEnabled: false };

export const useHustleStore = create<HustleStore>()((set, get) => {
  /** 現在のストア内容をバックアップ形式に固めて、ブラウザへミラーする。 */
  const snapshot = (): HustleBackup => {
    const s = get();
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: s.profile,
      paths: s.paths,
      tasks: s.tasks,
      entries: s.entries,
      assets: s.assets,
      scamChecks: s.scamChecks,
    };
  };

  const mirror = () => writeMirror(snapshot());

  const applyState = (data: Partial<HustleBackup> & { meta?: HustleStoreMeta }) => {
    set({
      profile: data.profile ?? null,
      paths: data.paths ?? [],
      tasks: data.tasks ?? [],
      entries: data.entries ?? [],
      assets: data.assets ?? [],
      scamChecks: data.scamChecks ?? [],
      ...(data.meta ? { meta: data.meta } : {}),
    });
  };

  return {
    loaded: false,
    loading: false,
    error: null,
    meta: emptyMeta,

    profile: null,
    paths: [],
    tasks: [],
    entries: [],
    assets: [],
    scamChecks: [],

    async load() {
      if (get().loading) return;
      set({ loading: true, error: null });
      try {
        const res = await fetch("/api/hustle/state");
        if (!res.ok) throw new Error(`読み込みに失敗しました (${res.status})`);
        const data = await res.json();

        const localBackup = readMirror();
        // サーバーが空 かつ ブラウザに記録が残っている → 自動復元
        if (data?.meta?.serverEmpty && hasContent(localBackup)) {
          const restore = await fetch("/api/hustle/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(localBackup),
          });
          if (restore.ok) {
            const restored = await restore.json();
            applyState({ ...restored, meta: data.meta });
            set({ loaded: true, loading: false });
            mirror();
            return;
          }
        }

        applyState(data);
        set({ loaded: true, loading: false });
        mirror();
      } catch (error) {
        // サーバーに繋がらなくても、ミラーがあれば閲覧だけはできるようにする
        const localBackup = readMirror();
        if (hasContent(localBackup)) {
          applyState(localBackup as HustleBackup);
          set({
            loaded: true,
            loading: false,
            error: "サーバーに接続できないため、ブラウザに保存された記録を表示しています",
          });
          return;
        }
        set({
          loading: false,
          loaded: true,
          error: error instanceof Error ? error.message : "読み込みに失敗しました",
        });
      }
    },

    async saveProfile(profile) {
      set({ profile });
      mirror();
      await fetch("/api/hustle/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      }).catch(() => undefined);
    },

    async addPath(input) {
      const res = await fetch("/api/hustle/paths", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }).catch(() => null);
      if (!res || !res.ok) return null;
      const { path } = await res.json();
      set({ paths: [...get().paths, path] });
      mirror();
      return path as HustlePath;
    },

    async updatePath(id, patch) {
      set({ paths: get().paths.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
      mirror();
      await fetch(`/api/hustle/paths/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => undefined);
    },

    async removePath(id) {
      set({
        paths: get().paths.filter((p) => p.id !== id),
        tasks: get().tasks.filter((t) => t.pathId !== id),
        entries: get().entries.filter((e) => e.pathId !== id),
      });
      mirror();
      await fetch(`/api/hustle/paths/${id}`, { method: "DELETE" }).catch(() => undefined);
    },

    async addTasks(tasks) {
      const res = await fetch("/api/hustle/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks }),
      }).catch(() => null);
      if (!res || !res.ok) return;
      const data = await res.json();
      set({ tasks: [...get().tasks, ...(data.tasks ?? [])] });
      mirror();
    },

    async addTask(task) {
      const res = await fetch("/api/hustle/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(task),
      }).catch(() => null);
      if (!res || !res.ok) return;
      const { task: created } = await res.json();
      set({ tasks: [...get().tasks, created] });
      mirror();
    },

    async updateTask(id, patch) {
      set({ tasks: get().tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
      mirror();
      await fetch(`/api/hustle/tasks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => undefined);
    },

    async removeTask(id) {
      set({ tasks: get().tasks.filter((t) => t.id !== id) });
      mirror();
      await fetch(`/api/hustle/tasks/${id}`, { method: "DELETE" }).catch(() => undefined);
    },

    async addEntry(entry) {
      const res = await fetch("/api/hustle/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      }).catch(() => null);
      if (!res || !res.ok) return;
      const { entry: created } = await res.json();
      set({ entries: [created, ...get().entries] });
      mirror();
    },

    async updateEntry(id, patch) {
      set({ entries: get().entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
      mirror();
      await fetch(`/api/hustle/entries/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => undefined);
    },

    async removeEntry(id) {
      set({ entries: get().entries.filter((e) => e.id !== id) });
      mirror();
      await fetch(`/api/hustle/entries/${id}`, { method: "DELETE" }).catch(() => undefined);
    },

    async addAsset(asset) {
      const res = await fetch("/api/hustle/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(asset),
      }).catch(() => null);
      if (!res || !res.ok) return null;
      const { asset: created } = await res.json();
      set({ assets: [created, ...get().assets] });
      mirror();
      return created as HustleAsset;
    },

    async updateAsset(id, patch) {
      set({ assets: get().assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
      mirror();
      await fetch(`/api/hustle/assets/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => undefined);
    },

    async removeAsset(id) {
      set({ assets: get().assets.filter((a) => a.id !== id) });
      mirror();
      await fetch(`/api/hustle/assets/${id}`, { method: "DELETE" }).catch(() => undefined);
    },

    recordScamCheck(check) {
      set({ scamChecks: [check, ...get().scamChecks].slice(0, 200) });
      mirror();
    },

    exportBackup() {
      return snapshot();
    },

    async importBackup(backup) {
      const res = await fetch("/api/hustle/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(backup),
      }).catch(() => null);
      if (res && res.ok) {
        const data = await res.json();
        applyState(data);
      } else {
        applyState(backup);
      }
      mirror();
    },
  };
});
