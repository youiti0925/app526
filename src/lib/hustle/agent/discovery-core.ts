import { PLATFORM_FEES } from "../payout";

/**
 * 探索層のうち、DBにもネットワークにも触らない部分。
 * ここだけ切り出してあるのは、実効時給の検算をテストから直接叩けるようにするため。
 */

/** 仕事の取り方の形。形が違えば、動き方も待ち時間も違う。 */
export type DiscoveryChannel =
  | "apply" // 公開されている募集に応募する
  | "listing" // 出品して待つ（ココナラ等）
  | "direct" // 直接営業する（企業・業界団体）
  | "stock"; // 作って置いておく（在庫型。時間と収入が切り離せる）

export const CHANNEL_LABELS: Record<DiscoveryChannel, string> = {
  apply: "応募型（募集に応募する）",
  listing: "出品型（出品して待つ）",
  direct: "直接営業型（自分から当たる）",
  stock: "在庫型（作って置いておく）",
};

export const CHANNEL_NOTES: Record<DiscoveryChannel, string> = {
  apply: "すぐ動けるが、応募者が多いほど単価が壊れる。",
  listing: "初速は出ないが、通れば指名で回り始める。",
  direct: "競合がいない代わりに、断られるのが前提。数を当たる必要がある。",
  stock: "収入が作業時間から切り離せる唯一の形。ただし当たるまで無収入。",
};

/** 上位モデルに返してもらう、市場1件ぶん。 */
export interface DiscoveryFinding {
  /** 重複を防ぐための識別子。URLか、なければ市場名。 */
  key: string;
  channel: DiscoveryChannel;
  /** 何の仕事か。1行。 */
  title: string;
  /** 根拠として実際に見たページ。無ければ空。 */
  url: string;
  /** 何を見てそう言えるのか。「一次情報を見た」ことが分かる書き方で。 */
  evidence: string;
  /** 需要がある根拠（制度変更、募集件数、問い合わせの多さなど） */
  demandSignal: string;
  /** 供給（競合）がどれだけいるか */
  supplySignal: string;
  /** 相場。1件あたりに割り戻した金額。 */
  priceJpy: { low: number; high: number };
  /** 上の金額が何に対する額か（「1物質あたり」「1式」「月額」など） */
  priceUnit: string;
  /** その1件にかかる時間。やりとり・修正・検収待ち込み。 */
  estimatedHours: { low: number; high: number };
  /** どの手数料体系で計算するか。PLATFORM_FEES の id か "direct"。 */
  platformId: string;
  /** AIで丸ごと置き換えられない理由。ここが弱い市場は単価が壊れる。 */
  whyAiCannotKill: string;
  /** 資格・許認可の壁。なければ "なし"。 */
  qualificationBarrier: string;
  /** 立ち上がりまでの目安 */
  timeToFirstYen: string;
  /** 明日やる1手 */
  firstStep: string;
  confidence: "high" | "medium" | "low";
}

