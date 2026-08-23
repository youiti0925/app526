import { SOURCES } from "@/lib/hustle/agent/sources";
import { NextResponse } from "next/server";
import {
  countInbox,
  countRunsToday,
  readAgentConfig,
  readEvents,
  readInbox,
  readLeads,
  readPublishedListings,
  readRuns,
} from "@/lib/hustle/agent/db";
import { hasApiKey } from "@/lib/hustle/ai";
import { guard } from "@/lib/hustle/http";

export async function GET() {
  return guard(async () => {
    const runs = readRuns(15);
    const pending = readInbox("pending", 100);
    const config = readAgentConfig();

    return NextResponse.json({
      config,
      runs,
      lastRun: runs[0] ?? null,
      events: runs[0] ? readEvents(runs[0].id, 200) : [],
      inbox: pending,
      // 一覧の上限（100件）ではなく実数を返す。上限を件数として使うと、
      // 溜まっているのに「100件」で頭打ちになり、増えていることが見えない。
      inboxCount: countInbox("pending"),
      // 「次にやること」を決めるのに使う。出品案が溜まっているのに
      // 1つも出していない、という状態を検出するため。
      listingDrafts: pending.filter((i) => i.kind === "listing").length,
      hasSource: SOURCES.some((s) => config.sources[s.id]?.enabled) || config.feeds.length > 0,
      // 実際に出したもの。「今日やること」が、出品を見直す時期かどうかを判断するのに使う。
      published: readPublishedListings(),
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
