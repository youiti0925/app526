import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];

  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      settings[row.key] = row.value;
    }
  }
  // APIキーの実物は外に出さない。保存済みかどうかだけ返す。
  // GET /api/settings は画面から呼ばれるため、ここでキーを返すと
  // 公開デプロイした瞬間に誰でもキーを取得できてしまう。
  const hasGeminiApiKey = typeof settings.geminiApiKey === "string" && settings.geminiApiKey.length > 0;
  delete settings.geminiApiKey;
  return NextResponse.json({ ...settings, geminiApiKey: "", hasGeminiApiKey });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const db = getDb();

  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );

  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(body)) {
      // GET がキーを空文字でマスクして返すため、画面の一括保存が
      // 空文字を送り返してくる。それで保存済みキーを消さない。
      // 消したいときは null を明示する。
      if (key === "geminiApiKey" && value === "") continue;
      if (key === "hasGeminiApiKey") continue;
      if (key === "geminiApiKey" && value === null) {
        upsert.run(key, "");
        continue;
      }
      upsert.run(key, typeof value === "string" ? value : JSON.stringify(value));
    }
  });
  tx();

  return NextResponse.json({ success: true });
}
