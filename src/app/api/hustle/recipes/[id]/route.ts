import { NextRequest, NextResponse } from "next/server";
import { guard, readJsonObject, oneOf } from "@/lib/hustle/http";
import { getRecipe, recipeVersions } from "@/lib/hustle/jobs/db";
import { runModelComparison } from "@/lib/hustle/jobs/worker";

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await ctx.params;
    const recipe = getRecipe(id);
    if (!recipe) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
    return NextResponse.json({ recipe, versions: recipeVersions(id) });
  });
}

/** compare: 手本を使って、安いモデルでも足りるか試す。手本の行数×候補数だけAIを呼ぶ。 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await ctx.params;
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    if (oneOf(parsed.data.action, ["compare"] as const) !== "compare") {
      return NextResponse.json({ error: "action は compare です" }, { status: 400 });
    }
    const result = await runModelComparison(id);
    if (!result) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
    return NextResponse.json(result);
  });
}
