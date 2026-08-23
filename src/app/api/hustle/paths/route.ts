import { NextRequest, NextResponse } from "next/server";
import { readPaths } from "@/lib/hustle/db";
import { createPath } from "@/lib/hustle/repo";
import type { PathKey } from "@/lib/hustle/types";
import { PATH_DEFINITIONS } from "@/lib/hustle/paths-data";
import { PATH_STATUSES, date, guard, num, oneOf, readJsonObject, str } from "@/lib/hustle/http";

const PATH_KEYS = PATH_DEFINITIONS.map((d) => d.key) as readonly PathKey[];

export async function GET() {
  return guard(async () => NextResponse.json({ paths: readPaths() }));
}

export async function POST(request: NextRequest) {
  return guard(async () => {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const pathKey = oneOf(body.pathKey, PATH_KEYS);
    const name = str(body.name, 200);
    if (!pathKey || !name?.trim()) {
      return NextResponse.json({ error: "pathKey（既知のチャネル）と name は必須です" }, { status: 400 });
    }

    return NextResponse.json(
      {
        path: createPath({
          id: str(body.id, 64),
          pathKey,
          name,
          status: oneOf(body.status, PATH_STATUSES) ?? "active",
          targetJpy: Math.max(0, Math.round(num(body.targetJpy) ?? 0)),
          notes: str(body.notes, 4000) ?? "",
          startedAt: date(body.startedAt),
          createdAt: str(body.createdAt, 40),
        }),
      },
      { status: 201 }
    );
  });
}
