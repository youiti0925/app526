/**
 * 仕事ライン — 1件の依頼を、承認待ちの納品物にするまで。
 *
 *   ① 依頼が入る（人が依頼文と入力ファイルを渡す。サイトのメッセージは取りに行けない）
 *   ② 振り分け   : 機械の点数 → 迷うときだけ軽いモデル
 *   ③ 手順書     : 無ければ上位モデルが手順書と手本を作り、手本で試験してから採用
 *   ④ 作業       : 手順書どおりに機械＋軽いモデルで全行を処理
 *   ⑤ 検品       : 機械の検品＋別の呼び出しの検品AI
 *   ⑥ やり直し   : 落ちた行だけ1段上のモデルで → それでも駄目なら上位モデルが手順書を改修
 *   ⑦ 承認       : ここだけ人。承認しても送信はしない（納品は人が各サイトで行う）
 *
 * ②〜⑥はアプリとAIだけで回る。DB・AI・ページ取得は外から渡すので、
 * このファイルはテストで偽物を渡して丸ごと検証できる。
 */
import { parseTable, toCsvText } from "../dataops/table";
import { validateRecipe, nextTier, aiStepsOf, type Recipe, type Tier } from "./recipe";
import type { ModelCaller, ModelChoice } from "./models";
import type { PageFetcher } from "./fetcher";
import { runRecipe, withSrc, srcOf, type Row, type RowIssue, type RemovedRow } from "./ops";
import {
  checkOutput, compareToExpected, dedupeIssues, project, summarize,
  MIN_TEST_ACCURACY, MAX_ERROR_ROW_RATE, type QualitySummary, type TestComparison,
} from "./checks";
import { scoreRecipes, decideByRule, buildRoutePrompt, parseRouteResponse, ROUTE_SCHEMA, type RouteDecision } from "./router";
import { buildAuthorPrompt, buildFixPrompt, AUTHOR_SCHEMA, FIX_SCHEMA, AUTHOR_SAMPLE_ROWS, type AuthorJob, type FixContext } from "./author";
import { pickReviewSample, buildReviewPrompt, parseReviewResponse, REVIEW_SCHEMA } from "./review";

export type JobStatus =
  | "queued" // 処理待ち
  | "working" // 処理中
  | "waiting_quota" // 使用上限に当たったので、時間をおいて再開する
  | "awaiting_approval" // 人の承認待ち（⑦）
  | "needs_human" // この仕組みでは作れない。理由つき
  | "approved"
  | "rejected"
  | "failed"; // 想定外のエラー

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  queued: "処理待ち",
  working: "処理中",
  waiting_quota: "使用上限のため待機中",
  awaiting_approval: "承認待ち",
  needs_human: "自動では作れない",
  approved: "承認済み",
  rejected: "差し戻し",
  failed: "エラー",
};

