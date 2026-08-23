import { NextRequest, NextResponse } from "next/server";
import { readTasks } from "@/lib/hustle/db";
import { insertTasks, upsertTask } from "@/lib/hustle/repo";

export async function GET() {
  return NextResponse.json({ tasks: readTasks() });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  // 単体でも配列でも受ける（診断結果から30日分をまとめて入れるため）
  if (Array.isArray(body?.tasks)) {
    return NextResponse.json({ tasks: insertTasks(body.tasks) }, { status: 201 });
  }
  if (!body?.title) return NextResponse.json({ error: "title は必須です" }, { status: 400 });
  return NextResponse.json({ task: upsertTask(body) }, { status: 201 });
}
