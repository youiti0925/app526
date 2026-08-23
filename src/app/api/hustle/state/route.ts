import { NextRequest, NextResponse } from "next/server";
import { STORAGE_IS_EPHEMERAL } from "@/lib/db";
import { isServerEmpty, readAll, restoreAll } from "@/lib/hustle/repo";
import { hasApiKey } from "@/lib/hustle/ai";
import { guard, readJsonObject } from "@/lib/hustle/http";

/** アプリ起動時に全データをまとめて取得する。 */
export async function GET() {
  try {
    const data = readAll();
    return NextResponse.json({
      ...data,
      meta: {
        // サーバー側ストレージが揮発性か（Vercel等）。UI が警告と自動バックアップを出す。
        ephemeralStorage: STORAGE_IS_EPHEMERAL,
        serverEmpty: isServerEmpty(),
        aiEnabled: hasApiKey(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** ブラウザに退避してあったバックアップでサーバーを復元する。 */
export async function POST(request: NextRequest) {
  return guard(async () => {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;

    const result = restoreAll(parsed.data);
    return NextResponse.json({ success: true, ...result, ...readAll() });
  });
}
