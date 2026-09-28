import { NextRequest, NextResponse } from "next/server";
import { readJob } from "@/lib/hustle/jobs/db";
import { outputWithIssuesCsv } from "@/lib/hustle/jobs/worker";

/** 納品用CSV（kind=output）と、要確認メモ付きCSV（kind=annotated）。 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = readJob(id);
  if (!job || !job.outputCsv) return NextResponse.json({ error: "出力がありません" }, { status: 404 });
  const annotated = request.nextUrl.searchParams.get("kind") === "annotated";
  const body = annotated ? outputWithIssuesCsv(job) : job.outputCsv;
  const safe = job.title.replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 60) || "output";
  const name = `${safe}${annotated ? "_確認メモ付き" : ""}.csv`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="output.csv"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
