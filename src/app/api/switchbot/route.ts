import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const SWITCHBOT_API = "https://api.switch-bot.com/v1.1";

function makeHeaders(token: string, secret: string) {
  const nonce = crypto.randomUUID();
  const t = Date.now().toString();
  const stringToSign = `${token}${t}${nonce}`;
  const sign = crypto
    .createHmac("sha256", secret)
    .update(stringToSign)
    .digest("base64");

  return {
    Authorization: token,
    t,
    sign,
    nonce,
    "Content-Type": "application/json; charset=utf-8",
  };
}

// POST /api/switchbot  — ボタン押下
export async function POST(request: NextRequest) {
  const { token, secret, deviceId, command } = await request.json();

  if (!token || !secret || !deviceId) {
    return NextResponse.json(
      { error: "token, secret, deviceId が必要です" },
      { status: 400 }
    );
  }

  const headers = makeHeaders(token, secret);
  const body = {
    command: command || "press",
    parameter: "default",
    commandType: "command",
  };

  try {
    const res = await fetch(`${SWITCHBOT_API}/devices/${deviceId}/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: `SwitchBot API通信エラー: ${e}` },
      { status: 502 }
    );
  }
}

// GET /api/switchbot?token=...&secret=...  — デバイス一覧
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const secret = request.nextUrl.searchParams.get("secret");

  if (!token || !secret) {
    return NextResponse.json(
      { error: "token, secret が必要です" },
      { status: 400 }
    );
  }

  const headers = makeHeaders(token, secret);

  try {
    const res = await fetch(`${SWITCHBOT_API}/devices`, { headers });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: `SwitchBot API通信エラー: ${e}` },
      { status: 502 }
    );
  }
}
