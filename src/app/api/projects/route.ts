import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  category: string;
  status: string;
  tags: string;
  assignee: string | null;
  department: string | null;
  machine_model: string | null;
  inspection_type: string | null;
  video_file: string | null;
  work_standard: string | null;
  created_at: string;
  updated_at: string;
}

function rowToProject(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    status: row.status,
    tags: JSON.parse(row.tags),
    assignee: row.assignee ?? undefined,
    department: row.department ?? undefined,
    machineModel: row.machine_model ?? undefined,
    inspectionType: row.inspection_type ?? undefined,
    videoFile: row.video_file ? JSON.parse(row.video_file) : undefined,
    workStandard: row.work_standard ? JSON.parse(row.work_standard) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as ProjectRow[];
  return NextResponse.json(rows.map(rowToProject));
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (!body.name) {
    return NextResponse.json({ error: "Project name is required" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const id = body.id ?? crypto.randomUUID();
  const db = getDb();

  db.prepare(`
    INSERT INTO projects (id, name, description, category, status, tags, assignee, department, machine_model, inspection_type, video_file, work_standard, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    body.name,
    body.description ?? "",
    body.category ?? "other",
    body.status ?? "draft",
    JSON.stringify(body.tags ?? []),
    body.assignee ?? null,
    body.department ?? null,
    body.machineModel ?? null,
    body.inspectionType ?? null,
    body.videoFile ? JSON.stringify(body.videoFile) : null,
    body.workStandard ? JSON.stringify(body.workStandard) : null,
    body.createdAt ?? now,
    body.updatedAt ?? now,
  );

  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow;
  return NextResponse.json(rowToProject(row), { status: 201 });
}
