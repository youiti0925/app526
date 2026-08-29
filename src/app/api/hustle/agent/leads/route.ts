import { NextRequest, NextResponse } from "next/server";
import { insertLead, readLeads } from "@/lib/hustle/agent/db";
import { cleanEmail, leadFromParsed, parsePasted } from "@/lib/hustle/agent/ingest";
import { guard, oneOf, readJsonObject } from "@/lib/hustle/http";
import type { LeadSource, LeadStatus } from "@/lib/hustle/agent/types";

const STATUSES = ["new", "triaged", "drafted", "rejected", "approved", "applied", "won", "lost", "archived"] as const;
const SOURCES = ["manual", "paste", "rss", "email"] as const satisfies readonly LeadSource[];

export async function GET(request: NextRequest) {
  return guard(async () => {
    const status = request.nextUrl.searchParams.get("status");
    const valid = STATUSES.includes(status as LeadStatus) ? (status as LeadStatus) : undefined;
    return NextResponse.json({ leads: readLeads(valid, 200) });
  });
}

/** 案件をまとめて投入する。`---` の行で複数に割る。メールならヘッダと引用を落とす。 */
export async function POST(request: NextRequest) {
  return guard(async () => {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;

    const raw = typeof parsed.data.text === "string" ? parsed.data.text.slice(0, 200_000) : "";
    if (raw.trim().length < 20) {
      return NextResponse.json({ error: "案件の本文を20文字以上入力してください" }, { status: 400 });
    }

    const source = oneOf(parsed.data.source, SOURCES) ?? "paste";
    const cleaned = source === "email" ? cleanEmail(raw) : raw;
    const items = parsePasted(cleaned, source);

    let created = 0;
    let duplicated = 0;
    for (const item of items) {
      const res = insertLead(leadFromParsed(item));
      if (res.created) created++;
      else duplicated++;
    }

    return NextResponse.json({ created, duplicated, total: items.length }, { status: 201 });
  });
}