export interface Job {
  id: string;
  title: string;
  instructions: string;
  inputCsv: string;
  lists: Record<string, string[]>;
  /** public: 公開情報だけ / confidential: 依頼者の資料を含む（無料枠のAIに送らない） */
  dataClass: "public" | "confidential";
  deadline: string;
  priceJpy: number;
  status: JobStatus;
  note: string;
  recipeId: string | null;
  recipeVersion: number | null;
  route: RouteDecision | null;
  outputCsv: string;
  issues: RowIssue[];
  removed: RemovedRow[];
  report: JobReport | null;
  qualityPass: boolean | null;
  /** 出力の各行が入力の何行目から来たか（承認した行を手本に昇格させるときに使う）。 */
  outputSrc: number[];
  /** 差し戻しのときに人が書いた理由。次の処理で手順書の改修に渡す。 */
  feedback: string;
  inboxId: string | null;
  error: string;
  retryAt: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Attempt {
  phase: "run" | "rerun_rows" | "fixed_recipe";
  tier: Tier;
  rows: number;
  errorRate: number;
  note: string;
}

export interface JobReport {
  route: RouteDecision | null;
  recipe: { id: string; version: number; name: string; origin: "existing" | "new" | "adapted" | "fixed" };
  test: { accuracy: number; cells: number } | null;
  expectedCorrections: { index: number; column: string; value: string; reason: string }[];
  attempts: Attempt[];
  quality: QualitySummary;
  systemic: string;
  inputRows: number;
  outputRows: number;
  headers: string[];
}

export interface RecipeStore {
  list(): Recipe[];
  get(id: string): Recipe | null;
  /** 同じ id があれば版を上げて保存する。保存後の手順書を返す。 */
  save(recipe: Recipe): Recipe;
}

export interface PipelineDeps {
  call: ModelCaller;
  fetchPage: PageFetcher;
  recipes: RecipeStore;
  /** 途中経過を残す（画面に出す）。 */
  progress: (patch: Partial<Job>) => void;
  now?: () => string;
}

export interface PipelineResult {
  status: JobStatus;
  patch: Partial<Job>;
}

/** 手順書が作れなかった・試験に通らなかったことを表す。人に理由を見せる。 */
class CannotAutomate extends Error {}

const MAX_FIXES = 2;

export async function processJob(job: Job, deps: PipelineDeps): Promise<PipelineResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const table = parseTable(job.inputCsv);
  if (table.rows.length === 0) {
    return { status: "needs_human", patch: { note: "入力の表が空です（1行目を見出しにしたCSVが必要です）" } };
  }
  const input = withSrc(table.rows);
  const authorJob: AuthorJob = { title: job.title, instructions: job.instructions, headers: table.headers, rows: table.rows, lists: job.lists };

