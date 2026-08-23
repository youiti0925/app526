import { NextRequest, NextResponse } from "next/server";

/**
 * API ルート共通の入力検証。
 *
 * request.json() は壊れた JSON で throw するので、素で呼ぶと 400 であるべき
 * リクエストが 500 になる。型の検証もここに集約して、DB に壊れた値が
 * 入らないようにする（空文字の日付が入ると、経過日数の計算が NaN になって
 * 撤退判定が誤作動する）。
 */

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

const bad = (message: string) => ({
  ok: false as const,
  response: NextResponse.json({ error: message }, { status: 400 }),
});

/** JSON のオブジェクトとして読む。壊れていれば 400。 */
export async function readJsonObject(request: NextRequest): Promise<Parsed<Record<string, unknown>>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return bad("リクエストの形式が不正です（JSONとして読み取れません）");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return bad("リクエストの形式が不正です（オブジェクトを期待しています）");
  }
  return { ok: true, data: raw as Record<string, unknown> };
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MAX_TEXT = 20_000;

/** 文字列として受け取り、長すぎるものは切り詰める。 */
export function str(value: unknown, max = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.slice(0, Math.min(max, MAX_TEXT));
}

/** 有限の数値のみ通す。NaN・Infinity・数値でない文字列は undefined。 */
export function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function date(value: unknown): string | undefined {
  if (typeof value !== "string" || !DATE_RE.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? value : undefined;
}

export function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export const ENTRY_KINDS = ["income", "expense", "time"] as const;
export const TASK_KINDS = ["setup", "produce", "publish", "outreach", "admin", "learn"] as const;
export const TASK_STATUSES = ["todo", "doing", "done", "skipped"] as const;
export const PATH_STATUSES = ["considering", "active", "paused", "killed"] as const;
export const ASSET_STATUSES = ["draft", "ready", "published"] as const;

/** ハンドラ全体を包んで、想定外の例外を 500 の JSON にする（HTMLエラーページを返さない）。 */
export async function guard(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";
    return NextResponse.json({ error: `処理に失敗しました: ${message}` }, { status: 500 });
  }
}
