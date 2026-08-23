import { NextRequest, NextResponse } from "next/server";
import { readAssets } from "@/lib/hustle/db";
import { deleteAsset, upsertAsset } from "@/lib/hustle/repo";

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await request.json();
  const existing = readAssets().find((a) => a.id === id);
  if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  return NextResponse.json({ asset: upsertAsset({ ...existing, ...body, id }) });
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!deleteAsset(id)) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  return NextResponse.json({ success: true });
}
