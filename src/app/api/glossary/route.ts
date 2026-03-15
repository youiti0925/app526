import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

interface GlossaryRow {
  id: string;
  term: string;
  reading: string | null;
  definition: string;
  category: string;
  synonyms: string;
}

function rowToEntry(row: GlossaryRow) {
  return {
    id: row.id,
    term: row.term,
    reading: row.reading ?? undefined,
    definition: row.definition,
    category: row.category,
    synonyms: JSON.parse(row.synonyms),
  };
}

export async function GET() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM glossary ORDER BY term").all() as GlossaryRow[];
  return NextResponse.json(rows.map(rowToEntry));
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (!body.term) {
    return NextResponse.json({ error: "Term is required" }, { status: 400 });
  }

  const db = getDb();
  const id = body.id ?? crypto.randomUUID();

  db.prepare(
    "INSERT INTO glossary (id, term, reading, definition, category, synonyms) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, body.term, body.reading ?? null, body.definition ?? "", body.category ?? "other", JSON.stringify(body.synonyms ?? []));

  const row = db.prepare("SELECT * FROM glossary WHERE id = ?").get(id) as GlossaryRow;
  return NextResponse.json(rowToEntry(row), { status: 201 });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();

  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const db = getDb();
  const existing = db.prepare("SELECT * FROM glossary WHERE id = ?").get(body.id) as GlossaryRow | undefined;
  if (!existing) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  db.prepare(
    "UPDATE glossary SET term = ?, reading = ?, definition = ?, category = ?, synonyms = ? WHERE id = ?"
  ).run(
    body.term ?? existing.term,
    body.reading !== undefined ? body.reading : existing.reading,
    body.definition ?? existing.definition,
    body.category ?? existing.category,
    body.synonyms ? JSON.stringify(body.synonyms) : existing.synonyms,
    body.id,
  );

  const row = db.prepare("SELECT * FROM glossary WHERE id = ?").get(body.id) as GlossaryRow;
  return NextResponse.json(rowToEntry(row));
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id query param is required" }, { status: 400 });
  }

  const db = getDb();
  const result = db.prepare("DELETE FROM glossary WHERE id = ?").run(id);

  if (result.changes === 0) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true, id });
}
