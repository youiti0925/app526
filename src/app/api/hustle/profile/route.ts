import { NextRequest, NextResponse } from "next/server";
import { readProfile } from "@/lib/hustle/db";
import { saveProfile } from "@/lib/hustle/repo";

export async function GET() {
  return NextResponse.json({ profile: readProfile() });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const profile = saveProfile(body);
  return NextResponse.json({ profile });
}
