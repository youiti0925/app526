import { NextRequest, NextResponse } from "next/server";
import { readJob } from "@/lib/hustle/jobs/db";
import { outputWithIssuesCsv, outputXlsx } from "@/lib/hustle/jobs/worker";

/**
 * 納品物のダウンロード。
 * kind=output（既定）/ annotated … CSV、kind=xlsx / annotated-xlsx … Excel（要確認の行は赤）
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = readJob(id);
  if (!job || !job.outputCsv) return NextResponse.json({ error: "出力がありません" }, { status: 404 });
  const kind = request.nextUrl.searchParams.get("kind") ?? "output";
  const safeTitle = job.title.replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 60) || "output";
  if (kind === "xlsx" || kind === "annotated-xlsx") {
    const annotatedX = kind === "annotated-xlsx";
    const name = `${safeTitle}${annotatedX ? "_確認メモ付き" : ""}.xlsx`;
    return new NextResponse(new Uint8Array(outputXlsx(job, annotatedX)), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="output.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    });
  }
  const annotated = kind === "annotated";
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
