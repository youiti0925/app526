import { NextRequest, NextResponse } from "next/server";
import { readProfile } from "@/lib/hustle/db";
import { saveProfile } from "@/lib/hustle/repo";
import { emptyProfile } from "@/lib/hustle/types";
import { bool, date, guard, num, readJsonObject, str } from "@/lib/hustle/http";

const strings = (value: unknown, max = 40): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string").slice(0, max).map((v) => v.slice(0, 60))
    : [];

export async function GET() {
  return guard(async () => NextResponse.json({ profile: readProfile() }));
}

export async function PUT(request: NextRequest) {
  return guard(async () => {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const profile = saveProfile({
      ...emptyProfile,
      weeklyHours: Math.max(0, Math.min(168, Math.round(num(body.weeklyHours) ?? emptyProfile.weeklyHours))),
      budgetJpy: Math.max(0, Math.round(num(body.budgetJpy) ?? 0)),
      goalJpy: Math.max(0, Math.round(num(body.goalJpy) ?? emptyProfile.goalJpy)),
      deadline: date(body.deadline) ?? "",
      skills: strings(body.skills),
      equipment: strings(body.equipment),
      hasBankAccount: bool(body.hasBankAccount, true),
      hasIdVerification: bool(body.hasIdVerification, true),
      needsAnonymity: bool(body.needsAnonymity, false),
      avoid: strings(body.avoid),
      background: str(body.background, 4000) ?? "",
      updatedAt: str(body.updatedAt, 40) ?? "",
    });
    return NextResponse.json({ profile });
  });
}
