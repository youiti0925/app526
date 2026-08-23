import { NextRequest, NextResponse } from "next/server";
import { readTasks } from "@/lib/hustle/db";
import { deleteTask, upsertTask } from "@/lib/hustle/repo";
import {
  TASK_KINDS,
  TASK_STATUSES,
  date,
  guard,
  num,
  oneOf,
  readJsonObject,
  str,
} from "@/lib/hustle/http";

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await ctx.params;
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const existing = readTasks().find((t) => t.id === id);
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 });

    return NextResponse.json({
      task: upsertTask({
        ...existing,
        pathId: "pathId" in body ? str(body.pathId, 64) ?? null : existing.pathId,
        title: str(body.title, 300) ?? existing.title,
        detail: str(body.detail, 4000) ?? existing.detail,
        kind: oneOf(body.kind, TASK_KINDS) ?? existing.kind,
        status: oneOf(body.status, TASK_STATUSES) ?? existing.status,
        dueDate: date(body.dueDate) ?? existing.dueDate,
        estMinutes: Math.max(0, Math.round(num(body.estMinutes) ?? existing.estMinutes)),
        actualMinutes: Math.max(0, Math.round(num(body.actualMinutes) ?? existing.actualMinutes)),
        doneAt: str(body.doneAt, 40) ?? existing.doneAt,
        id,
      }),
    });
  });
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await ctx.params;
    if (!deleteTask(id)) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
    return NextResponse.json({ success: true });
  });
}
