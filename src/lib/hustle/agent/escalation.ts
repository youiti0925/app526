import { readProfile } from "../db";
import { PLATFORM_FEES } from "../payout";
import { DEFAULT_MIN_WAGE_JPY } from "../analytics";
import { readAgentConfig, readLeads, readLeadsByIds, updateLead, pushInbox, logEvent } from "./db";
import type { Lead } from "./types";
import { reconcileVerdict } from "./reconcile";
import { trackRecordException } from "./track-record";

/**
 * ルールでも無料枠のAIでも判定しきれなかった案件を、能力の高いモデルに回す層。
 *
 * 設計の考え方:
 * 正規表現のパターンを増やして未知の案件に対応しようとすると、必ず取りこぼす。
 * 実際、市場調査で見つかった有望な案件（SDS作成、化学物質リスクアセスメント、
 * ISO文書整備）はどれも既存のパターンに当たらず、判定不能で止まっていた。
 * ルールを増やす代わりに「分からないものは分からないと言って外に出す」形にする。
 */

export type EscalationReason =
  | "no_work_estimate" // 作業量が読み取れない
  | "no_budget" // 報酬額が読み取れない
  | "ambiguous_scam" // 詐欺判定が灰色
  | "domain_unknown" // ルールが想定していない分野
  | "manual"; // 人が明示的に回した

export const REASON_LABELS: Record<EscalationReason, string> = {
  no_work_estimate: "作業量を読み取れない",
  no_budget: "報酬額を読み取れない",
  ambiguous_scam: "詐欺判定が灰色",
  domain_unknown: "ルールが想定していない分野",
  manual: "手動で回した",
};

/** 上位モデルに投げるための、案件1件ぶんの説明。 */
export interface EscalationItem {
  leadId: string;
  title: string;
  url: string;
  reasons: EscalationReason[];
  rawText: string;
  /** 下位のエンジンがどこまで分かったか。二度手間を避けるために渡す。 */
  partial: {
    budgetJpy: number | null;
    scamScore: number;
    scamVerdict: string;
    scamSignals: string[];
    scopeRisks: string[];
  };
}

/** 判定して返してもらう形。 */
export interface EscalationVerdict {
  leadId: string;
  /** 実際にかかる時間。やりとり・修正・検収待ちを含めた値。 */
  estimatedHours: { low: number; high: number };
  /** 見積もりの根拠。人が読んで納得できる説明。 */
  basis: string;
  /** 読み取れた報酬額。読めなければ null。 */
  offeredJpy: number | null;
  /** 受けるべきか */
  verdict: "reject" | "verify_first" | "proceed";
  reason: string;
  /** 着手前に詰めるべき点 */
  risks: string[];
  /** そのまま承認キューに出せる提案文。不要なら空。 */
  proposal: string;
  /** 判定の確信度 */
  confidence: "high" | "medium" | "low";
}

/** エスカレーションが必要かを判定する。 */
export function needsEscalation(triage: Record<string, unknown>): EscalationReason[] {
  const reasons: EscalationReason[] = [];
  const estimate = triage.estimate as { lowHours?: number } | null | undefined;
  const hourly = triage.hourly as unknown;
  const scamScore = Number(triage.scamScore ?? 0);

  if (!estimate) reasons.push("no_work_estimate");
  if (!hourly) reasons.push("no_budget");
  // 25〜60 は safe とも danger とも言い切れない帯。ここが一番危ない。
  if (scamScore >= 25 && scamScore < 60) reasons.push("ambiguous_scam");

  return reasons;
}

/** 上位モデルに回す案件を集める。 */
export function collectEscalations(limit = 10, ids?: string[]): EscalationItem[] {
  // id が指定されたときは、その案件を直接引く。上位100件(点数順)に入っていない案件が、判定に回らず取り残されないように
  const leads = ids ? [...readLeadsByIds(ids).values()].filter((l) => l.status === "triaged") : readLeads("triaged", 100);
  return leads
    .filter((lead) => {
      const t = lead.triage as Record<string, unknown>;
      return Array.isArray(t.escalationReasons) && (t.escalationReasons as unknown[]).length > 0;
    })
    .slice(0, limit)
    .map((lead) => {
      const t = lead.triage as Record<string, unknown>;
      return {
        leadId: lead.id,
        title: lead.title,
        url: lead.url,
        reasons: (t.escalationReasons as EscalationReason[]) ?? [],
        rawText: lead.rawText,
        partial: {
          budgetJpy: lead.budgetJpy,
          scamScore: Number(t.scamScore ?? 0),
          scamVerdict: String(t.scamVerdict ?? "unknown"),
          scamSignals: ((t.scamSignals as { label: string }[]) ?? []).map((s) => s.label),
          scopeRisks: (t.risks as string[]) ?? [],
        },
      };
    });
}

