import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/hustle/agent/runner";
import { guard, readJsonObject } from "@/lib/hustle/http";
import type { RunTrigger, StepId } from "@/lib/hustle/agent/types";

const TRIGGERS: RunTrigger[] = ["manual", "auto_open", "daemon", "cron"];
const STEPS: StepId[] = ["ingest", "triage", "draft", "plan", "review", "learn"];

export async function POST(request: NextRequest) {
  return guard(async () => {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;

    const trigger = TRIGGERS.includes(parsed.data.trigger as RunTrigger)
      ? (parsed.data.trigger as RunTrigger)
      : "manual";
    const only = Array.isArray(parsed.data.only)
      ? (parsed.data.only.filter((s) => STEPS.includes(s as StepId)) as StepId[])
      : undefined;

    const outcome = await runAgent({
      trigger,
      force: parsed.data.force === true,
      ...(only && only.length ? { only } : {}),
    });

    return NextResponse.json(outcome);
  });
}