  try {
    // --- ②③ 振り分けと手順書 ---
    const resolved = await resolveRecipe(job, authorJob, table.headers, deps, now);
    let recipe: Recipe = resolved.recipe;
    const route = resolved.route;
    let origin = resolved.origin;
    const test = resolved.test;
    let corrections = resolved.corrections;
    deps.progress({ recipeId: recipe.id, recipeVersion: recipe.version });

    // 差し戻しの理由があれば、まず手順書をそれに合わせて直す
    if (job.feedback.trim()) {
      deps.progress({ note: "差し戻しの理由に合わせて、上位モデルが手順書を直しています" });
      const fixed = await fixRecipe(authorJob, job, recipe, {
        quality: { errorRate: 0, topIssues: [], systemic: `承認者からの差し戻し理由: ${job.feedback.slice(0, 1000)}` },
      }, deps, now).catch((e) => {
        if (e instanceof CannotAutomate) return null;
        throw e;
      });
      if (fixed) {
        recipe = fixed.recipe;
        corrections = [...corrections, ...fixed.corrections];
        origin = "fixed";
      }
      deps.progress({ recipeId: recipe.id, recipeVersion: recipe.version, feedback: "" });
    }

    // --- ④⑤ 作業と検品 ---
    const attempts: Attempt[] = [];
    let state = await runAndCheck(job, recipe, input, deps, undefined, `手順書「${recipe.name}」で${input.length}行を処理中`);
    attempts.push({ phase: "run", tier: recipe.tier, rows: input.length, errorRate: state.quality.errorRate, note: "" });

    // --- ⑥ やり直し ---
    // (a) AIが原因で落ちた行だけ、1段上のモデルでやり直す
    const up = nextTier(recipe.tier);
    if (!state.quality.pass && up && aiStepsOf(recipe).length > 0 && state.quality.aiErrorRate > MAX_ERROR_ROW_RATE) {
      const redo = new Set(state.quality.aiErrorRows);
      deps.progress({ note: `要確認が${Math.round(state.quality.errorRate * 100)}%。${redo.size}行を1段上のモデルでやり直しています` });
      const subset = input.filter((r) => redo.has(srcOf(r)));
      const again = await runRecipe(recipe, subset, { call: deps.call, fetchPage: deps.fetchPage, lists: job.lists, minTier: up });
      state = await recheck(job, recipe, merge(state, again.rows, again.issues, again.removed, redo), deps);
      attempts.push({ phase: "rerun_rows", tier: up, rows: subset.length, errorRate: state.quality.errorRate, note: "" });
    }

    // (b) それでも駄目なら、上位モデルに手順書を直させて全部やり直す
    // 元データの問題（ダミー番号など）だけなら、手順書を直しても消えないので改修しない
    for (let fix = 0; !state.quality.pass && state.quality.fixable && fix < MAX_FIXES; fix++) {
      deps.progress({ note: `品質基準に届かないため、上位モデルが手順書を改修しています（${fix + 1}回目）` });
      const fixed = await fixRecipe(authorJob, job, recipe, { quality: qualityContext(state) }, deps, now).catch((e) => {
        if (e instanceof CannotAutomate) return null;
        throw e;
      });
      if (!fixed) break;
      recipe = fixed.recipe;
      if (fixed.corrections.length) corrections = [...corrections, ...fixed.corrections];
      origin = origin === "existing" ? "fixed" : origin;
      deps.progress({ recipeId: recipe.id, recipeVersion: recipe.version });
      state = await runAndCheck(job, recipe, input, deps, undefined, `改修した手順書（第${recipe.version}版）でやり直しています`);
      attempts.push({ phase: "fixed_recipe", tier: recipe.tier, rows: input.length, errorRate: state.quality.errorRate, note: `第${recipe.version}版` });
    }

    // --- ⑦ 承認待ちへ ---
    const outRows = project(state.rows, recipe.output.columns);
    const report: JobReport = {
      route,
      recipe: { id: recipe.id, version: recipe.version, name: recipe.name, origin },
      test: test ? { accuracy: test.accuracy, cells: test.cells } : null,
      expectedCorrections: corrections,
      attempts,
      quality: state.quality,
      systemic: state.systemic,
      inputRows: input.length,
      outputRows: outRows.length,
      headers: recipe.output.columns,
    };
    return {
      status: "awaiting_approval",
      patch: {
        recipeId: recipe.id,
        recipeVersion: recipe.version,
        route,
        outputCsv: toCsvText(outRows, recipe.output.columns),
        outputSrc: state.rows.map(srcOf),
        issues: state.issues,
        removed: state.removed,
        report,
        qualityPass: state.quality.pass,
        note: state.quality.pass
          ? `完成。要確認 ${state.quality.errorRows}行 / ${outRows.length}行${state.quality.errorRows > 0 ? "（元データの問題の可能性。承認前に確認）" : ""}`
          : `品質基準に届いていません（要確認 ${Math.round(state.quality.errorRate * 100)}%${state.systemic ? "・検品AIの指摘あり" : ""}）。承認前に要確認の行を見てください`,
        finishedAt: now(),
      },
    };
  } catch (error) {
    if (error instanceof CannotAutomate) {
      return { status: "needs_human", patch: { note: error.message, finishedAt: now() } };
    }
    throw error;
  }
}

// --- 振り分け -----------------------------------------------------------------

interface Resolved {
  recipe: Recipe;
  route: RouteDecision | null;
  origin: JobReport["recipe"]["origin"];
  test: TestComparison | null;
  corrections: JobReport["expectedCorrections"];
}

async function resolveRecipe(job: Job, aj: AuthorJob, headers: string[], deps: PipelineDeps, now: () => string): Promise<Resolved> {
  // 使用上限で止まって再開したときは、決めた手順書から続ける（作り直さない）
  const resumed = job.recipeId ? deps.recipes.get(job.recipeId) : null;
  if (resumed) {
    return { recipe: resumed, route: job.route, origin: resumed.createdFromJobId === job.id ? "new" : "existing", test: null, corrections: [] };
  }
  deps.progress({ note: "振り分け中" });
  const route = await routeJob(job, headers, deps);
  deps.progress({ route, note: `振り分け: ${route.reason}` });
  const chosen = route.action === "use" && route.recipeId ? deps.recipes.get(route.recipeId) : null;
  if (chosen) return { recipe: chosen, route, origin: "existing", test: null, corrections: [] };
  const base = route.action === "adapt" && route.recipeId ? deps.recipes.get(route.recipeId) : null;
  deps.progress({ note: base ? `手順書「${base.name}」を直して使います（上位モデル）` : "新しい型の仕事です。上位モデルが手順書を作っています" });
  const made = await authorRecipe(aj, job, base, deps, now);
  return { recipe: made.recipe, route, origin: base ? "adapted" : "new", test: made.test, corrections: made.corrections };
}

