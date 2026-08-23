import { NextRequest, NextResponse } from "next/server";
import { readAgentConfig, writeAgentConfig } from "@/lib/hustle/agent/db";
import { guard, num, readJsonObject } from "@/lib/hustle/http";
import type { StepId } from "@/lib/hustle/agent/types";

const STEPS: StepId[] = ["ingest", "triage", "draft", "plan", "review", "learn"];

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
    });

    return NextResponse.json({ config });
  });
}
