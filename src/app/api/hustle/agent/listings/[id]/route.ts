import { NextRequest, NextResponse } from "next/server";
import { readPublishedListing, upsertPublishedListing, logEvent } from "@/lib/hustle/agent/db";
import { guard, num, oneOf, readJsonObject, str } from "@/lib/hustle/http";

/** 負の数と小数を弾く。実績は0以上の整数。 */
const clamp = (n: number | undefined, min: number): number | undefined =>
  n === undefined ? undefined : Math.max(min, Math.round(n));
import type { ListingStatus } from "@/lib/hustle/agent/listing-tracker";

const STATUSES = ["published", "paused", "closed"] as const satisfies readonly ListingStatus[];

/**
 * 出品の実績を更新する。
 *
 * 閲覧数・問い合わせ数・受注数は、出品先の管理画面を見ないと分かりません。
 * 自動で取りに行くことはしません（ログインが要るうえ、各社の規約に触れます）。
 * ここは、人が見た数字を受け取る口です。
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await ctx.params;
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const existing = readPublishedListing(id);
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 });

    const listing = upsertPublishedListing({
      ...existing,
      url: str(body.url, 500) ?? existing.url,
      views: clamp(num(body.views), 0) ?? existing.views,
      inquiries: clamp(num(body.inquiries), 0) ?? existing.inquiries,
      orders: clamp(num(body.orders), 0) ?? existing.orders,
      priceJpy: clamp(num(body.priceJpy), 0) ?? existing.priceJpy,
      status: oneOf(body.status, STATUSES) ?? existing.status,
      lastCheckedAt: new Date().toISOString(),
    });

    logEvent("manual", "listing", "action", `出品の実績を更新: ${listing.title}`, {
      listingId: listing.id,
      views: listing.views,
      inquiries: listing.inquiries,
      orders: listing.orders,
    });

    return NextResponse.json({ listing });
  });
}
