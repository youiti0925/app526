import { NextRequest, NextResponse } from "next/server";
import { readEntries } from "@/lib/hustle/db";
import { upsertEntry } from "@/lib/hustle/repo";
import { ENTRY_KINDS, bool, date, guard, num, oneOf, readJsonObject, str } from "@/lib/hustle/http";

export async function GET() {
  return guard(async () => NextResponse.json({ entries: readEntries() }));
}

export async function POST(request: NextRequest) {
  return guard(async () => {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const kind = oneOf(body.kind, ENTRY_KINDS);
    if (!kind) {
      return NextResponse.json({ error: "kind は income / expense / time のいずれかです" }, { status: 400 });
    }

    return NextResponse.json(
      {
        entry: upsertEntry({
          id: str(body.id, 64),
          pathId: str(body.pathId, 64) ?? null,
          date: date(body.date),
          kind,
          amountJpy: num(body.amountJpy) ?? 0,
          minutes: num(body.minutes) ?? 0,
          memo: str(body.memo, 2000) ?? "",
          settled: bool(body.settled, true),
          createdAt: str(body.createdAt, 40),
        }),
      },
      { status: 201 }
    );
  });
}