async function routeJob(job: Job, headers: string[], deps: PipelineDeps): Promise<RouteDecision> {
  const recipes = deps.recipes.list();
  const candidates = scoreRecipes({ instructions: job.instructions, headers }, recipes);
  const byRule = decideByRule(candidates);
  if (byRule) return byRule;
  const top = candidates.slice(0, 3);
  const res = await deps.call({
    purpose: "route",
    tier: "light",
    prompt: buildRoutePrompt({ instructions: job.instructions, headers }, top.map((c) => recipes.find((r) => r.id === c.recipeId)!).filter(Boolean)),
    schema: ROUTE_SCHEMA,
  });
  if (!res.ok) {
    // 振り分けに失敗したら、既存を誤用するより新しく作るほうが安全
    return { action: "new", recipeId: null, reason: `振り分けAIが失敗したため新しく作る（${res.error ?? ""}）`, by: "rule", candidates: top };
  }
  return parseRouteResponse(res.data, top);
}

// --- 手順書づくり -------------------------------------------------------------

interface Made {
  recipe: Recipe;
  test: TestComparison | null;
  corrections: JobReport["expectedCorrections"];
}

async function authorRecipe(aj: AuthorJob, job: Job, base: Recipe | null, deps: PipelineDeps, now: () => string): Promise<Made> {
  const res = await deps.call({ purpose: "author", tier: "heavy", web: true, prompt: buildAuthorPrompt(aj, base), schema: AUTHOR_SCHEMA });
  if (!res.ok) throw new Error(`手順書づくりのAI呼び出しに失敗しました: ${res.error ?? ""}`);
  const data = (res.data ?? {}) as { feasible?: unknown; reason?: unknown; recipe?: unknown; expected?: unknown };
  if (data.feasible === false) {
    throw new CannotAutomate(`この依頼は自動では作れません: ${String(data.reason ?? "理由なし").slice(0, 400)}`);
  }
  const sample = aj.rows.slice(0, AUTHOR_SAMPLE_ROWS);
  const expected = (Array.isArray(data.expected) ? (data.expected as Record<string, unknown>[]) : []).map((e) =>
    Object.fromEntries(Object.entries(e ?? {}).map(([k, v]) => [k, v == null ? "" : String(v)]))
  );
  // 手本の行数が合わないと突き合わせられない。その場合は手本なしで進め、報告に残す
  const testSet =
    expected.length === sample.length && sample.length > 0
      ? { input: sample, expected, compareColumns: [], source: "model", dataClass: job.dataClass }
      : null;
  const meta = { id: undefined, version: 1, parentId: base?.id ?? null, createdFromJobId: job.id, testSet };
  const draft = typeof data.recipe === "object" && data.recipe ? (data.recipe as Record<string, unknown>) : {};
  const lists = Object.keys(aj.lists);
  let v = validateRecipe({ ...draft, ...meta }, { lists, now: now() });
  if (!v.ok || !v.recipe) {
    // 形の誤りは1回だけ、壊れた下書きと誤りの一覧を見せて直させる
    const again = await requestFix(aj, job, draft, { validationErrors: v.errors }, deps);
    v = validateRecipe({ ...again.raw, ...meta }, { lists, now: now() });
    if (!v.ok || !v.recipe) throw new CannotAutomate(`手順書の形の誤りが直りませんでした: ${v.errors.slice(0, 5).join(" / ")}`);
  }
  let recipe = v.recipe;

  let corrections: JobReport["expectedCorrections"] = [];
  let test = recipe.testSet ? await runTest(recipe, job, deps) : null;
  for (let i = 0; test && test.accuracy < MIN_TEST_ACCURACY && i < MAX_FIXES; i++) {
    deps.progress({ note: `手本との一致率 ${Math.round(test.accuracy * 100)}%。上位モデルが手順書を直しています（${i + 1}回目）` });
    const fixed = await fixRecipe(aj, job, recipe, { test }, deps, now, false);
    recipe = fixed.recipe;
    corrections = [...corrections, ...fixed.corrections];
    test = recipe.testSet ? await runTest(recipe, job, deps) : null;
  }
  if (test && test.accuracy < MIN_TEST_ACCURACY) {
    throw new CannotAutomate(
      `手順書を作りましたが、手本との一致率が ${Math.round(test.accuracy * 100)}% で基準（${MIN_TEST_ACCURACY * 100}%）に届きませんでした。` +
        `食い違いの例: ${test.mismatches.slice(0, 3).map((m) => `${m.column}「${m.expected}」→「${m.actual}」`).join(" / ")}`
    );
  }
  if (test) recipe = { ...recipe, trials: [...recipe.trials, { provider: "claude", model: "tier:" + recipe.tier, accuracy: test.accuracy, at: now(), note: "作成時の手本試験" }] };
  return { recipe: deps.recipes.save(recipe), test, corrections };
}

