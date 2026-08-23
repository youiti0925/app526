import { NextRequest, NextResponse } from "next/server";
import { diagnose } from "@/lib/hustle/diagnose";
import { PATH_DEFINITIONS } from "@/lib/hustle/paths-data";
import { emptyProfile } from "@/lib/hustle/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const profile = { ...emptyProfile, ...body };
    const result = diagnose(profile, PATH_DEFINITIONS);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "診断に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
