import { NextResponse } from "next/server";
import { readPublishedListings } from "@/lib/hustle/agent/db";
import { reviewListing, summarizeListings } from "@/lib/hustle/agent/listing-tracker";
import { todayLocal } from "@/lib/hustle/analytics";
import { guard } from "@/lib/hustle/http";

export async function GET() {
  return guard(async () => {
    const listings = readPublishedListings();
    const today = todayLocal();
    const reviews = listings.map((l) => reviewListing(l, today));
    return NextResponse.json({
      listings,
      reviews,
      summary: reviews.length ? summarizeListings(reviews) : "",
    });
  });
}
