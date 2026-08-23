import { NextRequest, NextResponse } from "next/server";
import { deletePath, updatePath } from "@/lib/hustle/repo";
import { PATH_STATUSES, date, guard, num, oneOf, readJsonObject, str } from "@/lib/hustle/http";

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await ctx.params;
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const path = updatePath(id, {
      ...(str(body.name, 200) !== undefined ? { name: str(body.name, 200) } : {}),
      ...(oneOf(body.status, PATH_STATUSES) ? { status: oneOf(body.status, PATH_STATUSES) } : {}),
      ...(num(body.targetJpy) !== undefined ? { targetJpy: Math.max(0, Math.round(num(body.targetJpy)!)) } : {}),
      ...(str(body.notes, 4000) !== undefined ? { notes: str(body.notes, 4000) } : {}),
      ...(date(body.startedAt) ? { startedAt: date(body.startedAt) } : {}),
    });
    if (!path) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
    return NextResponse.json({ path });
  });
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await ctx.params;
    if (!deletePath(id)) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
    return NextResponse.json({ success: true });
  });
}
