/**
 * モデルの比較試験 — 「安いモデルでも同じ結果が出るなら、そっちに切り替える」。
 *
 * 手順書の手本（数行）だけを、候補のモデルそれぞれで実行して一致率を測る。
 * 本番の依頼データは使わない（試験のために依頼者の資料をあちこちに送らない）。
 * 手本が依頼者の資料から作られたもの（confidential）なら、無料枠の Gemini は候補に入れない。
 */
import { aiStepsOf, type ModelTrial, type Recipe } from "./recipe";
import type { ModelCaller, ModelChoice } from "./models";
import type { PageFetcher } from "./fetcher";
import { runRecipe, withSrc } from "./ops";
import { compareToExpected, MIN_SWITCH_ACCURACY } from "./checks";

export interface Candidate extends ModelChoice {
  label: string;
}

/** 安い順に並べた候補。先頭から試して、基準を満たした最初のものを採用する。 */
export function candidatesFor(
  recipe: Pick<Recipe, "steps" | "testSet">,
  opts: { geminiAvailable: boolean; geminiModel: string; lightModel: string; standardModel: string }
): Candidate[] {
  const out: Candidate[] = [];
  const needsWeb = aiStepsOf(recipe).some((s) => s.op === "ai_lookup");
  if (opts.geminiAvailable && !needsWeb && recipe.testSet?.dataClass === "public") {
    out.push({ provider: "gemini", model: opts.geminiModel, label: `Gemini ${opts.geminiModel}（無料枠）` });
  }
  out.push({ provider: "claude", model: opts.lightModel, label: `Claude ${opts.lightModel}` });
  out.push({ provider: "claude", model: opts.standardModel, label: `Claude ${opts.standardModel}` });
  return out;
}

export interface CompareResult {
  trials: ModelTrial[];
  preferred: ModelChoice | null;
  summary: string;
}

export async function compareModels(
  recipe: Recipe,
  deps: { call: ModelCaller; fetchPage: PageFetcher; now?: () => string },
  candidates: Candidate[]
): Promise<CompareResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const ts = recipe.testSet;
  if (!ts || ts.input.length === 0) {
    return { trials: [], preferred: null, summary: "手本が無いため比較できません（一度承認すると、承認した行が手本になります）" };
  }
  if (aiStepsOf(recipe).length === 0) {
    return { trials: [], preferred: null, summary: "この手順書はAIを使っていないので、比較の必要がありません" };
  }
  const trials: ModelTrial[] = [];
  let preferred: ModelChoice | null = null;
  for (const c of candidates) {
    const out = await runRecipe(recipe, withSrc(ts.input), {
      call: deps.call,
      fetchPage: deps.fetchPage,
      lists: {},
      preferred: { provider: c.provider, model: c.model },
    });
    const cmp = compareToExpected(out.rows, ts.expected, ts.compareColumns.length ? ts.compareColumns : recipe.output.columns);
    trials.push({
      provider: c.provider,
      model: c.model,
      accuracy: cmp.accuracy,
      at: now(),
      note: `${cmp.matched}/${cmp.cells}セル一致（手本は${ts.source === "human" ? "人が承認したもの" : "上位モデルが作ったもの"}）`,
    });
    if (!preferred && cmp.accuracy >= MIN_SWITCH_ACCURACY) {
      preferred = { provider: c.provider, model: c.model };
      break; // 安い順なので、最初に基準を満たしたもので決まり。残りは試さない（使用量の節約）
    }
  }
  const summary = preferred
    ? `${preferred.provider} ${preferred.model} で手本と${Math.round((trials[trials.length - 1]?.accuracy ?? 0) * 100)}%一致したので、以後これを使います`
    : `どの候補も一致率${MIN_SWITCH_ACCURACY * 100}%に届かなかったので、段の既定モデルのままにします`;
  return { trials, preferred, summary };
}
