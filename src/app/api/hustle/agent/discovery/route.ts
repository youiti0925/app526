import { NextRequest, NextResponse } from "next/server";
import { applyFindings, buildNextBrief } from "@/lib/hustle/agent/discovery";
import { readDiscoveries, setDiscoveryStatus } from "@/lib/hustle/agent/db";
import { guard, num, oneOf, readJsonObject, str } from "@/lib/hustle/http";
import type { Discovery } from "@/lib/hustle/agent/discovery";

/**
 * 探索層の受け渡し口。
 *
 * GET   … 「市場を探してきて」の指示書を返す（?format=json で結果一覧）
 * POST  … 探してきた結果を取り込む
 * PATCH … 見つけた市場の状態（やる/保留/やめる）を変える
 *
 * localhost でしか使わない前提。外に出すなら認証が要る。
 */
export async function GET(request: NextRequest) {
  return guard(async () => {
    const params = request.nextUrl.searchParams;

    if (params.get("format") === "json") {
      const limit = Math.max(1, Math.min(200, Math.round(num(params.get("limit")) ?? 50)));
      return NextResponse.json({ discoveries: readDiscoveries(limit) });
    }

    const want = Math.max(1, Math.min(20, Math.round(num(params.get("want")) ?? 6)));
    return new NextResponse(buildNextBrief(want), {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  });
}

export async function POST(request: NextRequest) {
  return guard(async () => {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;

    const body = parsed.data;
    if (!Array.isArray(body.findings)) {
      return NextResponse.json({ error: "findings は配列である必要があります" }, { status: 400 });
    }

    const runId = str(body.runId) || `discovery-${Date.now()}`;
    const result = applyFindings(runId, body);
    return NextResponse.json(result);
  });
}

const STATUSES = ["new", "trying", "parked", "dropped"] as const satisfies readonly Discovery["status"][];

export async function PATCH(request: NextRequest) {
  return guard(async () => {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;

    const id = str(parsed.data.id);
    const status = oneOf(parsed.data.status, STATUSES);
    if (!id || !status) {
      return NextResponse.json(
        { error: `id と status（${STATUSES.join(" / ")}）が必要です` },
        { status: 400 }
      );
    }

    const discovery = setDiscoveryStatus(id, status);
    if (!discovery) return NextResponse.json({ error: "見つかりませんでした" }, { status: 404 });
    return NextResponse.json({ discovery });
  });
}
