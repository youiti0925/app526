import { NextRequest, NextResponse } from "next/server";
import { guard, readJsonObject, str, num, oneOf, date } from "@/lib/hustle/http";
import { createJob, readJobs, listRecipes, usageSince } from "@/lib/hustle/jobs/db";
import { kickJobWorker, jobWorkerRunning } from "@/lib/hustle/jobs/worker";
import { claudeStatus } from "@/lib/hustle/jobs/claude-status";
import { parseTable, toCsvText } from "@/lib/hustle/dataops/table";
import { readXlsx, sheetToTable, XlsxError } from "@/lib/hustle/dataops/xlsx";
import { tierModel } from "@/lib/hustle/jobs/models";

const MAX_CSV = 5_000_000;
const MAX_ROWS = 3000;

/** 一覧。重い本文（入力・出力のCSV）は返さない。 */
export async function GET() {
  return guard(async () => {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const jobs = readJobs(50).map(({ inputCsv, outputCsv, issues, removed, ...rest }) => ({
      ...rest,
      inputBytes: inputCsv.length,
      issueCount: issues.length,
      removedCount: removed.length,
      hasOutput: outputCsv.length > 0,
    }));
    const recipes = listRecipes().map((r) => ({
      id: r.id, version: r.version, name: r.name, summary: r.summary, tier: r.tier, preferred: r.preferred,
      stats: r.stats, trials: r.trials.slice(-5), hasTestSet: !!r.testSet, testSetSource: r.testSet?.source ?? null,
      steps: r.steps.map((s) => s.op), outputColumns: r.output.columns, updatedAt: r.updatedAt,
    }));
    return NextResponse.json({
      jobs,
      recipes,
      usageWeek: usageSince(weekAgo),
      workerRunning: jobWorkerRunning(),
      claude: await claudeStatus(),
      models: { light: tierModel("light"), standard: tierModel("standard"), heavy: tierModel("heavy") },
    });
  });
}

/** ① 依頼を入れる。入ったらすぐ処理を始める。 */
export async function POST(request: NextRequest) {
  return guard(async () => {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const b = parsed.data;
    const title = str(b.title, 200)?.trim() ?? "";
    const instructions = str(b.instructions, 20_000)?.trim() ?? "";
    let inputCsv = typeof b.inputCsv === "string" ? b.inputCsv : "";
    if (!title || !instructions) return NextResponse.json({ error: "件名と依頼内容を入れてください" }, { status: 400 });
    // Excel（.xlsx）はブラウザから base64 で届く。サーバーで表にしてCSVとして扱う
    if (typeof b.inputXlsxBase64 === "string" && b.inputXlsxBase64) {
      if (b.inputXlsxBase64.length > MAX_CSV * 1.4) return NextResponse.json({ error: "Excelが大きすぎます（5MBまで）" }, { status: 400 });
      try {
        const book = readXlsx(Buffer.from(b.inputXlsxBase64, "base64"));
        const wanted = typeof b.sheet === "string" ? b.sheet : "";
        const sheet = (wanted && book.sheets.find((s) => s.name === wanted)) || book.sheets.find((s) => s.rows.some((r) => r.some((v) => v.trim())));
        if (!sheet) return NextResponse.json({ error: "Excelに表がありません" }, { status: 400 });
        const t = sheetToTable(sheet);
        inputCsv = toCsvText(t.rows, t.headers);
      } catch (e) {
        const message = e instanceof XlsxError ? e.message : "Excelを読めませんでした";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }
    if (!inputCsv.trim()) return NextResponse.json({ error: "入力の表（CSV）を入れてください" }, { status: 400 });
    if (inputCsv.length > MAX_CSV) return NextResponse.json({ error: "入力が大きすぎます（5MBまで）" }, { status: 400 });
    const table = parseTable(inputCsv);
    if (table.rows.length === 0) return NextResponse.json({ error: "入力の表に行がありません（1行目は見出し）" }, { status: 400 });
    if (table.rows.length > MAX_ROWS) return NextResponse.json({ error: `入力は${MAX_ROWS}行までです（分けて入れてください）` }, { status: 400 });

    const lists: Record<string, string[]> = {};
    if (b.lists && typeof b.lists === "object" && !Array.isArray(b.lists)) {
      for (const [name, value] of Object.entries(b.lists as Record<string, unknown>).slice(0, 10)) {
        const key = name.trim().slice(0, 60);
        if (!key) continue;
        const items = (Array.isArray(value) ? value : typeof value === "string" ? value.split(/\r?\n/) : [])
          .map((v) => String(v).trim())
          .filter(Boolean)
          .slice(0, 5000);
        if (items.length) lists[key] = items;
      }
    }

    const job = createJob({
      title,
      instructions,
      inputCsv,
      lists,
      dataClass: oneOf(b.dataClass, ["public", "confidential"] as const) ?? "confidential",
      deadline: date(b.deadline) ?? "",
      priceJpy: Math.max(0, Math.round(num(b.priceJpy) ?? 0)),
    });
    kickJobWorker();
    return NextResponse.json({ job: { id: job.id, status: job.status } }, { status: 201 });
  });
}
