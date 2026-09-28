/**
 * 振り分け — 来た依頼を、どの手順書で処理するか決める。
 *
 * まず機械で点数をつける（AIを使わない）。はっきり決まるときはそれで終わり。
 * 迷うときだけ軽いモデルに候補3つから選ばせる。手順書が1つも無い・
 * 全く似ていないときは、AIに聞くまでもなく「新しく作る」。
 */
import { normalizeText } from "../dataops/normalize";
import type { Recipe } from "./recipe";

export interface RouteCandidate {
  recipeId: string;
  name: string;
  score: number;
  keywordHits: string[];
  missingColumns: string[];
}

export type RouteAction = "use" | "adapt" | "new";

export interface RouteDecision {
  action: RouteAction;
  recipeId: string | null;
  reason: string;
  by: "rule" | "ai";
  candidates: RouteCandidate[];
}

const norm = (t: string) => normalizeText(t).toLowerCase().replace(/\s+/g, "");

export function scoreRecipes(job: { instructions: string; headers: string[] }, recipes: Recipe[]): RouteCandidate[] {
  const text = norm(job.instructions);
  const headers = new Set(job.headers.map(norm));
  return recipes
    .map((r) => {
      const hits = r.match.keywords.filter((k) => norm(k) && text.includes(norm(k)));
      const missing = r.input.columns.filter((c) => !headers.has(norm(c)));
      const kw = Math.min(1, hits.length / Math.max(1, Math.min(5, r.match.keywords.length)));
      const cols = r.input.columns.length === 0 ? 0 : (r.input.columns.length - missing.length) / r.input.columns.length;
      return { recipeId: r.id, name: r.name, score: Math.round((kw * 0.6 + cols * 0.4) * 100) / 100, keywordHits: hits, missingColumns: missing };
    })
    .sort((a, b) => b.score - a.score);
}

export const USE_THRESHOLD = 0.7;
export const NEW_THRESHOLD = 0.2;
export const CLEAR_MARGIN = 0.2;

/** 機械だけで決まるなら決定を返す。AIに聞くべきなら null。 */
export function decideByRule(candidates: RouteCandidate[]): RouteDecision | null {
  const [top, second] = candidates;
  if (!top || top.score < NEW_THRESHOLD) {
    return {
      action: "new",
      recipeId: null,
      reason: top ? `似ている手順書がありません（最高 ${top.score}点: ${top.name}）` : "手順書がまだ1つもありません",
      by: "rule",
      candidates: candidates.slice(0, 3),
    };
  }
  if (top.score >= USE_THRESHOLD && top.missingColumns.length === 0 && (!second || top.score - second.score >= CLEAR_MARGIN)) {
    return {
      action: "use",
      recipeId: top.recipeId,
      reason: `「${top.name}」と一致（${top.score}点、キーワード: ${top.keywordHits.join("・") || "なし"}）`,
      by: "rule",
      candidates: candidates.slice(0, 3),
    };
  }
  return null;
}

export const ROUTE_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["use", "adapt", "new"] },
    recipeId: { type: "string" },
    reason: { type: "string" },
  },
  required: ["action", "recipeId", "reason"],
};

export function buildRoutePrompt(job: { instructions: string; headers: string[] }, recipes: Recipe[]): string {
  return [
    "次の依頼を、どの手順書で処理するか決めてください。",
    "- use: 手順書をそのまま使える（依頼の条件・列・納品形式がすべて合う）",
    "- adapt: 似ているが、列や条件が違うので手順書を直す必要がある",
    "- new: どれも合わない",
    "少しでも条件が違うなら use にしないでください。違う手順で作った納品物は差し戻しになります。",
    "",
    "## 依頼",
    job.instructions.slice(0, 4000),
    "",
    `## 入力の列: ${job.headers.join(" / ")}`,
    "",
    "## 手順書の候補",
    ...recipes.map((r) =>
      [
        `### recipeId: ${r.id}`,
        `名前: ${r.name}`,
        `内容: ${r.match.description.slice(0, 400)}`,
        `必要な入力列: ${r.input.columns.join(" / ")}`,
        `納品する列: ${r.output.columns.join(" / ")}`,
      ].join("\n")
    ),
    "",
    "new のときは recipeId を空文字にしてください。",
  ].join("\n");
}

export function parseRouteResponse(raw: unknown, candidates: RouteCandidate[]): RouteDecision {
  const r = (raw ?? {}) as { action?: unknown; recipeId?: unknown; reason?: unknown };
  const reason = typeof r.reason === "string" ? r.reason.slice(0, 300) : "";
  const cand = candidates.find((c) => c.recipeId === r.recipeId);
  if ((r.action === "use" || r.action === "adapt") && cand) {
    // 入力列が足りないのに「そのまま使う」は通さない
    const action = r.action === "use" && cand.missingColumns.length > 0 ? "adapt" : r.action;
    return {
      action,
      recipeId: cand.recipeId,
      reason: action !== r.action ? `${reason}（入力列 ${cand.missingColumns.join("・")} が無いため直して使う）` : reason,
      by: "ai",
      candidates,
    };
  }
  return { action: "new", recipeId: null, reason: reason || "AIの判断を読めなかったため、新しく作る", by: "ai", candidates };
}
