import { NextRequest, NextResponse } from "next/server";
import { readEntries } from "@/lib/hustle/db";
import { deleteEntry, upsertEntry } from "@/lib/hustle/repo";

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await request.json();
  const existing = readEntries().find((e) => e.id === id);
  if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  return NextResponse.json({ entry: upsertEntry({ ...existing, ...body, id }) });
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!deleteEntry(id)) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  return NextResponse.json({ success: true });
}