async function runTest(recipe: Recipe, job: Job, deps: PipelineDeps, preferred?: ModelChoice | null): Promise<TestComparison> {
  const ts = recipe.testSet!;
  const out = await runRecipe(recipe, withSrc(ts.input), { call: deps.call, fetchPage: deps.fetchPage, lists: job.lists, preferred });
  return compareToExpected(out.rows, ts.expected, ts.compareColumns.length ? ts.compareColumns : recipe.output.columns);
}

async function requestFix(aj: AuthorJob, job: Job, recipe: Recipe | Record<string, unknown>, ctx: FixContext, deps: PipelineDeps) {
  const res = await deps.call({ purpose: "fix", tier: "heavy", web: !!ctx.test, prompt: buildFixPrompt(aj, recipe, ctx), schema: FIX_SCHEMA });
  if (!res.ok) throw new Error(`手順書の改修のAI呼び出しに失敗しました: ${res.error ?? ""}`);
  const data = (res.data ?? {}) as { feasible?: unknown; reason?: unknown; recipe?: unknown; expectedCorrections?: unknown };
  if (data.feasible === false) throw new CannotAutomate(`改修できませんでした: ${String(data.reason ?? "").slice(0, 400)}`);
  const corrections = Array.isArray(data.expectedCorrections)
    ? (data.expectedCorrections as { index?: unknown; column?: unknown; value?: unknown; reason?: unknown }[])
        .filter((c) => typeof c.index === "number" && typeof c.column === "string" && typeof c.value === "string")
        .map((c) => ({ index: c.index as number, column: c.column as string, value: c.value as string, reason: String(c.reason ?? "").slice(0, 200) }))
    : [];
  return { raw: (typeof data.recipe === "object" && data.recipe ? data.recipe : {}) as Record<string, unknown>, corrections };
}

/** 改修。手本は元のものを引き継ぎ、訂正があれば明示して反映する（手本を黙って曲げない）。 */
async function fixRecipe(aj: AuthorJob, job: Job, recipe: Recipe, ctx: FixContext, deps: PipelineDeps, now: () => string, persist = true): Promise<Made> {
  const { raw, corrections } = await requestFix(aj, job, recipe, ctx, deps);
  let testSet = recipe.testSet;
  if (testSet && corrections.length) {
    const expected = testSet.expected.map((r) => ({ ...r }));
    for (const c of corrections) if (expected[c.index] && c.column in expected[c.index]) expected[c.index][c.column] = c.value;
    testSet = { ...testSet, expected };
  }
  const v = validateRecipe(
    { ...raw, id: recipe.id, version: recipe.version, parentId: recipe.parentId, createdFromJobId: recipe.createdFromJobId, createdAt: recipe.createdAt, testSet, stats: recipe.stats, trials: recipe.trials },
    { lists: Object.keys(aj.lists), now: now() }
  );
  if (!v.ok || !v.recipe) throw new CannotAutomate(`改修した手順書の形が不正です: ${v.errors.slice(0, 5).join(" / ")}`);
  let fixed = v.recipe;
  if (fixed.testSet && persist) {
    // 既存の手順書を改修した場合は、手本で退行していないか確かめてから保存する
    const t = await runTest(fixed, job, deps);
    if (t.accuracy < MIN_TEST_ACCURACY) throw new CannotAutomate(`改修した手順書が手本の試験に落ちました（一致率 ${Math.round(t.accuracy * 100)}%）`);
    fixed = { ...fixed, trials: [...fixed.trials, { provider: "claude", model: "tier:" + fixed.tier, accuracy: t.accuracy, at: now(), note: "改修時の手本試験" }] };
  }
  return { recipe: persist ? deps.recipes.save(fixed) : fixed, test: null, corrections };
}

