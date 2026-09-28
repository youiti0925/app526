import { NextRequest, NextResponse } from "next/server";
import { guard, readJsonObject, str, oneOf } from "@/lib/hustle/http";
import { readJob, usageForJob, getRecipe } from "@/lib/hustle/jobs/db";
import { decideJob } from "@/lib/hustle/jobs/worker";
import { parseTable } from "@/lib/hustle/dataops/table";

const PREVIEW_ROWS = 200;

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await ctx.params;
    const job = readJob(id);
    if (!job) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
    const output = parseTable(job.outputCsv);
    const input = parseTable(job.inputCsv);
    const recipe = job.recipeId ? getRecipe(job.recipeId) : null;
    const { inputCsv, outputCsv, ...rest } = job;
    return NextResponse.json({
      job: rest,
      input: { headers: input.headers, rows: input.rows.slice(0, 5), total: input.rows.length, bytes: inputCsv.length },
      output: {
        headers: output.headers,
        rows: output.rows.slice(0, PREVIEW_ROWS),
        src: job.outputSrc.slice(0, PREVIEW_ROWS),
        total: output.rows.length,
        bytes: outputCsv.length,
      },
      recipe: recipe
        ? { id: recipe.id, version: recipe.version, name: recipe.name, summary: recipe.summary, steps: recipe.steps, output: recipe.output, tier: recipe.tier, preferred: recipe.preferred }
        : null,
      usage: usageForJob(id),
    });
  });
}

/**
 * ⑦ 人の判断。
 * approve: この内容で納品してよい（送信はしない。各サイトで人が納品する）
 * reject : 納品しない
 * redo   : 理由を付けて作り直させる（理由は手順書の改修に使われる）
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await ctx.params;
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const action = oneOf(parsed.data.action, ["approve", "reject", "redo"] as const);
    if (!action) return NextResponse.json({ error: "action は approve / reject / redo です" }, { status: 400 });
    const note = str(parsed.data.note, 2000)?.trim() ?? "";
    if (action === "redo" && !note) return NextResponse.json({ error: "どこを直すかを書いてください" }, { status: 400 });
    const job = decideJob(id, action === "approve" ? "approved" : action === "reject" ? "rejected" : "redo", note);
    if (!job) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
    return NextResponse.json({ job: { id: job.id, status: job.status, note: job.note } });
  });
}
