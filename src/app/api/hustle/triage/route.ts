import { NextRequest, NextResponse } from "next/server";
import { scoreScam } from "@/lib/hustle/scam-rules";
import { generateJson, hasApiKey, describeAiError } from "@/lib/hustle/ai";
import { DEFAULT_MIN_WAGE_JPY } from "@/lib/hustle/analytics";
import { PLATFORM_FEES, computePayout } from "@/lib/hustle/payout";
import { readJsonObject } from "@/lib/hustle/http";

interface AiTriage {
  summary?: string;
  estimatedHours?: { low: number; high: number };
  /** 募集側が提示している報酬（円）。読み取れなければ null */
  offeredJpy?: number | null;
  fairRangeJpy?: { low: number; high: number };
  scopeRisks?: string[];
  missingTerms?: string[];
  fitNotes?: string;
  questions?: string[];
}

const PROMPT = (jobText: string, background: string) => `あなたは日本のクラウドソーシング/受託で長く食べているフリーランスです。
以下の案件を、受けるべきかどうかの観点で分析してください。楽観的に見積もらないでください。
初心者は必ず作業時間を過小評価します。実際にかかる時間で答えてください。

分析すること:
- この案件を完遂するのに実際にかかる時間（コミュニケーション、修正対応、検収待ちの手戻りを含む）
- 募集文から読み取れる提示報酬（円）。書かれていなければ null
- この作業量に対して妥当な報酬レンジ（日本の相場、2026年時点）
- 範囲が曖昧で、あとから作業が膨らむ箇所（具体的に、募集文の記述を引用して）
- 契約条件として書かれていない、着手前に必ず詰めるべき項目
- 依頼者の経歴でこの案件に対応できるか。足りない部分があれば正直に
- そのまま送れる確認質問（5問以内）

次のJSONで返してください:
{
  "summary": "受けるべきかの結論を2文で。断定的に。",
  "estimatedHours": { "low": 数値, "high": 数値 },
  "offeredJpy": 数値 または null,
  "fairRangeJpy": { "low": 数値, "high": 数値 },
  "scopeRisks": ["膨らむ箇所を具体的に"],
  "missingTerms": ["着手前に詰めるべき項目"],
  "fitNotes": "経歴との適合。足りない部分も書く。",
  "questions": ["そのまま送れる質問文"]
}

=== 案件 ===
${jobText.slice(0, 6000)}

=== 依頼を受ける人の経歴 ===
${background.slice(0, 2000) || "（未入力）"}`;

