/**
 * 出品したあとの追跡。
 *
 * なぜ要るか:
 * 出品型が本線になったのに、出品したあとが記録されていなかった。
 * 出品文を作って承認キューに出して終わり。売れたのか、見られてもいないのかが
 * 分からないので、いつまでも同じ出品文を出し続けることになる。
 *
 * 出品型は初速が出ない。実際に売れ始めるまで2〜3か月かかるのが普通なので、
 * 2週間で「売れないからやめる」と判断させてはいけない。
 * かといって、半年放置して0件のものを「まだ早い」と言い続けるのも違う。
 * 判定の境目を数字で決めておく。
 */

export type ListingStatus = "approved" | "published" | "paused" | "closed";

export type ListingVerdict =
  | "too_early" // まだ判断できない
  | "invisible" // 見られていない（露出の問題）
  | "no_conversion" // 見られているが売れない（内容か価格の問題）
  | "working" // 回っている
  | "stop"; // やめたほうがいい

export const LISTING_VERDICT_LABELS: Record<ListingVerdict, string> = {
  too_early: "まだ判断できない",
  invisible: "見られていない",
  no_conversion: "見られているが売れない",
  working: "回っている",
  stop: "やめたほうがいい",
};

export interface PublishedListing {
  id: string;
  /** どの仕事の出品か（worktypes の id） */
  workTypeId: string;
  title: string;
  /** 出品先（coconala など） */
  platformId: string;
  url: string;
  publishedAt: string;
  /** 標準プランの価格 */
  priceJpy: number;
  /** 閲覧数 */
  views: number;
  /** 問い合わせ数 */
  inquiries: number;
  /** 受注数 */
  orders: number;
  /** 最後に数字を更新した日 */
  lastCheckedAt: string;
  status: ListingStatus;
  createdAt: string;
}

export interface ListingReview {
  listingId: string;
  title: string;
  ageDays: number;
  verdict: ListingVerdict;
  reason: string;
  /** 次に試すこと。1つに絞る（同時に変えると何が効いたか分からない） */
  nextAction: string;
}

/** 出品型が立ち上がるまでの目安。これより前に切り捨てない。 */
const MIN_DAYS_BEFORE_JUDGING = 30;
/** 「見られている」と言える閲覧数 */
const VIEWS_THRESHOLD = 50;
/** 見られているのに問い合わせが来ない、と言える転換率 */
const INQUIRY_RATE_FLOOR = 0.02;

