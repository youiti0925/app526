import { NextRequest, NextResponse } from "next/server";
import { readTasks } from "@/lib/hustle/db";
import { deleteTask, upsertTask } from "@/lib/hustle/repo";

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await request.json();
  const existing = readTasks().find((t) => t.id === id);
  if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  return NextResponse.json({ task: upsertTask({ ...existing, ...body, id }) });
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!deleteTask(id)) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  return NextResponse.json({ success: true });
}
