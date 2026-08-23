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
 * サーバーが空で返ってきた時点でミラーから自動復元する。加えて、
 * 一時的な通信失敗でサーバーに書けなかったレコードを取りこぼさないよう、
 * 読み込み時にサーバーとミラーを id で突き合わせて統合する。
 */

function readMirror(): HustleBackup | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MIRROR_KEY);
    if (!raw) return null;
    return sanitizeBackup(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** localStorage が使えない環境（プライベートモード等）を検出できるよう、成否を返す。 */
function writeMirror(backup: HustleBackup): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(MIRROR_KEY, JSON.stringify(backup));
    return true;
  } catch {
    return false;
  }
}

/**
 * 外から来たデータ（localStorage、読み込んだJSONファイル、APIの応答）を
 * 信用せずに形だけ整える。壊れた値がそのまま state に入ると画面ごと落ちる。
 */
function sanitizeBackup(input: unknown): HustleBackup {
  const raw = (input ?? {}) as Partial<HustleBackup>;
  const arrayOf = <T>(value: unknown, hasId = true): T[] => {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item) => item && typeof item === "object" && (!hasId || typeof (item as { id?: unknown }).id === "string")
    ) as T[];
  };

  return {
    version: 1,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : new Date().toISOString(),
    profile: raw.profile && typeof raw.profile === "object" ? (raw.profile as HustleProfile) : null,
    paths: arrayOf<HustlePath>(raw.paths).filter((p) => typeof p.name === "string"),
    tasks: arrayOf<HustleTask>(raw.tasks).filter((t) => typeof t.title === "string"),
    entries: arrayOf<HustleEntry>(raw.entries).filter((e) => typeof e.kind === "string"),
    assets: arrayOf<HustleAsset>(raw.assets).filter((a) => typeof a.title === "string"),
    scamChecks: arrayOf<ScamCheck>(raw.scamChecks),
  };
}

function hasContent(backup: HustleBackup | null): boolean {
  if (!backup) return false;
  return Boolean(
    backup.profile ||
      backup.paths.length ||
      backup.tasks.length ||
      backup.entries.length ||
      backup.assets.length
  );
}

function unionById<T extends { id: string }>(server: T[], local: T[]): { merged: T[]; extras: number } {
  const byId = new Map<string, T>();
  for (const item of local) byId.set(item.id, item);
  let extras = local.length;
  for (const item of server) {
    if (byId.has(item.id)) extras--;
    byId.set(item.id, item); // サーバーの内容を正とする
  }
  return { merged: [...byId.values()], extras };
}

/**
 * サーバーとミラーを統合する。サーバーにある分はサーバーを正とし、
 * サーバーに無いローカルのレコードは残す（書き込みに失敗した分の救済）。
 */
function mergeBackups(server: HustleBackup, local: HustleBackup | null): { merged: HustleBackup; localOnly: number } {
  if (!local) return { merged: server, localOnly: 0 };

  const paths = unionById(server.paths, local.paths);
  const tasks = unionById(server.tasks, local.tasks);
  const entries = unionById(server.entries, local.entries);
  const assets = unionById(server.assets, local.assets);
  const scamChecks = unionById(server.scamChecks, local.scamChecks);

  return {
    merged: {
      version: 1,
      exportedAt: server.exportedAt,
      profile: server.profile ?? local.profile,
      paths: paths.merged,
      tasks: tasks.merged,
      entries: entries.merged,
      assets: assets.merged,
      scamChecks: scamChecks.merged,
    },
    localOnly: paths.extras + tasks.extras + entries.extras + assets.extras + scamChecks.extras,
  };
}

const newId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const nowIso = () => new Date().toISOString();

/** ローカル日付。toISOString() は UTC になるので、日付として保存する値には使わない。 */
const todayDate = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export interface HustleStoreMeta {
  ephemeralStorage: boolean;
  serverEmpty: boolean;
  aiEnabled: boolean;
}

interface HustleStore {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  /** localStorage への複製が成功しているか。false ならバックアップを促す。 */
  mirrorHealthy: boolean;
  /** サーバーへの書き込みに失敗して、ブラウザにしか無い記録があるか。 */
  unsyncedCount: number;
  meta: HustleStoreMeta;

  profile: HustleProfile | null;
  paths: HustlePath[];
  tasks: HustleTask[];
  entries: HustleEntry[];
  assets: HustleAsset[];
  scamChecks: ScamCheck[];

  load: () => Promise<void>;
  clearError: () => void;
  saveProfile: (profile: HustleProfile) => Promise<void>;