export function daysBetween(from: string, to: string): number | null {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * 出品1件の状態を判定する。
 *
 * 大事なのは「売れない」を一括りにしないこと。
 * 見られていないのか、見られているのに刺さらないのかで、直すところが違う。
 * 前者はタイトルとカテゴリ、後者は本文と価格。
 */
export function reviewListing(listing: PublishedListing, today: string): ListingReview {
  const ageDays = daysBetween(listing.publishedAt, today);
  const base = { listingId: listing.id, title: listing.title, ageDays: ageDays ?? 0 };

  if (listing.status === "approved") {
    return {
      ...base,
      verdict: "too_early",
      reason: "内容は承認済みですが、まだ出品されていません。経過日数の判断はここから始まりません。",
      nextAction: "出品先に自分で出品し、このページで状態を「出品中」に変えてください（その日を出品日として記録します）。",
    };
  }

  if (ageDays === null) {
    return {
      ...base,
      verdict: "too_early",
      reason: "出品日が記録されていないので、経過を判断できません。",
      nextAction: "出品日を記録してください。",
    };
  }

  if (listing.orders > 0) {
    return {
      ...base,
      verdict: "working",
      reason: `${ageDays}日で ${listing.orders}件 受注しています。`,
      nextAction:
        "実際にかかった時間を記録してください。想定より時間がかかっていれば、次から価格を上げるか工程を削ります。",
    };
  }

  if (ageDays < MIN_DAYS_BEFORE_JUDGING) {
    return {
      ...base,
      verdict: "too_early",
      reason: `出品から${ageDays}日。出品型は初速が出ないので、${MIN_DAYS_BEFORE_JUDGING}日は待ちます。ここで手を入れると、何が効いたのか分からなくなります。`,
      nextAction: "触らずに待ってください。その間は別の出品を増やすほうが効きます。",
    };
  }

  if (listing.views < VIEWS_THRESHOLD) {
    return {
      ...base,
      verdict: "invisible",
      reason: `${ageDays}日で閲覧 ${listing.views}回。そもそも見られていません。中身ではなく、見つけてもらえていない状態です。`,
      nextAction:
        "タイトルとカテゴリを見直してください。買う人が実際に検索する言葉が入っていますか（「SDS作成」ではなく「安全データシート 作成 代行」など）。1回に1か所だけ変えて、また30日見てください。",
    };
  }

  const inquiryRate = listing.views > 0 ? listing.inquiries / listing.views : 0;

  if (listing.inquiries === 0 || inquiryRate < INQUIRY_RATE_FLOOR) {
    return {
      ...base,
      verdict: "no_conversion",
      reason: `${ageDays}日で閲覧 ${listing.views}回・問い合わせ ${listing.inquiries}件（${(inquiryRate * 100).toFixed(1)}%）。見られてはいるので、見つけてもらう部分は効いています。読んだ人が問い合わせない状態です。`,
      nextAction:
        "価格か、冒頭3行か、「含まないもの」の書き方のどれか1つだけを変えてください。同時に変えると何が効いたか分かりません。まず「お試し1件」の価格を下げるのが一番効きます。",
    };
  }

  if (ageDays >= 120 && listing.orders === 0) {
    return {
      ...base,
      verdict: "stop",
      reason: `${ageDays}日で問い合わせ ${listing.inquiries}件あるのに受注ゼロです。問い合わせの段階で断られています。`,
      nextAction:
        "問い合わせのやりとりを見直してください。返信が遅い、条件を厳しく出しすぎている、見積もりが高い、のどれかです。それでも変わらなければ、この仕事は需要と価格が噛み合っていないので出品を下げてください。",
    };
  }

  return {
    ...base,
    verdict: "no_conversion",
    reason: `${ageDays}日で問い合わせ ${listing.inquiries}件、受注ゼロ。あと少しのところです。`,
    nextAction: "問い合わせへの返信を早くしてください。初回返信の速さが受注率に直結します。",
  };
}

/** 全体を見て、次にやることを1つだけ返す。 */
export function summarizeListings(reviews: ListingReview[]): string {
  if (reviews.length === 0) {
    return "まだ何も出品していません。出品案は承認キューにあります。出すまでは1円にもなりません。";
  }

  const working = reviews.filter((r) => r.verdict === "working");
  const tooEarly = reviews.filter((r) => r.verdict === "too_early");
  const invisible = reviews.filter((r) => r.verdict === "invisible");
  const noConv = reviews.filter((r) => r.verdict === "no_conversion");
  const stop = reviews.filter((r) => r.verdict === "stop");

  if (working.length > 0) {
    return `${working.length}件が回っています。実際にかかった時間を記録してください。見積もりが合っているかを確かめないと、忙しいだけで残らない状態になります。`;
  }

  if (tooEarly.length === reviews.length) {
    return `${reviews.length}件とも、まだ様子見の期間です（${MIN_DAYS_BEFORE_JUDGING}日）。いま出品文をいじらないでください。手が空いているなら、出品の種類を増やすほうが効きます。`;
  }

  if (invisible.length > 0) {
    return `${invisible.length}件が「見られていない」状態です。中身ではなくタイトルとカテゴリの問題なので、そこだけ直してください。`;
  }

  if (noConv.length > 0) {
    return `${noConv.length}件が「見られているが売れない」状態です。価格か冒頭3行のどちらか一方だけを変えて、また30日見てください。`;
  }

  return `${stop.length}件は畳んだほうがいいです。時間を他に回してください。`;
}
