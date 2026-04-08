import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

// GET /api/xr20-monitor?file=xr20_monitor.py
export async function GET(request: NextRequest) {
  const file = request.nextUrl.searchParams.get("file");

  const allowed: Record<string, { path: string; mime: string }> = {
    "xr20_monitor.py": {
      path: join(process.cwd(), "xr20_tool", "xr20_monitor.py"),
      mime: "text/x-python",
    },
    "build_monitor.bat": {
      path: join(process.cwd(), "xr20_tool", "build_monitor.bat"),
      mime: "application/x-bat",
    },
  };

  if (!file || !allowed[file]) {
    return NextResponse.json(
      { error: "file パラメータが不正です", available: Object.keys(allowed) },
      { status: 400 }
    );
  }

  try {
    const { path, mime } = allowed[file];
    const content = readFileSync(path);
    return new NextResponse(content, {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename="${file}"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `ファイル読み取りエラー: ${e}` },
      { status: 500 }
    );
  }
}
