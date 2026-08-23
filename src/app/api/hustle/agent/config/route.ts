import { NextRequest, NextResponse } from "next/server";
import { readAgentConfig, writeAgentConfig } from "@/lib/hustle/agent/db";
import { guard, num, readJsonObject } from "@/lib/hustle/http";
import { SOURCES } from "@/lib/hustle/agent/sources";
import { STEP_ORDER } from "@/lib/hustle/agent/types";
import type { SourceState, StepId } from "@/lib/hustle/agent/types";

const STEPS = STEP_ORDER;

export async function GET() {
  return guard(async () => NextResponse.json({ config: readAgentConfig() }));
}

export async function PUT(request: NextRequest) {
  return guard(async () => {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const steps: Partial<Record<StepId, boolean>> = {};
    if (body.steps && typeof body.steps === "object") {
      for (const [key, value] of Object.entries(body.steps as Record<string, unknown>)) {
        if (STEPS.includes(key as StepId) && typeof value === "boolean") steps[key as StepId] = value;
      }
    }

    const feeds = Array.isArray(body.feeds)
      ? body.feeds
          .filter((f): f is string => typeof f === "string")
          .map((f) => f.trim())
          .filter((f) => /^https?:\/\//.test(f))
          .slice(0, 10)
      : undefined;

    // ソースは id を SOURCES に照合してから通す。知らない id は無視する。
    const sources: Record<string, Partial<SourceState>> = {};
    if (body.sources && typeof body.sources === "object") {
      for (const [id, value] of Object.entries(body.sources as Record<string, unknown>)) {
        if (!SOURCES.some((s) => s.id === id)) continue;
        if (!value || typeof value !== "object") continue;
        const v = value as Record<string, unknown>;
        const patch: Partial<SourceState> = {};
        if (typeof v.enabled === "boolean") patch.enabled = v.enabled;
        if (num(v.maxDetails) !== undefined) {
          patch.maxDetails = Math.max(1, Math.min(50, Math.round(num(v.maxDetails)!)));
        }
        // since を空にできるようにしておく（取りこぼしたときに読み直せるように）
        if (v.since === "") patch.since = "";
        if (Object.keys(patch).length) sources[id] = patch;
      }
    }

    const config = writeAgentConfig({
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      ...(typeof body.runOnOpen === "boolean" ? { runOnOpen: body.runOnOpen } : {}),
      ...(num(body.maxRunsPerDay) !== undefined
        ? { maxRunsPerDay: Math.max(1, Math.min(24, Math.round(num(body.maxRunsPerDay)!))) }
        : {}),
      ...(num(body.callBudget) !== undefined
        ? { callBudget: Math.max(0, Math.min(200, Math.round(num(body.callBudget)!))) }
        : {}),
      ...(num(body.maxDraftsPerRun) !== undefined
        ? { maxDraftsPerRun: Math.max(0, Math.min(20, Math.round(num(body.maxDraftsPerRun)!))) }
        : {}),
      ...(Object.keys(steps).length ? { steps: steps as Record<StepId, boolean> } : {}),
      ...(feeds ? { feeds } : {}),
      ...(Object.keys(sources).length ? { sources } : {}),
      ...(typeof body.discoveryEnabled === "boolean" ? { discoveryEnabled: body.discoveryEnabled } : {}),
    });

    return NextResponse.json({ config });
  });
}