/** 検算した後の、保存する形。 */
export interface Discovery extends DiscoveryFinding {
  id: string;
  runId: string;
  /** 手数料を引いた実効時給。計算できなければ null。 */
  hourlyJpy: { low: number; high: number } | null;
  /** 基準時給を満たすか */
  meetsBar: boolean;
  /** こちらの検算で結論を書き換えたときの説明 */
  note: string;
  status: "new" | "trying" | "parked" | "dropped";
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 検算
// ---------------------------------------------------------------------------

/**
 * 返ってきた相場と工数から、手数料控除後の実効時給を出し直す。
 *
 * 上位モデルが「この市場は割がいい」と書いていても、その算術を信用しない。
 * 判定できる数字については、返答ではなくこちらの計算を正とする。
 */
export function reconcileDiscovery(
  finding: DiscoveryFinding,
  minHourlyJpy: number
): { hourlyJpy: { low: number; high: number } | null; meetsBar: boolean; note: string } {
  const platform = PLATFORM_FEES.find((p) => p.id === finding.platformId);
  // 知らないプラットフォーム名が返ってきたときに手数料0%で計算すると、
  // 実効時給が最大で2割強も高く出て、基準を満たさない市場が
  // 「満たす」に化ける。知らないときは一番高い手数料で見積もる。
  const worst = PLATFORM_FEES.reduce((a, b) => (b.feeRate > a.feeRate ? b : a));
  const feeRate = platform ? platform.feeRate : worst.feeRate;
  const withdrawalFeeJpy = platform ? platform.withdrawalFeeJpy : worst.withdrawalFeeJpy;
  const unknownPlatform = !platform;

  const { low: priceLow, high: priceHigh } = finding.priceJpy ?? { low: 0, high: 0 };
  const { low: hoursLow, high: hoursHigh } = finding.estimatedHours ?? { low: 0, high: 0 };

  const usable =
    Number.isFinite(priceLow) &&
    Number.isFinite(priceHigh) &&
    priceHigh > 0 &&
    Number.isFinite(hoursLow) &&
    Number.isFinite(hoursHigh) &&
    hoursHigh > 0;

  if (!usable) {
    return {
      hourlyJpy: null,
      meetsBar: false,
      note: "相場か工数が数値で返ってこなかったため、実効時給を計算できていません。金額の判断はまだしないでください。",
    };
  }

  const net = (gross: number) => Math.max(0, gross - Math.floor(gross * feeRate) - withdrawalFeeJpy);
  // 悪い側: 安い相場を長い工数で割る。良い側: 高い相場を短い工数で割る。
  const hourly = {
    low: Math.round(net(priceLow) / hoursHigh),
    high: Math.round(net(priceHigh) / Math.max(0.5, hoursLow)),
  };

  const caveat = unknownPlatform
    ? `（「${finding.platformId}」の手数料が分からないので、既知の中で一番高い${Math.round(worst.feeRate * 100)}%で計算しています。実際の手数料を確認してください）`
    : "";

  if (hourly.high < minHourlyJpy) {
    return {
      hourlyJpy: hourly,
      meetsBar: false,
      note: `手数料を引いた実効時給が ${hourly.low.toLocaleString()}〜${hourly.high.toLocaleString()}円で、上限側でも基準の ${minHourlyJpy.toLocaleString()}円 に届きません。この市場は追わないでください。${caveat}`,
    };
  }

  if (hourly.low < minHourlyJpy) {
    return {
      hourlyJpy: hourly,
      meetsBar: true,
      note: `実効時給 ${hourly.low.toLocaleString()}〜${hourly.high.toLocaleString()}円。下限側は基準を割るので、安い側の条件では受けないでください。${caveat}`,
    };
  }

  return {
    hourlyJpy: hourly,
    meetsBar: true,
    note: `実効時給 ${hourly.low.toLocaleString()}〜${hourly.high.toLocaleString()}円。基準を満たします。${caveat}`,
  };
}

/** 返ってきた JSON を、信用せずに型に落とす。 */
export function parseFindings(raw: unknown): DiscoveryFinding[] {
  const list = Array.isArray((raw as { findings?: unknown })?.findings)
    ? ((raw as { findings: unknown[] }).findings as unknown[])
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];

  const out: DiscoveryFinding[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = str(o.title);
    if (!title) continue;

    out.push({
      key: str(o.key) || str(o.url) || title,
      channel: isChannel(o.channel) ? o.channel : "apply",
      title,
      url: /^https?:\/\//.test(str(o.url)) ? str(o.url) : "",
      evidence: str(o.evidence),
      demandSignal: str(o.demandSignal),
      supplySignal: str(o.supplySignal),
      priceJpy: pair(o.priceJpy),
      priceUnit: str(o.priceUnit),
      estimatedHours: pair(o.estimatedHours),
      platformId: str(o.platformId) || "direct",
      whyAiCannotKill: str(o.whyAiCannotKill),
      qualificationBarrier: str(o.qualificationBarrier) || "不明",
      timeToFirstYen: str(o.timeToFirstYen),
      firstStep: str(o.firstStep),
      confidence: o.confidence === "high" || o.confidence === "low" ? o.confidence : "medium",
    });
  }
  return out;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, 2000) : "");

function pair(v: unknown): { low: number; high: number } {
  const o = (v ?? {}) as Record<string, unknown>;
  const low = Number(o.low);
  const high = Number(o.high);
  return {
    low: Number.isFinite(low) ? low : 0,
    high: Number.isFinite(high) ? high : 0,
  };
}

const isChannel = (v: unknown): v is DiscoveryChannel =>
  v === "apply" || v === "listing" || v === "direct" || v === "stock";

