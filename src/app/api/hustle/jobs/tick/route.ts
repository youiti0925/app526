import { NextResponse } from "next/server";
import { guard } from "@/lib/hustle/http";
import { kickJobWorker, jobWorkerRunning } from "@/lib/hustle/jobs/worker";

/** デーモンからの合図。処理待ち・上限待ちの依頼があれば処理を始める。 */
export async function POST() {
  return guard(async () => {
    const before = jobWorkerRunning();
    kickJobWorker();
    return NextResponse.json({ alreadyRunning: before, running: jobWorkerRunning() });
  });
}
