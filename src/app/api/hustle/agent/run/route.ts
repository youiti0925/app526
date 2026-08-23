import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/hustle/agent/runner";
import { guard, readJsonObject } from "@/lib/hustle/http";
import { STEP_ORDER } from "@/lib/hustle/agent/types";
import type { RunTrigger, StepId } from "@/lib/hustle/agent/types";

const TRIGGERS: RunTrigger[] = ["manual", "auto_open", "daemon", "cron"];

export async function POST(request: NextRequest) {
  return guard(async () => {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;

    const trigger = TRIGGERS.includes(parsed.data.trigger as RunTrigger)
      ? (parsed.data.trigger as RunTrigger)
      : "manual";
    // 絞り込みの指定は、黙って捨てない。
    // 知らない工程名が混ざっていたら 400 を返す。
    // ここを「除外して続行」にしていたので、`only: ["listing"]` のように
    // 全部が知らない名前だと絞り込み自体が消えて、全工程が走っていた。
    let only: StepId[] | undefined;
    if (parsed.data.only !== undefined) {
      if (!Array.isArray(parsed.data.only)) {
        return NextResponse.json({ error: "only は工程名の配列です" }, { status: 400 });
      }
      const unknown = parsed.data.only.filter((s) => !STEP_ORDER.includes(s as StepId));
      if (unknown.length) {
        return NextResponse.json(
          {
            error: `知らない工程です: ${unknown.map(String).join(", ")}（指定できるのは ${STEP_ORDER.join(", ")}）`,
          },
          { status: 400 }
        );
      }
      only = parsed.data.only as StepId[];
      if (only.length === 0) {
        return NextResponse.json({ error: "only が空です" }, { status: 400 });
      }
    }

    const outcome = await runAgent({
      trigger,
      force: parsed.data.force === true,
      ...(only ? { only } : {}),
    });

    return NextResponse.json(outcome);
  });
}
