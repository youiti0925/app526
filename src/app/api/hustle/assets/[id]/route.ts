import { NextRequest, NextResponse } from "next/server";
import { readAssets } from "@/lib/hustle/db";
import { deleteAsset, upsertAsset } from "@/lib/hustle/repo";
import { ASSET_STATUSES, guard, oneOf, readJsonObject, str } from "@/lib/hustle/http";

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await ctx.params;
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const existing = readAssets().find((a) => a.id === id);
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 });

    return NextResponse.json({
      asset: upsertAsset({
        ...existing,
        title: str(body.title, 300) ?? existing.title,
        body: str(body.body, 20000) ?? existing.body,
        status: oneOf(body.status, ASSET_STATUSES) ?? existing.status,
        id,
      }),
    });
  });
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await ctx.params;
    if (!deleteAsset(id)) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
    return NextResponse.json({ success: true });
  });
}