  addPath: (input: Partial<HustlePath> & { pathKey: HustlePath["pathKey"]; name: string }) => Promise<HustlePath>;
  updatePath: (id: string, patch: Partial<HustlePath>) => Promise<void>;
  removePath: (id: string) => Promise<void>;

  addTasks: (tasks: (Partial<HustleTask> & { title: string })[]) => Promise<void>;
  addTask: (task: Partial<HustleTask> & { title: string }) => Promise<void>;
  updateTask: (id: string, patch: Partial<HustleTask>) => Promise<void>;
  removeTask: (id: string) => Promise<void>;

  addEntry: (entry: Partial<HustleEntry> & { kind: HustleEntry["kind"] }) => Promise<void>;
  updateEntry: (id: string, patch: Partial<HustleEntry>) => Promise<void>;
  removeEntry: (id: string) => Promise<void>;

  addAsset: (asset: Partial<HustleAsset> & { title: string }) => Promise<HustleAsset>;
  updateAsset: (id: string, patch: Partial<HustleAsset>) => Promise<void>;
  removeAsset: (id: string) => Promise<void>;

  recordScamCheck: (check: ScamCheck) => void;

  exportBackup: () => HustleBackup;
  importBackup: (backup: unknown) => Promise<void>;
}

const emptyMeta: HustleStoreMeta = { ephemeralStorage: false, serverEmpty: true, aiEnabled: false };

const SYNC_FAILED_MESSAGE =
  "サーバーに保存できませんでした。入力はこのブラウザに残してあり、次に開いたときに自動で書き戻します。心配ならバックアップを書き出してください。";

