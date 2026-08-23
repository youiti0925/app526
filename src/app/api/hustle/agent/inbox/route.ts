import { NextResponse } from "next/server";
import { readInbox } from "@/lib/hustle/agent/db";
import { guard } from "@/lib/hustle/http";

export async function GET() {
  return guard(async () => NextResponse.json({ inbox: readInbox("pending", 200) }));
}
