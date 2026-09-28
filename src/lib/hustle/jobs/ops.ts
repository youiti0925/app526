/**
 * 手順書の実行。
 *
 * 各行に `_src`（入力の何行目か）を持たせて最後まで運ぶ。検品で引っかかった行だけ
 * 上位モデルでやり直すとき、どの入力行をやり直せばいいかを辿れるようにするため。
 *
 * AIの答えは信用しない前提で、必ず機械の検品を通す:
 * - 抜き出した値が原文に無い → 空欄にして「要確認」（幻覚の疑い）
 * - Web調査の値が出典ページに無い → 「要確認」。出典を開けなかったときも黙って通さない
 * - 形式（電話・URL・メール）が崩れている → 「要確認」
 *
 * AIやページ取得は外から渡す（テストでは偽物を渡す）。
 */
import {
  normalizeText, normalizeWidth, normalizePhoneJp, normalizePostal, phoneKey, splitAddressJp,
} from "../dataops/normalize";
import {
  extractPhones, extractEmails, extractUrls, extractPostals, extractPricesJpy, extractCorpNames, extractDates,
} from "../dataops/extract";
import { checkRow, isValidJpPhone, isDummyPhone, isEmail, isHttpUrl, type ColumnRule } from "../dataops/validate";
import { dedupeRows, excludeByNgList } from "../dataops/listops";
import { fillTemplate } from "../dataops/template";
import { normalizedIncludes, chunk } from "../dataops/aiops-core";
import { TIERS, type AiField, type Recipe, type RecipeStep, type RuleSpec, type Tier } from "./recipe";
import type { ModelCaller, ModelChoice } from "./models";
import type { PageFetcher } from "./fetcher";

export type Row = Record<string, string>;
export const SRC = "_src";

export interface RowIssue {
  src: number;
  column: string;
  reason: string;
  severity: "error" | "warn";
  /** どの工程で付いたか（AI操作か機械か）。AI由来の失敗だけが上位モデルでのやり直しの対象。 */
  fromAi: boolean;
}

export interface RemovedRow {
  src: number;
  reason: string;
}

export interface RunContext {
  call: ModelCaller;
  fetchPage: PageFetcher;
  /** 依頼に添付されたリスト（NGリスト・既存リストなど）。 */
  lists: Record<string, string[]>;
  /** この段より軽いモデルは使わない（検品で落ちたときの格上げ）。 */
  minTier?: Tier;
  /** 比較試験で選ばれたモデル。格上げしていないときだけ使う。 */
  preferred?: ModelChoice | null;
  log?: (message: string) => void;
}

export interface RunOutput {
  rows: Row[];
  issues: RowIssue[];
  removed: RemovedRow[];
  aiCalls: number;
}

/** 入力の各行に `_src` を振る。 */
export function withSrc(rows: Row[]): Row[] {
  return rows.map((r, i) => ({ ...r, [SRC]: String(i) }));
}

export const srcOf = (row: Row): number => Number(row[SRC] ?? -1);

export function toColumnRule(spec: RuleSpec): ColumnRule | null {
  switch (spec.kind) {
    case "pattern":
      try {
        return { kind: "pattern", pattern: new RegExp(spec.pattern), label: spec.label };
      } catch {
        return null;
      }
    case "oneOf":
      // validate.ts に無い規則なので、正規表現に直して渡す
      return {
        kind: "pattern",
        pattern: new RegExp(`^(?:${spec.values.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`),
        label: `「${spec.values.join("／")}」のどれかであること`,
      };
    default:
      return spec;
  }
}

function maxTier(a: Tier, b: Tier | undefined): Tier {
  if (!b) return a;
  return TIERS.indexOf(b) > TIERS.indexOf(a) ? b : a;
}

const fill = (template: string, row: Row) =>
  template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, name: string) => (row[name.trim()] ?? "").trim());

// --- AI操作のプロンプト（純関数）--------------------------------------------

const FIELD_LINES = (fields: AiField[]) => fields.map((f) => `- ${f.name}（${f.kind}）: ${f.description}`).join("\n");

export const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, value: { type: "string" }, quote: { type: "string" } },
              required: ["name", "value", "quote"],
            },
          },
        },
        required: ["index", "fields"],
      },
    },
  },
  required: ["rows"],
};