export const useHustleStore = create<HustleStore>()((set, get) => {
  const snapshot = (): HustleBackup => {
    const s = get();
    return {
      version: 1,
      exportedAt: nowIso(),
      profile: s.profile,
      paths: s.paths,
      tasks: s.tasks,
      entries: s.entries,
      assets: s.assets,
      scamChecks: s.scamChecks,
    };
  };

  const mirror = () => {
    const ok = writeMirror(snapshot());
    if (ok !== get().mirrorHealthy) set({ mirrorHealthy: ok });
  };

  const applyState = (data: HustleBackup, meta?: HustleStoreMeta) => {
    set({
      profile: data.profile,
      paths: data.paths,
      tasks: data.tasks,
      entries: data.entries,
      assets: data.assets,
      scamChecks: data.scamChecks,
      ...(meta ? { meta } : {}),
    });
  };

  /** 書き込み系の共通処理。失敗しても state とミラーは維持し、未同期として数える。 */
  const push = async (url: string, method: "POST" | "PUT" | "DELETE", body?: unknown): Promise<boolean> => {
    try {
      const res = await fetch(url, {
        method,
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      if (!res.ok) throw new Error(String(res.status));
      return true;
    } catch {
      set({ error: SYNC_FAILED_MESSAGE, unsyncedCount: get().unsyncedCount + 1 });
      return false;
    }
  };

  return {
    loaded: false,
    loading: false,
    error: null,
    mirrorHealthy: true,
    unsyncedCount: 0,
    meta: emptyMeta,

    profile: null,
    paths: [],
    tasks: [],
    entries: [],
    assets: [],
    scamChecks: [],

    clearError: () => set({ error: null }),

    async load() {
      if (get().loading) return;
      set({ loading: true, error: null });

      const localBackup = readMirror();

      try {
        const res = await fetch("/api/hustle/state");
        if (!res.ok) throw new Error(`読み込みに失敗しました (${res.status})`);
        const raw = await res.json();
        const meta: HustleStoreMeta = { ...emptyMeta, ...(raw?.meta ?? {}) };
        const server = sanitizeBackup(raw);

        const { merged, localOnly } = mergeBackups(server, localBackup);
        applyState(merged, meta);
        set({ loaded: true, loading: false, unsyncedCount: 0 });
        mirror();

        // サーバーに無い分（揮発した／書き込みに失敗した分）を書き戻す
        if (localOnly > 0 || (meta.serverEmpty && hasContent(localBackup))) {
          const ok = await push("/api/hustle/state", "POST", merged);
          if (!ok) set({ error: null, unsyncedCount: localOnly });
        }
      } catch (error) {
        // サーバーに繋がらないときは、ミラーを唯一の真実として扱う。
        // ここで空のサーバー状態を適用してミラーを上書きすると記録が消える。
        if (hasContent(localBackup)) {
          applyState(localBackup as HustleBackup);
          set({
            loaded: true,
            loading: false,
            error: "サーバーに接続できないため、このブラウザに保存された記録を表示しています。この状態での変更はサーバーに保存されません。",
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
      await push("/api/hustle/profile", "PUT", profile);
    },

    async addPath(input) {
      const path: HustlePath = {
        id: input.id ?? newId(),
        pathKey: input.pathKey,
        name: input.name,
        status: input.status ?? "active",
        targetJpy: input.targetJpy ?? 0,
        notes: input.notes ?? "",
        startedAt: input.startedAt || todayDate(),
        createdAt: input.createdAt ?? nowIso(),
        updatedAt: nowIso(),
      };
      set({ paths: [...get().paths, path] });
      mirror();
      await push("/api/hustle/paths", "POST", path);
      return path;
    },

    async updatePath(id, patch) {
      set({ paths: get().paths.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
      mirror();
      await push(`/api/hustle/paths/${id}`, "PUT", patch);
    },

    async removePath(id) {
      set({
        paths: get().paths.filter((p) => p.id !== id),
        tasks: get().tasks.filter((t) => t.pathId !== id),
        entries: get().entries.filter((e) => e.pathId !== id),
      });
      mirror();
      await push(`/api/hustle/paths/${id}`, "DELETE");
    },

    async addTasks(inputs) {
      const created: HustleTask[] = inputs.map((t, i) => ({
        id: t.id ?? newId(),
        pathId: t.pathId ?? null,
        title: t.title,
        detail: t.detail ?? "",
        kind: t.kind ?? "produce",
        status: t.status ?? "todo",
        dueDate: t.dueDate ?? "",
        estMinutes: t.estMinutes ?? 30,
        actualMinutes: t.actualMinutes ?? 0,
        orderIndex: t.orderIndex ?? i,
        doneAt: t.doneAt ?? null,
        createdAt: t.createdAt ?? nowIso(),
        template: t.template ?? "",
      }));
      set({ tasks: [...get().tasks, ...created] });
      mirror();
      await push("/api/hustle/tasks", "POST", { tasks: created });
    },

    async addTask(input) {
      await get().addTasks([input]);
    },

    async updateTask(id, patch) {
      set({ tasks: get().tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
      mirror();
      await push(`/api/hustle/tasks/${id}`, "PUT", patch);
    },

    async removeTask(id) {
      set({ tasks: get().tasks.filter((t) => t.id !== id) });
      mirror();
      await push(`/api/hustle/tasks/${id}`, "DELETE");
    },

    async addEntry(input) {
      const entry: HustleEntry = {
        id: input.id ?? newId(),
        pathId: input.pathId ?? null,
        date: input.date || todayDate(),
        kind: input.kind,
        amountJpy: Math.round(input.amountJpy ?? 0),
        minutes: Math.round(input.minutes ?? 0),
        memo: input.memo ?? "",
        settled: input.settled ?? true,
        createdAt: input.createdAt ?? nowIso(),
      };
      set({ entries: [entry, ...get().entries] });
      mirror();
      await push("/api/hustle/entries", "POST", entry);
    },

    async updateEntry(id, patch) {
      set({ entries: get().entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
      mirror();
      await push(`/api/hustle/entries/${id}`, "PUT", patch);
    },

    async removeEntry(id) {
      set({ entries: get().entries.filter((e) => e.id !== id) });
      mirror();
      await push(`/api/hustle/entries/${id}`, "DELETE");
    },

    async addAsset(input) {
      const asset: HustleAsset = {
        id: input.id ?? newId(),
        pathId: input.pathId ?? null,
        kind: input.kind ?? "other",
        title: input.title,
        body: input.body ?? "",
        meta: input.meta ?? {},
        status: input.status ?? "draft",
        createdAt: input.createdAt ?? nowIso(),
      };
      set({ assets: [asset, ...get().assets] });
      mirror();
      await push("/api/hustle/assets", "POST", asset);
      return asset;
    },

    async updateAsset(id, patch) {
      set({ assets: get().assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
      mirror();
      await push(`/api/hustle/assets/${id}`, "PUT", patch);
    },

    async removeAsset(id) {
      set({ assets: get().assets.filter((a) => a.id !== id) });
      mirror();
      await push(`/api/hustle/assets/${id}`, "DELETE");
    },

    recordScamCheck(check) {
      set({ scamChecks: [check, ...get().scamChecks].slice(0, 200) });
      mirror();
    },

    exportBackup() {
      return snapshot();
    },

    async importBackup(input) {
      const backup = sanitizeBackup(input);
      if (!hasContent(backup)) {
        set({ error: "読み込んだファイルに、復元できる記録が見つかりませんでした。" });
        return;
      }
      applyState(backup);
      mirror();
      const ok = await push("/api/hustle/state", "POST", backup);
      if (ok) set({ error: null, unsyncedCount: 0 });
    },
  };
});
