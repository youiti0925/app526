// Settings stored in localStorage

import type { FeatureToggles } from "@/types";
import { defaultFeatureToggles } from "@/types";

const SETTINGS_KEY = "videosop-settings";
const FEATURE_TOGGLES_KEY = "videosop-feature-toggles";

export interface AppSettings {
  geminiApiKey: string;
}

const defaultSettings: AppSettings = {
  geminiApiKey: "",
};

export function getFeatureToggles(): FeatureToggles {
  if (typeof window === "undefined") return defaultFeatureToggles;
  try {
    const stored = localStorage.getItem(FEATURE_TOGGLES_KEY);
    if (stored) {
      return { ...defaultFeatureToggles, ...JSON.parse(stored) };
    }
  } catch {
    // ignore
  }
  return { ...defaultFeatureToggles };
}

export function saveFeatureToggles(toggles: Partial<FeatureToggles>): void {
  if (typeof window === "undefined") return;
  const current = getFeatureToggles();
  const updated = { ...current, ...toggles };
  localStorage.setItem(FEATURE_TOGGLES_KEY, JSON.stringify(updated));
}

export function getSettings(): AppSettings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch {
    // ignore
  }
  return defaultSettings;
}

export function saveSettings(settings: Partial<AppSettings>): void {
  if (typeof window === "undefined") return;
  const current = getSettings();
  const updated = { ...current, ...settings };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
}