export async function POST(request: NextRequest) {
  try {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const jobText = typeof parsed.data.jobText === "string" ? parsed.data.jobText.slice(0, 20000) : "";
    const background = typeof parsed.data.background === "string" ? parsed.data.background.slice(0, 5000) : "";
    const platformId = typeof parsed.data.platformId === "string" ? parsed.data.platformId : "crowdworks";

    if (jobText.trim().length < 20) {
      return NextResponse.json({ error: "案件の本文を20文字以上入力してください" }, { status: 400 });
    }

    // 詐欺判定は AI に依存させない。ここは必ず動く。
    const scam = scoreScam(jobText);

    let ai: AiTriage | null = null;
    let aiError: string | null = null;

    if (hasApiKey()) {
      try {
        ai = await generateJson<AiTriage>(PROMPT(jobText, background), {
          temperature: 0.3,
          maxOutputTokens: 4096,
        });
      } catch (error) {
        aiError = describeAiError(error).message;
      }
    }

    // 実効時給の見積もり。
    // 提示額をそのまま時間で割ると、同じアプリが手取り計算で引いている
    // システム手数料と振込手数料を無視することになり、2〜3割高く出てしまう。
    // ここは必ず手数料を引いた後の額で判定する。
    const platform =
      PLATFORM_FEES.find((f) => f.id === platformId) ??
      PLATFORM_FEES.find((f) => f.id === "crowdworks")!;

    let hourly: { low: number; high: number } | null = null;
    let grossHourly: { low: number; high: number } | null = null;
    let netJpy: number | null = null;
    let rateVerdict: "unknown" | "below_minimum" | "thin" | "acceptable" = "unknown";

    const offered = Number.isFinite(ai?.offeredJpy) ? (ai!.offeredJpy as number) : null;
    const lowHours = Number(ai?.estimatedHours?.low);
    const highHours = Number(ai?.estimatedHours?.high);
    const hoursValid = Number.isFinite(lowHours) && Number.isFinite(highHours) && highHours > 0 && lowHours > 0;

    if (offered !== null && offered > 0 && hoursValid) {
      const payout = computePayout(offered, platform, highHours);
      netJpy = payout.netJpy;
      hourly = {
        low: Math.round(netJpy / highHours),
        high: Math.round(netJpy / Math.max(0.5, lowHours)),
      };
      grossHourly = {
        low: Math.round(offered / highHours),
        high: Math.round(offered / Math.max(0.5, lowHours)),
      };
      if (hourly.high < DEFAULT_MIN_WAGE_JPY) rateVerdict = "below_minimum";
      else if (hourly.low < DEFAULT_MIN_WAGE_JPY) rateVerdict = "thin";
      else rateVerdict = "acceptable";
    }

    // 総合判定: 詐欺スコアが最優先。次に単価。
    // 単価を検証できていない状態を「問題なし」と読ませてはいけないので、
    // rateVerdict が unknown のときは proceed に落とさない。
    let recommendation: "reject" | "verify_first" | "proceed";
    let recommendationReason: string;

    if (scam.verdict === "danger") {
      recommendation = "reject";
      recommendationReason = "詐欺・搾取のシグナルが強く出ています。提案文を書く段階ではありません。";
    } else if (rateVerdict === "below_minimum") {
      recommendation = "reject";
      recommendationReason = `手数料を引いた実効時給が ${hourly?.low.toLocaleString()}〜${hourly?.high.toLocaleString()}円で、最低賃金（${DEFAULT_MIN_WAGE_JPY.toLocaleString()}円）を下回ります。受けるほど時間を失います。単価交渉が通らなければ見送りです。`;
    } else if (rateVerdict === "unknown") {
      recommendation = "verify_first";
      recommendationReason = hasApiKey()
        ? "募集文から報酬額または作業量を読み取れなかったため、単価の妥当性を判定できていません。詐欺シグナルが出ていないことは「割に合う」という意味ではありません。「収支と実効時給」の手取り計算に、報酬額と自分の想定時間を入れて確認してください。"
        : "APIキーが未設定のため、単価の妥当性は判定していません（詐欺判定のみ実行しました）。「収支と実効時給」の手取り計算に、報酬額と自分の想定時間を入れてから応募を決めてください。";
    } else if (scam.verdict === "caution" || rateVerdict === "thin" || (ai?.missingTerms?.length ?? 0) > 0) {
      recommendation = "verify_first";
      recommendationReason =
        "条件を詰めれば受けられます。下の確認質問を先に送り、回答が返ってから着手してください。";
    } else {
      recommendation = "proceed";
      recommendationReason = `手数料を引いた実効時給は ${hourly?.low.toLocaleString()}〜${hourly?.high.toLocaleString()}円 の見込みで、既知の危険シグナルにも該当しませんでした。ここで検査できたのは「詐欺の典型手口」と「単価の妥当性」だけです。発注者が信用できるかどうかは別問題なので、着手前に報酬額・納期・修正回数・支払日を文面で確定させてください。`;
    }

    return NextResponse.json({
      scam,
      ai,
      aiError,
      hourly,
      grossHourly,
      netJpy,
      platform: { id: platform.id, name: platform.name, feeRate: platform.feeRate },
      rateVerdict,
      recommendation,
      recommendationReason,
      minWage: DEFAULT_MIN_WAGE_JPY,
      aiUsed: Boolean(ai),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "分析に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
