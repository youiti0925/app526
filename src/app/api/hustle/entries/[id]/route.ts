import { NextRequest, NextResponse } from "next/server";
import { readEntries } from "@/lib/hustle/db";
import { deleteEntry, upsertEntry } from "@/lib/hustle/repo";
import { ENTRY_KINDS, bool, date, guard, num, oneOf, readJsonObject, str } from "@/lib/hustle/http";

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await ctx.params;
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const existing = readEntries().find((e) => e.id === id);
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 });

    return NextResponse.json({
      entry: upsertEntry({
        ...existing,
        pathId: "pathId" in body ? str(body.pathId, 64) ?? null : existing.pathId,
        date: date(body.date) ?? existing.date,
        kind: oneOf(body.kind, ENTRY_KINDS) ?? existing.kind,
        amountJpy: num(body.amountJpy) ?? existing.amountJpy,
        minutes: num(body.minutes) ?? existing.minutes,
        memo: str(body.memo, 2000) ?? existing.memo,
        settled: bool(body.settled, existing.settled),
        id,
      }),
    });
  });
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await ctx.params;
    if (!deleteEntry(id)) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
    return NextResponse.json({ success: true });
  });
}