export function buildExtractPrompt(texts: string[], fields: AiField[]): string {
  return [
    "各テキストから、指定の項目を抜き出してください。",
    "値はテキストに書かれている表記のまま使い、推測で補わないでください。見つからない項目は value を空文字にしてください。",
    "各項目に、根拠になるテキスト中の語句を quote としてそのまま付けてください（値を含む前後数語）。",
    "",
    "項目:",
    FIELD_LINES(fields),
    "",
    ...texts.flatMap((t, i) => [`=== テキスト ${i} ===`, t.replace(/\s+/g, " ").slice(0, 6000)]),
    "=== ここまで ===",
    "",
    "テキストごとに rows[].index にテキスト番号を入れて答えてください。",
  ].join("\n");
}

export const CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, label: { type: "string" }, quote: { type: "string" } },
        required: ["index", "label", "quote"],
      },
    },
  },
  required: ["rows"],
};

export function buildClassifyPromptGeneric(texts: string[], labels: string[]): string {
  return [
    "各文章を、次のラベルのうち最も当てはまる1つに分類してください。",
    `ラベル: ${labels.join(" / ")}`,
    "判断の根拠として、文章中の語句をそのまま1つ quote に入れてください。",
    "どれにも当てはまらない・判断できないときは label を「分類不能」にしてください。",
    "",
    ...texts.map((t, i) => `${i}: ${t.replace(/\s+/g, " ").slice(0, 400)}`),
  ].join("\n");
}

export const REWRITE_SCHEMA = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: { type: "object", properties: { index: { type: "integer" }, text: { type: "string" } }, required: ["index", "text"] },
    },
  },
  required: ["rows"],
};

export function buildRewritePromptGeneric(texts: string[], instruction: string): string {
  return [
    "各文章を、次の指示に従って書き換えてください。",
    `指示: ${instruction}`,
    "書かれていない事実を足さないでください。数値・固有名詞は変えないでください。",
    "",
    ...texts.flatMap((t, i) => [`=== 文章 ${i} ===`, t.slice(0, 3000)]),
    "=== ここまで ===",
  ].join("\n");
}

export const LOOKUP_SCHEMA = {
  type: "object",
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          value: { type: "string" },
          sourceUrl: { type: "string" },
          quote: { type: "string" },
        },
        required: ["name", "value", "sourceUrl", "quote"],
      },
    },
  },
  required: ["fields"],
};

export function buildLookupPrompt(query: string, fields: AiField[]): string {
  return [
    "次の対象について、Webで検索し、公式サイトなど一次情報のページを実際に開いて確かめてください。",
    `対象: ${query}`,
    "",
    "調べる項目:",
    FIELD_LINES(fields),
    "",
    "各項目について次を返してください:",
    "- value: 値（ページに書かれている表記のまま）",
    "- sourceUrl: その値を確認したページのURL（実際に開いたもの）",
    "- quote: そのページに書かれている、値を含む一文をそのまま",
    "確認できなかった項目は value と sourceUrl を空にしてください。推測・記憶で埋めないでください。",
    "まとめサイト・口コミサイトより、本人（公式）のページを優先してください。",
  ].join("\n");
}

// --- 実行 ---------------------------------------------------------------------

type ExtractFn = (text: string) => string[];
const EXTRACTORS: Record<Extract<RecipeStep, { op: "extract" }>["kind"], ExtractFn> = {
  phone: extractPhones,
  email: extractEmails,
  url: extractUrls,
  postal: extractPostals,
  price: (t) => extractPricesJpy(t).map((p) => String(p.jpy)),
  corp: extractCorpNames,
  date: extractDates,
};

function formatProblem(kind: AiField["kind"], value: string): string | null {
  if (!value) return null;
  if (kind === "phone" && (!isValidJpPhone(value) || isDummyPhone(value))) return "電話番号の形になっていない、またはダミー番号の疑い";
  if (kind === "url" && !isHttpUrl(value)) return "URLの形になっていない";
  if (kind === "email" && !isEmail(value)) return "メールアドレスの形になっていない";
  return null;
}

