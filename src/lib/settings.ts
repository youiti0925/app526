// Settings backed by SQLite via API

import type { FeatureToggles } from "@/types";
import { defaultFeatureToggles } from "@/types";

export interface AppSettings {
  geminiApiKey: string;
}

const defaultSettings: AppSettings = {
  geminiApiKey: "",
};

// Cache to avoid excessive fetches during SSR/initial render
let settingsCache: AppSettings | null = null;
let togglesCache: FeatureToggles | null = null;

export function getFeatureToggles(): FeatureToggles {
  if (togglesCache) return togglesCache;
  return { ...defaultFeatureToggles };
}

export async function fetchFeatureToggles(): Promise<FeatureToggles> {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) return { ...defaultFeatureToggles };
    const data = await res.json();
    const toggles = { ...defaultFeatureToggles, ...(data.featureToggles ?? {}) };
    togglesCache = toggles;
    return toggles;
  } catch {
    return { ...defaultFeatureToggles };
  }
}

export async function saveFeatureToggles(toggles: Partial<FeatureToggles>): Promise<void> {
  const current = togglesCache ?? { ...defaultFeatureToggles };
  const updated = { ...current, ...toggles };
  togglesCache = updated;
  try {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featureToggles: updated }),
    });
  } catch {
    // ignore
  }
}

export function getSettings(): AppSettings {
  if (settingsCache) return settingsCache;
  return { ...defaultSettings };
}

export async function fetchSettings(): Promise<AppSettings> {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) return { ...defaultSettings };
    const data = await res.json();
    const settings = { ...defaultSettings, geminiApiKey: data.geminiApiKey ?? "" };
    settingsCache = settings;
    return settings;
  } catch {
    return { ...defaultSettings };
  }
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  const current = settingsCache ?? { ...defaultSettings };
  const updated = { ...current, ...settings };
  settingsCache = updated;
  try {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
  } catch {
    // ignore
  }
}
