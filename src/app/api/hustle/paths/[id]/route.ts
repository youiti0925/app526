import { NextRequest, NextResponse } from "next/server";
import { deletePath, updatePath } from "@/lib/hustle/repo";

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await request.json();
  const path = updatePath(id, body);
  if (!path) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  return NextResponse.json({ path });
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ok = deletePath(id);
  if (!ok) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  return NextResponse.json({ success: true });
}
