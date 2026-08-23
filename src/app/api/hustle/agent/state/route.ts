import { NextResponse } from "next/server";
import {
  countRunsToday,
  readAgentConfig,
  readEvents,
  readInbox,
  readLeads,
  readRuns,
} from "@/lib/hustle/agent/db";
import { hasApiKey } from "@/lib/hustle/ai";
import { guard } from "@/lib/hustle/http";

export async function GET() {
  return guard(async () => {
    const runs = readRuns(15);
    const pending = readInbox("pending", 100);

    return NextResponse.json({
      config: readAgentConfig(),
      runs,
      lastRun: runs[0] ?? null,
      events: runs[0] ? readEvents(runs[0].id, 200) : [],
      inbox: pending,
      inboxCount: pending.length,
      runsToday: countRunsToday(),
      leads: {
        new: readLeads("new", 200).length,
        triaged: readLeads("triaged", 200).length,
        drafted: readLeads("drafted", 200).length,
        rejected: readLeads("rejected", 200).length,
      },
      aiEnabled: hasApiKey(),
    });
  });
}
