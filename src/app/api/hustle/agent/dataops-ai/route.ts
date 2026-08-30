import { NextRequest, NextResponse } from "next/server";
import { guard, readJsonObject, oneOf, str } from "@/lib/hustle/http";
import { hasApiKey, describeAiError } from "@/lib/hustle/ai";
import { CallBudget } from "@/lib/hustle/agent/budget";
import { aiMatchPairs, aiClassify, aiExtractFields, aiRewrite } from "@/lib/hustle/agent/aiops";
import type { FieldSpec, MatchPair, RewriteMode } from "@/lib/hustle/dataops/aiops-core";
import { logEvent } from "@/lib/hustle/agent/db";

/** 1リクエストで使えるAI呼び出しの上限。エンジンが無料枠を食い潰さないための天井。 */
const MAX_CALLS_PER_REQUEST = 20;

const TASKS = ["match_pairs", "classify", "extract_fields", "rewrite"] as const;

/**
 * データ作業エンジンのAI層。
 *
 * カスケードの2段目: 決定的処理で確定できなかった分だけがここに来る。
 * 応答は aiops-core の検品（引用の実在確認・決定的検証）を通ってから返る。
 */
export async function POST(request: NextRequest) {
  return guard(async () => {
    if (!hasApiKey()) {
      return NextResponse.json({ error: "AIキーが未設定です。設定画面で保存してください。" }, { status: 400 });
    }
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const task = oneOf(body.task, TASKS);
    if (!task) return NextResponse.json({ error: `task は ${TASKS.join(" / ")} です` }, { status: 400 });

    const budget = new CallBudget(MAX_CALLS_PER_REQUEST);

    try {
      if (task === "match_pairs") {
        const allPairs = Array.isArray(body.pairs) ? body.pairs : [];
        const rawPairs = allPairs.slice(0, 300);
        const pairs: MatchPair[] = rawPairs
          .map((p: unknown) => ({
            a: str((p as { a?: unknown })?.a, 200) ?? "",
            b: str((p as { b?: unknown })?.b, 200) ?? "",
          }))
          .filter((p: MatchPair) => p.a && p.b);
        if (pairs.length === 0) return NextResponse.json({ error: "pairs が空です" }, { status: 400 });
        const out = await aiMatchPairs(pairs, budget);
        logEvent("manual", "runner", "action", `AI同一判定: ${pairs.length}組（呼び出し${out.meta.callsUsed}回）`, {});
        // 上限で切り詰めた事実を隠さない。UIはこの値で件数を報告する
        return NextResponse.json({ ...out, accepted: pairs.length, truncated: Math.max(0, allPairs.length - rawPairs.length) });
      }

      if (task === "classify") {
        // index は呼び出し元の配列位置と1対1で保つ。空欄を filter で詰めると、
        // 返した index が別の回答に付き、納品データが黙ってズレる（レビューで実証）。
        const allTexts = (Array.isArray(body.texts) ? body.texts : []).map((t: unknown) => str(t, 500) ?? "");
        const texts = allTexts.slice(0, 600);
        const categories = (Array.isArray(body.categories) ? body.categories : []).map((c: unknown) => str(c, 40) ?? "").filter(Boolean).slice(0, 20);
        if (texts.filter(Boolean).length === 0 || categories.length < 2) {
          return NextResponse.json({ error: "texts と、2つ以上の categories が必要です" }, { status: 400 });
        }
        const nonEmpty = texts.map((t, i) => ({ t, i })).filter((x) => x.t.trim());
        const out = await aiClassify(nonEmpty.map((x) => x.t), categories, budget);
        // aiClassify は圧縮後の並びに対する index を返すので、元の行位置へ戻す
        const items = texts.map((_, i) => ({ index: i, category: "(空欄)", quote: "", needsHuman: false, reason: "空欄のため対象外" }));
        for (const it of out.items) {
          const original = nonEmpty[it.index]?.i;
          if (original !== undefined) items[original] = { ...it, index: original };
        }
        logEvent("manual", "runner", "action", `AI分類: ${nonEmpty.length}件（呼び出し${out.meta.callsUsed}回）`, {});
        return NextResponse.json({ items, meta: out.meta, accepted: texts.length, truncated: Math.max(0, allTexts.length - texts.length) });
      }

      if (task === "extract_fields") {
        const text = str(body.text, 20000) ?? "";
        const KINDS = ["phone", "url", "email", "text"] as const;
        const fields: FieldSpec[] = (Array.isArray(body.fields) ? body.fields : [])
          .map((f: unknown) => ({
            name: str((f as { name?: unknown })?.name, 40) ?? "",
            kind: oneOf((f as { kind?: unknown })?.kind, KINDS) ?? "text",
          }))
          .filter((f: FieldSpec) => f.name)
          .slice(0, 20);
        if (!text.trim() || fields.length === 0) {
          return NextResponse.json({ error: "text と fields が必要です" }, { status: 400 });
        }
        const out = await aiExtractFields(text, fields, budget);
        return NextResponse.json(out);
      }

      // rewrite（str の実上限は 20,000字。超過分は分割処理される）
      const text = str(body.text, 20000) ?? "";
      const MODES = ["kebatori", "seibun", "paraphrase"] as const;
      const mode: RewriteMode = oneOf(body.mode, MODES) ?? "seibun";
      if (!text.trim()) return NextResponse.json({ error: "text が必要です" }, { status: 400 });
      const out = await aiRewrite(text, mode, budget);
      return NextResponse.json(out);
    } catch (error) {
      const described = describeAiError(error);
      return NextResponse.json({ error: described.message }, { status: described.status });
    }
  });
}
