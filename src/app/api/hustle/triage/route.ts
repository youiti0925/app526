import { NextRequest, NextResponse } from "next/server";
import { scoreScam } from "@/lib/hustle/scam-rules";
import { generateJson, hasApiKey, describeAiError } from "@/lib/hustle/ai";
import { DEFAULT_MIN_WAGE_JPY } from "@/lib/hustle/analytics";

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
    const { jobText, background = "" } = await request.json();

    if (typeof jobText !== "string" || jobText.trim().length < 20) {
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

    // 実効時給の見積もり。ここが最低賃金を割るなら、受けても消耗するだけ。
    let hourly: { low: number; high: number } | null = null;
    let rateVerdict: "unknown" | "below_minimum" | "thin" | "acceptable" = "unknown";

    const offered = ai?.offeredJpy ?? null;
    const hours = ai?.estimatedHours;
    if (offered && hours && hours.high > 0) {
      hourly = {
        low: Math.round(offered / hours.high),
        high: Math.round(offered / Math.max(0.5, hours.low)),
      };
      if (hourly.high < DEFAULT_MIN_WAGE_JPY) rateVerdict = "below_minimum";
      else if (hourly.low < DEFAULT_MIN_WAGE_JPY) rateVerdict = "thin";
      else rateVerdict = "acceptable";
    }

    // 総合判定: 詐欺スコアが最優先。次に単価。
    let recommendation: "reject" | "verify_first" | "proceed";
    let recommendationReason: string;

    if (scam.verdict === "danger") {
      recommendation = "reject";
      recommendationReason = "詐欺・搾取のシグナルが強く出ています。提案文を書く段階ではありません。";
    } else if (rateVerdict === "below_minimum") {
      recommendation = "reject";
      recommendationReason = `想定作業時間から計算した実効時給が ${hourly?.low.toLocaleString()}〜${hourly?.high.toLocaleString()}円で、最低賃金（${DEFAULT_MIN_WAGE_JPY.toLocaleString()}円）を下回ります。受けるほど時間を失います。単価交渉が通らなければ見送りです。`;
    } else if (scam.verdict === "caution" || rateVerdict === "thin" || (ai?.missingTerms?.length ?? 0) > 0) {
      recommendation = "verify_first";
      recommendationReason =
        "条件を詰めれば受けられます。下の確認質問を先に送り、回答が返ってから着手してください。";
    } else {
      recommendation = "proceed";
      recommendationReason = "大きな地雷は見当たりません。提案文を作って応募してください。";
    }

    return NextResponse.json({
      scam,
      ai,
      aiError,
      hourly,
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
