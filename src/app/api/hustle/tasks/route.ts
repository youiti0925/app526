import { NextRequest, NextResponse } from "next/server";
import { readTasks } from "@/lib/hustle/db";
import { insertTasks, upsertTask } from "@/lib/hustle/repo";
import type { HustleTask } from "@/lib/hustle/types";
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

/** 1件ぶんのタスク入力を検証する。title が無いものは null。 */
function normalizeTask(raw: unknown, index: number): (Partial<HustleTask> & { title: string }) | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const title = str(t.title, 300);
  if (!title || !title.trim()) return null;

  return {
    id: str(t.id, 64),
    pathId: str(t.pathId, 64) ?? null,
    title,
    detail: str(t.detail, 4000) ?? "",
    kind: oneOf(t.kind, TASK_KINDS) ?? "produce",
    status: oneOf(t.status, TASK_STATUSES) ?? "todo",
    dueDate: date(t.dueDate) ?? "",
    estMinutes: Math.max(0, Math.round(num(t.estMinutes) ?? 30)),
    actualMinutes: Math.max(0, Math.round(num(t.actualMinutes) ?? 0)),
    orderIndex: Math.round(num(t.orderIndex) ?? index),
    doneAt: str(t.doneAt, 40) ?? null,
    createdAt: str(t.createdAt, 40),
    template: str(t.template, 64) ?? "",
  };
}

export async function GET() {
  return guard(async () => NextResponse.json({ tasks: readTasks() }));
}

export async function POST(request: NextRequest) {
  return guard(async () => {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    // 単体でも配列でも受ける（診断結果から30日分をまとめて入れるため）
    if (Array.isArray(body.tasks)) {
      const tasks = body.tasks.map(normalizeTask).filter((t): t is Partial<HustleTask> & { title: string } => t !== null);
      if (tasks.length === 0) {
        return NextResponse.json({ error: "登録できるタスクがありません（title が必要です）" }, { status: 400 });
      }
      return NextResponse.json({ tasks: insertTasks(tasks) }, { status: 201 });
    }

    const single = normalizeTask(body, 0);
    if (!single) return NextResponse.json({ error: "title は必須です" }, { status: 400 });
    return NextResponse.json({ task: upsertTask(single) }, { status: 201 });
  });
}
