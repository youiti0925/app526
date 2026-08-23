import { NextRequest, NextResponse } from "next/server";
import { readEntries } from "@/lib/hustle/db";
import { upsertEntry } from "@/lib/hustle/repo";

export async function GET() {
  return NextResponse.json({ entries: readEntries() });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body?.kind) return NextResponse.json({ error: "kind は必須です" }, { status: 400 });
  return NextResponse.json({ entry: upsertEntry(body) }, { status: 201 });
}
