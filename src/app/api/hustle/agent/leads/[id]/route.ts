import { NextRequest, NextResponse } from "next/server";
import { readLeadsByIds, updateLead, logEvent } from "@/lib/hustle/agent/db";
import { guard, oneOf, readJsonObject, str } from "@/lib/hustle/http";

// 人が実際に動いた後の状態だけを受け付ける。
// approved までは承認キューが進めるので、ここでは扱わない。
const MANUAL_STATUSES = ["applied", "won", "lost", "archived"] as const;

/**
 * 案件の状態を人の報告で進める。
 *
 * 承認は「出す」という意思表示までで、応募した・受注した・返事が無かったは
 * 本人にしか分からない。ここはその報告を受け取る口。応募実績や撤退判定は
 * この状態を根拠にするので、実際に起きたことだけを入れる。
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await ctx.params;
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;

    const status = oneOf(parsed.data.status, MANUAL_STATUSES);
    if (!status) {
      return NextResponse.json(
        { error: "status は applied / won / lost / archived です" },
        { status: 400 }
      );
    }

    const existing = readLeadsByIds([id]).get(id);
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 });

    const lead = updateLead(id, { status });
    const note = str(parsed.data.note, 500) ?? "";
    logEvent("manual", "runner", "action", `案件の状態を人の報告で更新: ${status} — ${existing.title.slice(0, 60)}`, {
      leadId: id,
      status,
      ...(note ? { note } : {}),
    });

    return NextResponse.json({ lead });
  });
}
