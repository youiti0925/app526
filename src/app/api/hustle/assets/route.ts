import { NextRequest, NextResponse } from "next/server";
import { readAssets } from "@/lib/hustle/db";
import { upsertAsset } from "@/lib/hustle/repo";
import type { AssetKind } from "@/lib/hustle/types";
import { ASSET_STATUSES, guard, oneOf, readJsonObject, str } from "@/lib/hustle/http";

const ASSET_KINDS = [
  "proposal",
  "article",
  "thread",
  "script",
  "listing",
  "outreach_mail",
  "profile",
  "other",
] as const satisfies readonly AssetKind[];

export async function GET() {
  return guard(async () => NextResponse.json({ assets: readAssets() }));
}

export async function POST(request: NextRequest) {
  return guard(async () => {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const title = str(body.title, 300);
    if (!title?.trim()) return NextResponse.json({ error: "title は必須です" }, { status: 400 });

    return NextResponse.json(
      {
        asset: upsertAsset({
          id: str(body.id, 64),
          pathId: str(body.pathId, 64) ?? null,
          kind: oneOf(body.kind, ASSET_KINDS) ?? "other",
          title,
          body: str(body.body, 20000) ?? "",
          meta: body.meta && typeof body.meta === "object" ? (body.meta as Record<string, unknown>) : {},
          status: oneOf(body.status, ASSET_STATUSES) ?? "draft",
          createdAt: str(body.createdAt, 40),
        }),
      },
      { status: 201 }
    );
  });
}
