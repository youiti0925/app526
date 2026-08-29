import { NextRequest, NextResponse } from "next/server";

/**
 * 本人専用の合言葉ロック（オプトイン）。
 *
 * 環境変数 APP_PASSWORD を設定したときだけ有効になる。
 * このアプリは APIキー・案件データ・収支を認証なしで読み書きできるため、
 * 公開URLに置くなら必ず APP_PASSWORD を設定すること。
 * 未設定ならローカル開発をそのまま通す。
 *
 * Basic認証なので必ず HTTPS 越しで使う（Vercel等は常時HTTPS）。
 */
export function middleware(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const colon = decoded.indexOf(":");
      const given = colon >= 0 ? decoded.slice(colon + 1) : decoded;
      // 長さ差で早期リターンしない単純比較（文字列比較のタイミング差は
      // Basic認証+HTTPSの脅威モデルでは実害に至らないが、一応そろえる）
      let mismatch = given.length === password.length ? 0 : 1;
      for (let i = 0; i < password.length; i++) {
        mismatch |= password.charCodeAt(i) === given.charCodeAt(i % Math.max(1, given.length)) ? 0 : 1;
      }
      if (mismatch === 0) return NextResponse.next();
    } catch {
      // 壊れたヘッダは未認証として扱う
    }
  }

  return new NextResponse("認証が必要です", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="app526", charset="UTF-8"' },
  });
}

export const config = {
  // 静的アセット以外すべてを守る。APIも例外にしない。
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
