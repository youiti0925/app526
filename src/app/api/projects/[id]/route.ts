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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;

  if (!row) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json(rowToProject(row));
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const db = getDb();

  const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  if (!existing) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE projects SET
      name = ?, description = ?, category = ?, status = ?,
      tags = ?, assignee = ?, department = ?, machine_model = ?,
      inspection_type = ?, video_file = ?, work_standard = ?, updated_at = ?
    WHERE id = ?
  `).run(
    body.name ?? existing.name,
    body.description ?? existing.description,
    body.category ?? existing.category,
    body.status ?? existing.status,
    body.tags ? JSON.stringify(body.tags) : existing.tags,
    body.assignee !== undefined ? body.assignee : existing.assignee,
    body.department !== undefined ? body.department : existing.department,
    body.machineModel !== undefined ? body.machineModel : existing.machine_model,
    body.inspectionType !== undefined ? body.inspectionType : existing.inspection_type,
    body.videoFile !== undefined ? (body.videoFile ? JSON.stringify(body.videoFile) : null) : existing.video_file,
    body.workStandard !== undefined ? (body.workStandard ? JSON.stringify(body.workStandard) : null) : existing.work_standard,
    now,
    id,
  );

  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow;
  return NextResponse.json(rowToProject(row));
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const result = db.prepare("DELETE FROM projects WHERE id = ?").run(id);

  if (result.changes === 0) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true, id });
}