// --- 作業と検品 ---------------------------------------------------------------

interface CheckState {
  rows: Row[];
  /** 作業工程で付いた要確認。行のやり直しでは、その行の分だけ差し替える。 */
  opIssues: RowIssue[];
  removed: RemovedRow[];
  /** 作業工程・出力規則・検品AIの指摘を合わせたもの。 */
  issues: RowIssue[];
  systemic: string;
  quality: QualitySummary;
}

async function runAndCheck(job: Job, recipe: Recipe, input: Row[], deps: PipelineDeps, minTier: Tier | undefined, note: string): Promise<CheckState> {
  deps.progress({ note });
  const out = await runRecipe(recipe, input, { call: deps.call, fetchPage: deps.fetchPage, lists: job.lists, minTier, preferred: recipe.preferred });
  return recheck(job, recipe, { rows: out.rows, opIssues: out.issues, removed: out.removed }, deps);
}

/** 出力規則の検品 → 検品AI（別の呼び出し・中くらいのモデル）。 */
async function recheck(
  job: Job,
  recipe: Recipe,
  s: { rows: Row[]; opIssues: RowIssue[]; removed: RemovedRow[] },
  deps: PipelineDeps
): Promise<CheckState> {
  let issues = dedupeIssues([...s.opIssues, ...checkOutput(recipe, s.rows)]);
  let systemic = "";
  if (s.rows.length > 0) {
    deps.progress({ note: "検品AIが確認しています" });
    const sample = pickReviewSample(s.rows, issues);
    const res = await deps.call({
      purpose: "review",
      tier: "standard",
      prompt: buildReviewPrompt(job, recipe, sample, s.rows.length, issues.length, s.removed),
      schema: REVIEW_SCHEMA,
    });
    if (res.ok) {
      const review = parseReviewResponse(res.data, sample);
      issues = dedupeIssues([...issues, ...review.issues]);
      systemic = review.systemic;
    } else {
      issues.push({ src: -1, column: "", reason: `検品AIを呼べませんでした（${(res.error ?? "").slice(0, 80)}）。機械の検品だけの結果です`, severity: "warn", fromAi: false });
    }
  }
  return { rows: s.rows, opIssues: s.opIssues, removed: s.removed, issues, systemic, quality: summarize(s.rows, issues, !!systemic) };
}

/** やり直した行で、元の結果を差し替える。 */
function merge(state: CheckState, rows: Row[], opIssues: RowIssue[], removed: RemovedRow[], redo: Set<number>) {
  const bySrc = new Map(rows.map((r) => [srcOf(r), r]));
  const gone = new Set(removed.map((x) => x.src));
  return {
    rows: state.rows.map((r) => bySrc.get(srcOf(r)) ?? r).filter((r) => !gone.has(srcOf(r))),
    opIssues: [...state.opIssues.filter((i) => !redo.has(i.src)), ...opIssues],
    removed: [...state.removed, ...removed],
  };
}

function qualityContext(s: CheckState): NonNullable<FixContext["quality"]> {
  const counts = new Map<string, { column: string; reason: string; count: number }>();
  for (const i of s.issues) {
    if (i.severity !== "error") continue;
    const reason = i.reason.replace(/「[^」]*」/g, "「…」");
    const k = `${i.column}\u0000${reason}`;
    const c = counts.get(k) ?? { column: i.column, reason, count: 0 };
    c.count++;
    counts.set(k, c);
  }
  return {
    errorRate: s.quality.errorRate,
    topIssues: [...counts.values()].sort((a, b) => b.count - a.count),
    systemic: s.systemic,
  };
}
