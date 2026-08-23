import { NextResponse } from "next/server";
import { countInbox, readInbox } from "@/lib/hustle/agent/db";
import { guard } from "@/lib/hustle/http";

const LIMIT = 200;

export async function GET() {
  return guard(async () => {
    const inbox = readInbox("pending", LIMIT);
    const total = countInbox("pending");
    // 上限で隠れているぶんを黙って消さない。件数だけは返す。
    return NextResponse.json({ inbox, total, hidden: Math.max(0, total - inbox.length) });
  });
}