/**
 * 上位モデルに渡す指示書をまるごと組み立てる。
 * 相手はこのアプリの中身を知らない前提で、必要な文脈を全部入れる。
 */
export function buildBrief(items: EscalationItem[]): string {
  const profile = readProfile();
  const config = readAgentConfig();
  const platform = PLATFORM_FEES.find((f) => f.id === "crowdworks")!;

  const header = `# 案件の判定依頼

あなたは日本の受託市場に詳しい実務者です。下位の判定エンジン（正規表現とルール）で
判定しきれなかった案件が ${items.length} 件あります。1件ずつ判定してください。

## 判定する人の情報

- 経歴: ${profile?.background || "（未入力）"}
- 使える時間: 週 ${profile?.weeklyHours ?? 10} 時間
- 目標: 月 ${(profile?.goalJpy ?? 0).toLocaleString()} 円
- 元手: ${(profile?.budgetJpy ?? 0).toLocaleString()} 円
- 実績: ほぼゼロからの立ち上げ

## 判定の基準

1. **作業時間**は、やりとり・修正対応・検収待ちの手戻りを必ず含めた値にしてください。
   初心者は必ず過小評価します。生成そのものが速くても、AI併用時は確認工程がむしろ
   増えることが実測で分かっています（出力が流暢なぶん、一次情報に当て直さないと
   誤りが浮かないため）。そこを計上してください。

2. **実効時給**は手数料控除後で見ます。${platform.name} の場合、
   システム手数料 ${Math.round(platform.feeRate * 100)}% と振込手数料 ${platform.withdrawalFeeJpy}円 が引かれます。
   手数料を引いた実効時給が ${config.learned.minHourlyJpy.toLocaleString()}円（現在の基準。最低賃金は ${DEFAULT_MIN_WAGE_JPY.toLocaleString()}円）を
   下回るなら verdict は "reject" にしてください。

3. **資格の壁**を必ず見てください。税理士・行政書士・司法書士・社会保険労務士・
   宅地建物取引士・弁護士の業務独占にあたる作業、または「【○○限定】」のような
   属性限定の募集は、応募しても取れないので "reject" にしてください。

4. **低単価の罠**に注意してください。「1件50円 × 100件」のような書き方は、
   総額が大きく見えても実効時給が出ません。1件あたりに割り戻して判断してください。

5. **提案文**は、verdict が reject 以外のときだけ書いてください。
   - 400〜600文字。長文は読まれません。
   - 冒頭2行で、この募集を読んだ上で書いていることが伝わること。
   - 事実として確認できないこと（実績数値、資格、経歴）を創作しないこと。
     埋めるべき箇所は 【要確認: 何を書くか】 の形で残してください。
   - 誇張・成果保証を書かないこと。
   - **AIで速くできることを売りにしないでください。** 実測で、AIで代替しやすい作業ほど
     応募者が殺到して単価が壊れています。売るべきは、AIで代替されない部分
     （現場ヒアリングの設計、専門分野の判断、安全上の妥当性確認、最終確認の手順）です。

${
  config.learned.avoidNotes.length
    ? `6. 過去に却下された理由: ${config.learned.avoidNotes.join(" / ")}。同じことを繰り返さないでください。\n`
    : ""
}${
    config.learned.preferredAngles.length
      ? `7. 過去に通った切り口: ${config.learned.preferredAngles.join(" / ")}。これを優先してください。\n`
      : ""
  }
## 出力

次の形の JSON **だけ** を返してください。前後に説明を書かないでください。

\`\`\`json
{
  "verdicts": [
    {
      "leadId": "案件のID（下の各案件に書いてあるものをそのまま）",
      "estimatedHours": { "low": 数値, "high": 数値 },
      "basis": "その時間になる根拠。作業量の内訳を具体的に。",
      "offeredJpy": 数値 または null,
      "verdict": "reject" | "verify_first" | "proceed",
      "reason": "その判定にした理由。1〜2文。",
      "risks": ["着手前に詰めるべき点"],
      "proposal": "提案文の本文。reject のときは空文字。",
      "confidence": "high" | "medium" | "low"
    }
  ]
}
\`\`\`

---

`;

  const body = items
    .map(
      (item, i) => `## 案件 ${i + 1}

- leadId: \`${item.leadId}\`
- 判定できなかった理由: ${item.reasons.map((r) => REASON_LABELS[r]).join(" / ")}
- 下位エンジンが読み取った報酬額: ${item.partial.budgetJpy ? `${item.partial.budgetJpy.toLocaleString()}円` : "読み取れず"}
- 下位エンジンの詐欺スコア: ${item.partial.scamScore}/100（${item.partial.scamVerdict}）${
        item.partial.scamSignals.length ? `\n- 検出済みの危険シグナル: ${item.partial.scamSignals.join(" / ")}` : ""
      }${item.partial.scopeRisks.length ? `\n- 検出済みの地雷: ${item.partial.scopeRisks.join(" / ")}` : ""}

### 募集文

\`\`\`
${item.rawText.slice(0, 6000)}
\`\`\`
`
    )
    .join("\n---\n\n");

  return header + body;
}

