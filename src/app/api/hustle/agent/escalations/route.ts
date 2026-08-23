import { NextRequest, NextResponse } from "next/server";
import { applyVerdicts, buildBrief, collectEscalations, type EscalationVerdict } from "@/lib/hustle/agent/escalation";
import { guard, num, readJsonObject } from "@/lib/hustle/http";

/**
 * 上位モデルとの受け渡し口。
 *
 * GET  … 判定してほしい案件を、そのまま投げられる指示書にして返す
 * POST … 返ってきた判定を案件と承認キューに書き戻す
 *
 * localhost でしか使わない前提。外に出すなら認証が要る。
 */
export async function GET(request: NextRequest) {
  return guard(async () => {
    const limitParam = num(request.nextUrl.searchParams.get("limit"));
    const limit = Math.max(1, Math.min(20, Math.round(limitParam ?? 10)));
    const items = collectEscalations(limit);

    if (request.nextUrl.searchParams.get("format") === "json") {
      return NextResponse.json({ count: items.length, items });
    }

    if (items.length === 0) {
      return new NextResponse("判定してほしい案件はありません。\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return new NextResponse(buildBrief(items), {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  });
}

export async function POST(request: NextRequest) {
  return guard(async () => {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;

    const raw = parsed.data.verdicts;
    if (!Array.isArray(raw)) {
      return NextResponse.json({ error: "verdicts は配列である必要があります" }, { status: 400 });
    }

    const verdicts = raw.filter(
      (v): v is EscalationVerdict => Boolean(v) && typeof v === "object" && typeof (v as EscalationVerdict).leadId === "string"
    );
    if (verdicts.length === 0) {
      return NextResponse.json({ error: "leadId を持つ判定が1件もありません" }, { status: 400 });
    }

    const result = applyVerdicts(verdicts);
    return NextResponse.json(result);
  });
}