/** 長い文章が混ざっても1回の呼び出しが大きくなりすぎないよう、文字数でまとめる。 */
function batchesBy<T>(items: T[], size: (t: T) => number, maxChars: number, maxItems: number): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let chars = 0;
  for (const it of items) {
    const n = size(it);
    if (cur.length > 0 && (cur.length >= maxItems || chars + n > maxChars)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(it);
    chars += n;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

export async function runRecipe(recipe: Pick<Recipe, "steps" | "tier">, input: Row[], ctx: RunContext): Promise<RunOutput> {
  let rows = input.map((r) => ({ ...r }));
  const issues: RowIssue[] = [];
  const removed: RemovedRow[] = [];
  let aiCalls = 0;
  const log = ctx.log ?? (() => undefined);

  const issue = (row: Row, column: string, reason: string, severity: RowIssue["severity"], fromAi: boolean) =>
    issues.push({ src: srcOf(row), column, reason, severity, fromAi });

  const tierFor = (step: { tier?: Tier }): Tier => maxTier(step.tier ?? recipe.tier, ctx.minTier);
  const overrideFor = (step: { tier?: Tier }, web: boolean): ModelChoice | undefined => {
    if (ctx.minTier || step.tier || !ctx.preferred) return undefined;
    if (web && ctx.preferred.provider !== "claude") return undefined;
    return ctx.preferred;
  };

  for (const [i, step] of recipe.steps.entries()) {
    log(`工程${i + 1}: ${step.op}（${rows.length}行）`);
    switch (step.op) {
      case "normalize": {
        const into = step.into ?? step.column;
        for (const row of rows) {
          const v = row[step.column] ?? "";
          if (!v) {
            row[into] = "";
            continue;
          }
          if (step.kind === "text") row[into] = normalizeText(v);
          else if (step.kind === "width") row[into] = normalizeWidth(v);
          else if (step.kind === "phone") {
            const p = normalizePhoneJp(v);
            row[into] = p ?? v;
            if (!p) issue(row, into, "電話番号として整形できません", "warn", false);
          } else {
            const p = normalizePostal(v);
            row[into] = p ?? v;
            if (!p) issue(row, into, "郵便番号として整形できません", "warn", false);
          }
        }
        break;
      }
      case "split_address": {
        for (const row of rows) {
          const parts = splitAddressJp(row[step.column] ?? "");
          if (step.into.postal) row[step.into.postal] = parts.postal;
          if (step.into.prefecture) row[step.into.prefecture] = parts.prefecture;
          if (step.into.city) row[step.into.city] = parts.city;
          if (step.into.rest) row[step.into.rest] = parts.rest;
          if (parts.incomplete && (row[step.column] ?? "").trim()) issue(row, step.column, "住所を分割しきれませんでした", "warn", false);
        }
        break;
      }
      case "extract": {
        const fn = EXTRACTORS[step.kind];
        for (const row of rows) {
          const found = fn(row[step.from] ?? "");
          row[step.into] = step.pick === "all" ? found.join(" / ") : (found[0] ?? "");
        }
        break;
      }
      case "dedupe": {
        const r = dedupeRows(rows, step.keys);
        for (const d of r.removed) removed.push({ src: srcOf(d.row), reason: `重複（${srcOf(r.kept[d.duplicateOf] ?? {})}行目と同じ ${d.key}）` });
        rows = r.kept;
        break;
      }
      case "exclude": {
        const list = ctx.lists[step.listRef] ?? [];
        if (list.length === 0) {
          for (const row of rows) issue(row, step.column, `除外リスト「${step.listRef}」が空のため照合していません`, "warn", false);
          break;
        }
        const r = excludeByNgList(rows, step.column, list);
        for (const e of r.excluded) removed.push({ src: srcOf(e.row), reason: `「${step.listRef}」の「${e.matchedNg}」に該当（${e.how === "exact" ? "一致" : "包含"}）` });
        const kept = new Set(r.kept);
        const next = rows.filter((row) => kept.has(row) || r.review.some((v) => v.row === row));
        for (const v of r.review) issue(v.row, step.column, v.reason, "warn", false);
        rows = next;
        break;
      }
      case "filter": {
        const rule = toColumnRule(step.rule);
        if (!rule) break;
        const next: Row[] = [];
        for (const row of rows) {
          const ok = checkRow(row, { [step.column]: [rule] }).ok && (step.rule.kind !== "required" || !!(row[step.column] ?? "").trim());
          if ((step.keep === "pass") === ok) next.push(row);
          else removed.push({ src: srcOf(row), reason: `条件（${step.column}: ${step.rule.kind}）で除外` });
        }
        rows = next;
        break;
      }
      case "set":
        for (const row of rows) row[step.into] = step.value;
        break;
      case "template":
        for (const row of rows) {
          const doc = fillTemplate(step.template, row);
          row[step.into] = doc.text;
          if (doc.missing.length > 0) issue(row, step.into, `差し込めなかった項目: ${doc.missing.join("、")}`, "error", false);
        }
        break;
      case "fetch_page":
        for (const row of rows) {
          const url = (row[step.urlColumn] ?? "").trim();
          if (!url) {
            row[step.into] = "";
            issue(row, step.urlColumn, "URLが空のためページを取得していません", "warn", false);
            continue;
          }
          const page = await ctx.fetchPage(url);
          row[step.into] = page.text;
          if (!page.ok) issue(row, step.urlColumn, `ページを取得できません: ${page.reason}`, "error", false);
        }
        break;
      case "ai_extract": {
        const targets = rows.filter((r) => (r[step.from] ?? "").trim());
        for (const r of rows) if (!(r[step.from] ?? "").trim()) {
          for (const f of step.fields) r[f.name] = r[f.name] ?? "";
          issue(r, step.from, "抜き出し元が空です", "warn", false);
        }
        for (const batch of batchesBy(targets, (r) => Math.min(6000, (r[step.from] ?? "").length), 16_000, 8)) {
          aiCalls++;
          const res = await ctx.call({
            purpose: "run", tier: tierFor(step), prompt: buildExtractPrompt(batch.map((r) => r[step.from] ?? ""), step.fields),
            schema: EXTRACT_SCHEMA, override: overrideFor(step, false),
          });
          const byIndex = new Map<number, { name?: unknown; value?: unknown; quote?: unknown }[]>();
          const got = (res.data as { rows?: unknown })?.rows;
          if (res.ok && Array.isArray(got)) {
            for (const g of got) {
              const idx = (g as { index?: unknown })?.index;
              const fs = (g as { fields?: unknown })?.fields;
              if (typeof idx === "number" && Array.isArray(fs)) byIndex.set(idx, fs as { name?: unknown; value?: unknown; quote?: unknown }[]);
            }
          }
          batch.forEach((row, bi) => {
            const text = (row[step.from] ?? "").replace(/\s+/g, " ").slice(0, 6000);
            const answers = byIndex.get(bi) ?? [];
            for (const f of step.fields) {
              const a = answers.find((x) => x?.name === f.name);
              const value = typeof a?.value === "string" ? a.value.trim() : "";
              const quote = typeof a?.quote === "string" ? a.quote : "";
              row[f.name] = "";
              if (!res.ok) {
                issue(row, f.name, `AIの呼び出しに失敗: ${(res.error ?? "").slice(0, 80)}`, "error", true);
                continue;
              }
              if (!value) {
                issue(row, f.name, "原文に見つかりませんでした", "warn", true);
                continue;
              }
              if (!normalizedIncludes(text, value)) {
                issue(row, f.name, `AIの答え「${value.slice(0, 30)}」が原文に無いため空欄にしました（幻覚の疑い）`, "error", true);
                continue;
              }
              row[f.name] = value;
              if (quote && !normalizedIncludes(text, quote)) issue(row, f.name, "根拠の引用が原文に見つかりません", "warn", true);
              const bad = formatProblem(f.kind, value);
              if (bad) issue(row, f.name, bad, "error", true);
            }
          });
        }
        break;
      }
      case "ai_classify": {
        for (const batch of chunk(rows, 30)) {
          aiCalls++;
          const texts = batch.map((r) => r[step.from] ?? "");
          const res = await ctx.call({
            purpose: "run", tier: tierFor(step), prompt: buildClassifyPromptGeneric(texts, step.labels),
            schema: CLASSIFY_SCHEMA, override: overrideFor(step, false),
          });
          const got = (res.data as { rows?: unknown })?.rows;
          const byIndex = new Map<number, { label?: unknown; quote?: unknown }>();
          if (res.ok && Array.isArray(got)) for (const g of got) {
            const idx = (g as { index?: unknown })?.index;
            if (typeof idx === "number") byIndex.set(idx, g as { label?: unknown; quote?: unknown });
          }
          batch.forEach((row, bi) => {
            const a = byIndex.get(bi);
            const label = typeof a?.label === "string" ? a.label : "";
            const quote = typeof a?.quote === "string" ? a.quote : "";
            if (!res.ok) {
              row[step.into] = "";
              issue(row, step.into, `AIの呼び出しに失敗: ${(res.error ?? "").slice(0, 80)}`, "error", true);
            } else if (!step.labels.includes(label)) {
              row[step.into] = "";
              issue(row, step.into, label === "分類不能" ? "AIが分類できませんでした" : "決められたラベル以外が返りました", "error", true);
            } else {
              row[step.into] = label;
              if (!quote || !normalizedIncludes(texts[bi], quote)) issue(row, step.into, "分類の根拠が原文に見つかりません", "warn", true);
            }
          });
        }
        break;
      }
      case "ai_rewrite": {
        const targets = rows.filter((r) => (r[step.from] ?? "").trim());
        for (const r of rows) if (!(r[step.from] ?? "").trim()) r[step.into] = "";
        for (const batch of batchesBy(targets, (r) => Math.min(3000, (r[step.from] ?? "").length), 8000, 6)) {
          aiCalls++;
          const texts = batch.map((r) => r[step.from] ?? "");
          const res = await ctx.call({
            purpose: "run", tier: tierFor(step), prompt: buildRewritePromptGeneric(texts, step.instruction),
            schema: REWRITE_SCHEMA, override: overrideFor(step, false),
          });
          const got = (res.data as { rows?: unknown })?.rows;
          const byIndex = new Map<number, string>();
          if (res.ok && Array.isArray(got)) for (const g of got) {
            const idx = (g as { index?: unknown })?.index;
            const text = (g as { text?: unknown })?.text;
            if (typeof idx === "number" && typeof text === "string") byIndex.set(idx, text.trim());
          }
          batch.forEach((row, bi) => {
            const text = byIndex.get(bi) ?? "";
            row[step.into] = text;
            if (!res.ok || !text) {
              issue(row, step.into, res.ok ? "書き換え結果が空でした" : `AIの呼び出しに失敗: ${(res.error ?? "").slice(0, 80)}`, "error", true);
              return;
            }
            const ratio = text.length / Math.max(1, texts[bi].slice(0, 3000).length);
            if (ratio < 0.3 || ratio > 3) issue(row, step.into, `長さが原文の${Math.round(ratio * 100)}%で、省略か水増しの疑い`, "error", true);
          });
        }
        break;
      }
      case "ai_lookup": {
        for (const row of rows) {
          const query = fill(step.query, row);
          for (const f of step.fields) {
            row[f.name] = "";
            row[`${f.name}_出典`] = "";
          }
          if (!query.replace(/\s+/g, "")) {
            issue(row, step.fields[0].name, "調べる対象が空です", "warn", false);
            continue;
          }
          aiCalls++;
          const res = await ctx.call({
            purpose: "run", tier: tierFor(step), prompt: buildLookupPrompt(query, step.fields),
            schema: LOOKUP_SCHEMA, web: true, override: overrideFor(step, true),
          });
          const got = (res.data as { fields?: unknown })?.fields;
          const answers = res.ok && Array.isArray(got) ? (got as { name?: unknown; value?: unknown; sourceUrl?: unknown; quote?: unknown }[]) : [];
          for (const f of step.fields) {
            if (!res.ok) {
              issue(row, f.name, `AIの呼び出しに失敗: ${(res.error ?? "").slice(0, 80)}`, "error", true);
              continue;
            }
            const a = answers.find((x) => x?.name === f.name);
            const value = typeof a?.value === "string" ? a.value.trim() : "";
            const source = typeof a?.sourceUrl === "string" ? a.sourceUrl.trim() : "";
            if (!value) {
              issue(row, f.name, "調べても確認できませんでした", "warn", true);
              continue;
            }
            row[f.name] = value;
            row[`${f.name}_出典`] = source;
            const bad = formatProblem(f.kind, value);
            if (bad) {
              issue(row, f.name, bad, "error", true);
              continue;
            }
            const verdict = await verifyLookup(f, value, source, ctx.fetchPage);
            if (verdict) issue(row, f.name, verdict.reason, verdict.severity, true);
          }
        }
        break;
      }
    }
  }
  return { rows, issues, removed, aiCalls };
}

/**
 * Web調査の値を、出典ページを自分で開いて確かめる。
 * AIが「確認した」と言うだけでは信用しない（存在しないURL・番号を返すことがある）。
 * 問題がなければ null。
 */
export async function verifyLookup(
  field: AiField,
  value: string,
  sourceUrl: string,
  fetchPage: PageFetcher
): Promise<{ reason: string; severity: RowIssue["severity"] } | null> {
  if (field.kind === "url") {
    const page = await fetchPage(value);
    if (page.ok) return null;
    return /robots|取得に失敗|HTTP 5|ホスト名/.test(page.reason) && !/HTTP 404|HTTP 410/.test(page.reason)
      ? { reason: `URLを機械で確認できませんでした（${page.reason}）。目視確認へ`, severity: "warn" }
      : { reason: `URLが開けません（${page.reason}）`, severity: "error" };
  }
  if (!sourceUrl || !isHttpUrl(sourceUrl)) return { reason: "出典URLがありません", severity: "error" };
  const page = await fetchPage(sourceUrl);
  if (!page.ok) return { reason: `出典ページを機械で確認できませんでした（${page.reason}）。目視確認へ`, severity: "warn" };
  if (field.kind === "phone") {
    const key = phoneKey(value);
    const onPage = extractPhones(page.text).map(phoneKey);
    return key && onPage.includes(key) ? null : { reason: "出典ページにこの電話番号がありません", severity: "error" };
  }
  return normalizedIncludes(page.text, value) ? null : { reason: "出典ページにこの値がありません", severity: "error" };
}
