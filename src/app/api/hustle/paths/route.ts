import { NextRequest, NextResponse } from "next/server";
import { readPaths } from "@/lib/hustle/db";
import { createPath } from "@/lib/hustle/repo";

export async function GET() {
  return NextResponse.json({ paths: readPaths() });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body?.pathKey || !body?.name) {
    return NextResponse.json({ error: "pathKey と name は必須です" }, { status: 400 });
  }
  return NextResponse.json({ path: createPath(body) }, { status: 201 });
}