export interface ApplyResult {
  applied: number;
  queued: number;
  skipped: { leadId: string; why: string }[];
}

/** 上位モデルが返した判定を、案件と承認キューに書き戻す。 */
export function applyVerdicts(verdicts: EscalationVerdict[], runId = "escalation"): ApplyResult {
  const platform = PLATFORM_FEES.find((f) => f.id === "crowdworks")!;
  const config = readAgentConfig();
  const result: ApplyResult = { applied: 0, queued: 0, skipped: [] };

  const known = readLeadsByIds(verdicts.map((v) => v.leadId));

  for (const v of verdicts) {
    const lead = known.get(v.leadId);
    if (!lead) {
      result.skipped.push({ leadId: v.leadId, why: "その案件が見つかりません" });
      continue;
    }

    const low = Number(v.estimatedHours?.low);
    const high = Number(v.estimatedHours?.high);
    if (!Number.isFinite(low) || !Number.isFinite(high) || high <= 0) {
      // 見送りは作業時間が無くても決められる（資格の壁・詐欺・経験の要る仕事など）。
      // 時間が数値でないことを理由に捨てると、見送りの結論だけが落ちて、判定が宙に浮く
      if (v.verdict === "reject") {
        const rejectReason = (v.reason ?? "").trim() || "上位の判定で見送り";
        updateLead(lead.id, {
          status: "rejected",
          verdict: "reject",
          triage: {
            ...(lead.triage as Record<string, unknown>),
            escalationReasons: [],
            escalatedAt: new Date().toISOString(),
            estimatedBy: "escalated",
            risks: v.risks ?? [],
            reason: rejectReason,
          },
        });
        result.applied++;
        logEvent(runId, "triage", "decision", `[上位判定] 「${lead.title.slice(0, 40)}」→ reject: ${rejectReason.slice(0, 100)}`, {
          leadId: lead.id,
          confidence: v.confidence,
        });
        continue;
      }
      result.skipped.push({ leadId: v.leadId, why: "作業時間が数値になっていません" });
      continue;
    }

    const offered = Number.isFinite(v.offeredJpy) ? (v.offeredJpy as number) : lead.budgetJpy;

    // Claude が見積もるのは仕事全体の作業量。時給は「あなたが手を動かす時間」で割る
    // （仕事ラインで自動化できる分は、あなたの時間に入らない）。ルールの判定で出した倍速を使う。
    const prevTriage = (lead.triage ?? {}) as Record<string, unknown>;
    const yt = prevTriage.yourTime as { certain?: boolean; speedup?: number } | undefined;
    // 型の試作で確かめていない（certain=false）ときも、ルールの見込みの倍速を使い、理由にそう書く
    const speedup = Number(yt?.speedup) > 1 ? Number(yt?.speedup) : 1;
    const r1 = (h: number) => Math.max(0.1, Math.round((h / speedup) * 10) / 10);
    const yourLow = r1(low);
    const yourHigh = r1(high);

    // 返ってきた結論を鵜呑みにせず、金額と時間から計算し直す。
    // 判定した側の算術ミスを、そのまま「受けてよい」に変えないため。
    let { verdict, reason, hourly, score, overridden } = reconcileVerdict({
      verdict: v.verdict,
      reason: v.reason ?? "",
      offeredJpy: offered,
      lowHours: yourLow,
      highHours: yourHigh,
      riskCount: v.risks?.length ?? 0,
      minHourlyJpy: config.learned.minHourlyJpy,
      platform,
    });
    if (speedup > 1) {
      reason += `（仕事全体 ${low}〜${high}時間のうち、自動化した後にあなたが手を動かすのは ${yourLow}〜${yourHigh}時間 として計算${yt?.certain ? "" : "。この型の自動化はまだ試していない見込み"}）`;
    }

    // Claude が値段（時給）を理由に見送ったときは、自動化した後のあなたの時間で割った時給で決め直す。
    // 評価が少ないうちは、短い仕事を「実績づくり」として通す（track-record.ts）。
    const min = config.learned.minHourlyJpy;
    const priceReason = /時給|基準|単価|報酬|手取り|安/.test(v.reason ?? "");
    if (verdict === "reject" && priceReason && hourly && prevTriage.scamVerdict !== "danger") {
      const noRisks = (v.risks?.length ?? 0) === 0;
      const tr = trackRecordException({ hourly, yourHighHours: yourHigh, wonCount: readLeads("won", 100).length });
      const yours = `自動化した後のあなたの時間（${yourLow}〜${yourHigh}時間）で割ると、手取り時給は ${hourly.low.toLocaleString()}〜${hourly.high.toLocaleString()}円`;
      if (hourly.low >= min && noRisks) {
        verdict = "proceed";
        reason = `${yours}で、基準の ${min.toLocaleString()}円 を超えます${yt?.certain ? "" : "（この型の自動化はまだ試していない見込み）"}`;
        overridden = true;
      } else if (tr.applies && noRisks) {
        verdict = "proceed";
        reason = tr.reason;
        overridden = true;
      } else if (hourly.high >= min || tr.applies) {
        verdict = "verify_first";
        reason = `${yours}。条件次第で受けられます${noRisks ? "" : "。送る前に確認事項を詰めてください"}`;
        overridden = true;
      }
    }

    if (overridden) {
      logEvent(runId, "triage", "warn", `[検算] 「${lead.title.slice(0, 36)}」の判定を上書きしました: ${reason.slice(0, 120)}`, {
        leadId: lead.id,
        original: v.verdict,
        corrected: verdict,
      });
    }

    updateLead(lead.id, {
      // 上位の判定が見送りで提案文を付けず、検算で応募できる側に直した案件は、提案文がまだ無い。
      // 「triaged」に戻して、下書きの工程が提案文を作れるようにする
      status: verdict === "reject" ? "rejected" : v.proposal?.trim() ? "drafted" : "triaged",
      score,
      verdict,
      budgetJpy: offered,
      triage: {
        ...(lead.triage as Record<string, unknown>),
        escalationReasons: [],
        escalatedAt: new Date().toISOString(),
        estimate: { lowHours: low, highHours: high, basis: v.basis ?? "", confidence: v.confidence ?? "medium" },
        yourTime: { ...(yt ?? {}), lowHours: yourLow, highHours: yourHigh },
        estimatedBy: "escalated",
        hourly,
        risks: v.risks ?? [],
        reason,
      },
    });
    result.applied++;

    logEvent(runId, "triage", "decision", `[上位判定] 「${lead.title.slice(0, 40)}」→ ${verdict}: ${reason.slice(0, 100)}`, {
      leadId: lead.id,
      hourly,
      confidence: v.confidence,
    });

    if (verdict !== "reject" && v.proposal?.trim()) {
      const header = [
        `【この案件の判定】${reason}`,
        hourly
          ? `【実効時給の見込み】${hourly.low.toLocaleString()}〜${hourly.high.toLocaleString()}円（手数料控除後）`
          : "【実効時給】報酬額が確定していません。送る前に必ず確認してください。",
        `【想定作業時間】${low}〜${high}時間 — ${v.basis ?? ""}`,
        `【判定の確信度】${v.confidence ?? "medium"}`,
        (v.risks?.length ?? 0) > 0 ? `\n【送る前に詰めること】\n${v.risks.map((r) => `・${r}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      pushInbox({
        runId,
        kind: "proposal",
        priority: Math.min(92, 45 + score / 2),
        title: lead.title.slice(0, 80) || "提案文",
        body: `${header}\n\n---\n\n${v.proposal.trim()}`,
        actionUrl: lead.url,
        leadId: lead.id,
        meta: { usedAi: true, escalated: true, confidence: v.confidence, score },
      });
      result.queued++;
    }
  }

  return result;
}
