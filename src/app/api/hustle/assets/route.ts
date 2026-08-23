import { NextRequest, NextResponse } from "next/server";
import { readAssets } from "@/lib/hustle/db";
import { upsertAsset } from "@/lib/hustle/repo";

export async function GET() {
  return NextResponse.json({ assets: readAssets() });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body?.title) return NextResponse.json({ error: "title は必須です" }, { status: 400 });
  return NextResponse.json({ asset: upsertAsset(body) }, { status: 201 });
}
