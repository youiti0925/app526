/**
 * 手順書（レシピ）— 1種類の仕事の「やり方」をデータとして持つ。
 *
 * なぜプログラムではなくデータか:
 * 新しい型の仕事が来たとき、手順書を書くのは Claude（上位モデル）。
 * それを「コード」として受け取って実行すると、AIが書いた任意の処理が
 * このサーバーで動くことになる。データにしておけば、実行できるのは
 * ここで許可した操作（データ作業エンジンの部品）だけに限られる。
 *
 * だから Claude が書いた手順書は、保存する前に必ず validateRecipe() を通す。
 * 知らない操作・知らない列の参照・長すぎる正規表現は、黙って直さず弾く。
 */

export type Tier = "light" | "standard" | "heavy";
export const TIERS: readonly Tier[] = ["light", "standard", "heavy"];
export const TIER_LABELS: Record<Tier, string> = {
  light: "軽いモデル",
  standard: "中くらいのモデル",
  heavy: "上位モデル",
};

/** 1段上のモデル。いちばん上なら null。 */
export function nextTier(tier: Tier): Tier | null {
  const i = TIERS.indexOf(tier);
  return i >= 0 && i < TIERS.length - 1 ? TIERS[i + 1] : null;
}

/** 列の検査規則（JSONで持てる形）。validate.ts の ColumnRule に変換して使う。 */
export type RuleSpec =
  | { kind: "required" }
  | { kind: "phone" }
  | { kind: "email" }
  | { kind: "url" }
  | { kind: "postal" }
  | { kind: "priceBand"; minJpy: number; maxJpy: number }
  | { kind: "pattern"; pattern: string; label: string }
  | { kind: "oneOf"; values: string[] };

export type AiFieldKind = "phone" | "url" | "email" | "text";

export interface AiField {
  name: string;
  kind: AiFieldKind;
  /** 何を抜き出すか。AIへの指示に入る。 */
  description: string;
}

/**
 * 実行できる操作の一覧。ここに無いものは手順書に書いても動かない。
 * 追加するときは ops.ts の実装と OP_CATALOG の説明も同時に足すこと。
 */
export type RecipeStep =
  | { op: "normalize"; column: string; kind: "text" | "width" | "phone" | "postal"; into?: string }
  | { op: "split_address"; column: string; into: { postal?: string; prefecture?: string; city?: string; rest?: string } }
  | { op: "extract"; from: string; kind: "phone" | "email" | "url" | "postal" | "price" | "corp" | "date"; into: string; pick: "first" | "all" }
  | { op: "dedupe"; keys: { column: string; kind: "corp" | "phone" | "url" | "text" }[] }
  | { op: "exclude"; column: string; listRef: string }
  | { op: "filter"; column: string; rule: RuleSpec; keep: "pass" | "fail" }
  | { op: "set"; into: string; value: string }
  | { op: "template"; into: string; template: string }
  | { op: "fetch_page"; urlColumn: string; into: string }
  | { op: "ai_extract"; from: string; fields: AiField[]; tier?: Tier }
  | { op: "ai_classify"; from: string; labels: string[]; into: string; tier?: Tier }
  | { op: "ai_rewrite"; from: string; into: string; instruction: string; tier?: Tier }
  | { op: "ai_lookup"; query: string; fields: AiField[]; tier?: Tier };

export type OpName = RecipeStep["op"];

export const OP_CATALOG: Record<OpName, { ai: boolean; summary: string; shape: string }> = {
  normalize: { ai: false, summary: "表記をそろえる（全角半角・空白・電話番号・郵便番号）", shape: '{"op":"normalize","column":"電話","kind":"phone","into":"電話(整形)"}' },
  split_address: { ai: false, summary: "住所を 郵便番号/都道府県/市区町村/番地以降 に分ける", shape: '{"op":"split_address","column":"住所","into":{"prefecture":"都道府県","city":"市区町村","rest":"番地"}}' },
  extract: { ai: false, summary: "文章から電話・メール・URL・郵便番号・金額・法人名・日付を機械で抜く", shape: '{"op":"extract","from":"本文","kind":"phone","into":"電話","pick":"first"}' },
  dedupe: { ai: false, summary: "名寄せして重複行を畳む（先勝ち）", shape: '{"op":"dedupe","keys":[{"column":"会社名","kind":"corp"}]}' },
  exclude: { ai: false, summary: "依頼者のNGリスト・既存リストに載っている行を外す", shape: '{"op":"exclude","column":"会社名","listRef":"NGリスト"}' },
  filter: { ai: false, summary: "条件に合う行だけ残す（合わない行を残すことも可）", shape: '{"op":"filter","column":"電話","rule":{"kind":"phone"},"keep":"pass"}' },
  set: { ai: false, summary: "全行に同じ値を入れる", shape: '{"op":"set","into":"備考","value":"公式サイト確認済"}' },
  template: { ai: false, summary: "{{列名}} を差し込んで文章を作る", shape: '{"op":"template","into":"文面","template":"{{会社名}} ご担当者様"}' },
  fetch_page: { ai: false, summary: "URL列のページを取得して本文テキストを入れる（robots.txt順守・公開ページのみ）", shape: '{"op":"fetch_page","urlColumn":"URL","into":"_ページ本文"}' },
  ai_extract: { ai: true, summary: "非定型の文章から項目をAIで抜く。値と根拠が原文に実在しないものは要確認へ", shape: '{"op":"ai_extract","from":"_ページ本文","fields":[{"name":"電話","kind":"phone","description":"代表電話番号"}]}' },
  ai_classify: { ai: true, summary: "文章を決められたラベルのどれかにAIで分類する", shape: '{"op":"ai_classify","from":"回答","labels":["満足","不満","その他"],"into":"分類"}' },
  ai_rewrite: { ai: true, summary: "文章をAIで書き換える（整文・要約・言い換え）", shape: '{"op":"ai_rewrite","from":"説明","into":"説明(整文)","instruction":"です・ます調に整える。事実を足さない"}' },
  ai_lookup: { ai: true, summary: "1行ごとにWebを検索して項目を調べる。出典URLと引用が必須で、出典ページに値が無ければ要確認へ", shape: '{"op":"ai_lookup","query":"{{施設名}} {{所在地}} 公式サイト","fields":[{"name":"公式URL","kind":"url","description":"施設の公式サイト"}]}' },
};

export interface TestSet {
  /** 入力の見本（数行）。 */
  input: Record<string, string>[];
  /** その入力に対する正解。上位モデルが自分で手作業した結果か、人が確認した結果。 */
  expected: Record<string, string>[];
  /** 正解と照合する列。空なら出力列すべて。 */
  compareColumns: string[];
  /** 誰が正解を作ったか。人が確認したものは信用度が高い。 */
  source: "model" | "human";
  /**
   * 見本の元になった依頼のデータ区分。依頼者の資料（confidential）から作った見本は、
   * モデル比較でも無料枠の Gemini には送らない。
   */
  dataClass: "public" | "confidential";
}

export interface ModelTrial {
  provider: string;
  model: string;
  accuracy: number;
  at: string;
  note: string;
}

export interface Recipe {
  id: string;
  version: number;
  name: string;
  summary: string;
  /** 振り分けに使う。 */
  match: { keywords: string[]; description: string };
  /** 必要な入力列。 */
  input: { columns: string[] };
  steps: RecipeStep[];
  output: { columns: string[]; rules: Record<string, RuleSpec[]> };
  /** 既定で使うモデルの段。手順書の各AI操作で個別に上書きできる。 */
  tier: Tier;
  /** 比較試験で「これで足りる」と分かった安いモデル。無ければ tier の既定モデル。 */
  preferred: { provider: "claude" | "gemini"; model: string } | null;
  testSet: TestSet | null;
  trials: ModelTrial[];
  parentId: string | null;
  createdFromJobId: string | null;
  createdAt: string;
  updatedAt: string;
  stats: { runs: number; approved: number; rejected: number; lastUsedAt: string | null };
}

// --- 検証 -------------------------------------------------------------------

export interface RecipeValidation {
  ok: boolean;
  recipe: Recipe | null;
  errors: string[];
}

const MAX_STEPS = 30;
const MAX_PATTERN = 200;
const MAX_TEMPLATE = 4000;
const MAX_TEST_ROWS = 10;
const NAME_RE = /^[^\n\r{}]{1,60}$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown, max = 500): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const strArr = (v: unknown, maxLen = 200, maxItems = 200): string[] | null =>
  Array.isArray(v) && v.length <= maxItems && v.every((x) => typeof x === "string" && x.length <= maxLen) ? (v as string[]) : null;

function checkRule(raw: unknown, where: string, errors: string[]): RuleSpec | null {
  if (!isObj(raw)) {
    errors.push(`${where}: 規則がオブジェクトではありません`);
    return null;
  }
  switch (raw.kind) {
    case "required":
    case "phone":
    case "email":
    case "url":
    case "postal":
      return { kind: raw.kind };
    case "priceBand": {
      const min = Number(raw.minJpy);
      const max = Number(raw.maxJpy);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
        errors.push(`${where}: priceBand の範囲が不正です`);
        return null;
      }
      return { kind: "priceBand", minJpy: min, maxJpy: max };
    }
    case "pattern": {
      if (!isStr(raw.pattern, MAX_PATTERN)) {
        errors.push(`${where}: pattern が空か長すぎます（${MAX_PATTERN}字まで）`);
        return null;
      }
      // 入れ子の量指定子は破滅的バックトラックの元なので受けない
      if (/\([^)]*[+*][^)]*\)[+*{]/.test(raw.pattern)) {
        errors.push(`${where}: 入れ子の繰り返しを含む正規表現は使えません`);
        return null;
      }
      try {
        new RegExp(raw.pattern);
      } catch {
        errors.push(`${where}: 正規表現として読めません`);
        return null;
      }
      return { kind: "pattern", pattern: raw.pattern, label: isStr(raw.label, 100) ? raw.label : "形式が条件に合いません" };
    }
    case "oneOf": {
      const values = strArr(raw.values, 100, 100);
      if (!values || values.length === 0) {
        errors.push(`${where}: oneOf の候補が空です`);
        return null;
      }
      return { kind: "oneOf", values };
    }
    default:
      errors.push(`${where}: 知らない規則 ${String(raw.kind)}`);
      return null;
  }
}

function checkFields(raw: unknown, where: string, errors: string[]): AiField[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) {
    errors.push(`${where}: fields は1〜20個にしてください`);
    return null;
  }
  const out: AiField[] = [];
  for (const [i, f] of raw.entries()) {
    if (!isObj(f) || !isStr(f.name, 60) || !NAME_RE.test(f.name)) {
      errors.push(`${where}.fields[${i}]: name が不正です`);
      continue;
    }
    const kind = f.kind === "phone" || f.kind === "url" || f.kind === "email" ? f.kind : "text";
    out.push({ name: f.name, kind, description: isStr(f.description, 300) ? f.description : f.name });
  }
  return out.length === raw.length ? out : null;
}

function checkTier(raw: unknown): Tier | undefined {
  return raw === "light" || raw === "standard" || raw === "heavy" ? raw : undefined;
}

/**
 * 1操作を検証する。known は「この時点で存在する列」。
 * 存在しない列を読む手順は、実行してから空欄だらけで気づくより、ここで弾くほうが安い。
 */
function checkStep(raw: unknown, i: number, known: Set<string>, lists: Set<string> | null, errors: string[]): RecipeStep | null {
  const where = `steps[${i}]`;
  if (!isObj(raw) || typeof raw.op !== "string") {
    errors.push(`${where}: op がありません`);
    return null;
  }
  const need = (col: unknown, label: string): col is string => {
    if (!isStr(col, 60)) {
      errors.push(`${where}(${raw.op}): ${label} がありません`);
      return false;
    }
    if (!known.has(col)) {
      errors.push(`${where}(${raw.op}): 列「${col}」はこの時点で存在しません`);
      return false;
    }
    return true;
  };
  const makes = (col: unknown, label: string): col is string => {
    if (!isStr(col, 60) || !NAME_RE.test(col)) {
      errors.push(`${where}(${raw.op}): ${label} の列名が不正です`);
      return false;
    }
    return true;
  };

  switch (raw.op) {
    case "normalize": {
      const kind = raw.kind;
      if (kind !== "text" && kind !== "width" && kind !== "phone" && kind !== "postal") {
        errors.push(`${where}: normalize の kind が不正です`);
        return null;
      }
      if (!need(raw.column, "column")) return null;
      const into = raw.into === undefined ? undefined : makes(raw.into, "into") ? raw.into : null;
      if (into === null) return null;
      if (into) known.add(into);
      return { op: "normalize", column: raw.column, kind, ...(into ? { into } : {}) };
    }
    case "split_address": {
      if (!need(raw.column, "column") || !isObj(raw.into)) return null;
      const into: { postal?: string; prefecture?: string; city?: string; rest?: string } = {};
      for (const key of ["postal", "prefecture", "city", "rest"] as const) {
        const v = raw.into[key];
        if (v === undefined) continue;
        if (!makes(v, `into.${key}`)) return null;
        into[key] = v;
        known.add(v);
      }
      if (Object.keys(into).length === 0) {
        errors.push(`${where}: split_address の出力先が1つもありません`);
        return null;
      }
      return { op: "split_address", column: raw.column, into };
    }
    case "extract": {
      const kinds = ["phone", "email", "url", "postal", "price", "corp", "date"] as const;
      const kind = kinds.find((k) => k === raw.kind);
      if (!kind) {
        errors.push(`${where}: extract の kind が不正です`);
        return null;
      }
      if (!need(raw.from, "from") || !makes(raw.into, "into")) return null;
      known.add(raw.into);
      return { op: "extract", from: raw.from, kind, into: raw.into, pick: raw.pick === "all" ? "all" : "first" };
    }
    case "dedupe": {
      if (!Array.isArray(raw.keys) || raw.keys.length === 0 || raw.keys.length > 5) {
        errors.push(`${where}: dedupe の keys は1〜5個にしてください`);
        return null;
      }
      const keys: { column: string; kind: "corp" | "phone" | "url" | "text" }[] = [];
      for (const k of raw.keys) {
        if (!isObj(k) || !need(k.column, "keys.column")) return null;
        const kind = k.kind === "corp" || k.kind === "phone" || k.kind === "url" ? k.kind : "text";
        keys.push({ column: k.column, kind });
      }
      return { op: "dedupe", keys };
    }
    case "exclude": {
      if (!need(raw.column, "column") || !isStr(raw.listRef, 60)) {
        if (!isStr(raw.listRef, 60)) errors.push(`${where}: exclude の listRef がありません`);
        return null;
      }
      if (lists && !lists.has(raw.listRef)) {
        errors.push(`${where}: リスト「${raw.listRef}」が依頼に添付されていません`);
        return null;
      }
      return { op: "exclude", column: raw.column, listRef: raw.listRef };
    }
    case "filter": {
      if (!need(raw.column, "column")) return null;
      const rule = checkRule(raw.rule, `${where}.rule`, errors);
      if (!rule) return null;
      return { op: "filter", column: raw.column, rule, keep: raw.keep === "fail" ? "fail" : "pass" };
    }
    case "set": {
      if (!makes(raw.into, "into") || typeof raw.value !== "string" || raw.value.length > 500) {
        if (typeof raw.value !== "string") errors.push(`${where}: set の value がありません`);
        return null;
      }
      known.add(raw.into);
      return { op: "set", into: raw.into, value: raw.value };
    }
    case "template": {
      if (!makes(raw.into, "into") || !isStr(raw.template, MAX_TEMPLATE)) {
        if (!isStr(raw.template, MAX_TEMPLATE)) errors.push(`${where}: template が空か長すぎます`);
        return null;
      }
      for (const m of raw.template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
        if (!known.has(m[1].trim())) {
          errors.push(`${where}: 差し込み {{${m[1].trim()}}} の列がこの時点で存在しません`);
          return null;
        }
      }
      known.add(raw.into);
      return { op: "template", into: raw.into, template: raw.template };
    }
    case "fetch_page": {
      if (!need(raw.urlColumn, "urlColumn") || !makes(raw.into, "into")) return null;
      known.add(raw.into);
      return { op: "fetch_page", urlColumn: raw.urlColumn, into: raw.into };
    }
    case "ai_extract": {
      if (!need(raw.from, "from")) return null;
      const fields = checkFields(raw.fields, where, errors);
      if (!fields) return null;
      for (const f of fields) known.add(f.name);
      return { op: "ai_extract", from: raw.from, fields, ...(checkTier(raw.tier) ? { tier: checkTier(raw.tier) } : {}) };
    }
    case "ai_classify": {
      if (!need(raw.from, "from") || !makes(raw.into, "into")) return null;
      const labels = strArr(raw.labels, 60, 30);
      if (!labels || labels.length < 2) {
        errors.push(`${where}: ai_classify の labels は2個以上にしてください`);
        return null;
      }
      known.add(raw.into);
      return { op: "ai_classify", from: raw.from, labels, into: raw.into, ...(checkTier(raw.tier) ? { tier: checkTier(raw.tier) } : {}) };
    }
    case "ai_rewrite": {
      if (!need(raw.from, "from") || !makes(raw.into, "into") || !isStr(raw.instruction, 1000)) {
        if (!isStr(raw.instruction, 1000)) errors.push(`${where}: ai_rewrite の instruction がありません`);
        return null;
      }
      known.add(raw.into);
      return { op: "ai_rewrite", from: raw.from, into: raw.into, instruction: raw.instruction, ...(checkTier(raw.tier) ? { tier: checkTier(raw.tier) } : {}) };
    }
    case "ai_lookup": {
      if (!isStr(raw.query, 500)) {
        errors.push(`${where}: ai_lookup の query がありません`);
        return null;
      }
      for (const m of raw.query.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
        if (!known.has(m[1].trim())) {
          errors.push(`${where}: query の {{${m[1].trim()}}} の列がこの時点で存在しません`);
          return null;
        }
      }
      const fields = checkFields(raw.fields, where, errors);
      if (!fields) return null;
      for (const f of fields) {
        known.add(f.name);
        known.add(`${f.name}_出典`);
      }
      return { op: "ai_lookup", query: raw.query, fields, ...(checkTier(raw.tier) ? { tier: checkTier(raw.tier) } : {}) };
    }
    default:
      errors.push(`${where}: 使えない操作「${raw.op}」です（使えるのは ${Object.keys(OP_CATALOG).join(", ")}）`);
      return null;
  }
}

function checkRows(raw: unknown, max: number): Record<string, string>[] | null {
  if (!Array.isArray(raw) || raw.length > max) return null;
  const out: Record<string, string>[] = [];
  for (const r of raw) {
    if (!isObj(r)) return null;
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) row[k] = v === null || v === undefined ? "" : String(v).slice(0, 2000);
    out.push(row);
  }
  return out;
}

export interface ValidateOptions {
  /** 依頼に添付されたリストの名前。指定すると exclude の参照先を確かめる。 */
  lists?: string[];
  now?: string;
}

/**
 * AIが書いた手順書（あるいはDBから読んだもの）を検証し、正規化した Recipe を返す。
 * 1つでもおかしな所があれば ok=false。部分的に直して通すことはしない。
 */
export function validateRecipe(raw: unknown, opts: ValidateOptions = {}): RecipeValidation {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, recipe: null, errors: ["手順書がオブジェクトではありません"] };

  const name = isStr(raw.name, 80) ? raw.name : "";
  if (!name) errors.push("name がありません");
  const summary = isStr(raw.summary, 1000) ? raw.summary : "";

  const matchRaw = isObj(raw.match) ? raw.match : {};
  const keywords = strArr(matchRaw.keywords, 40, 40) ?? [];
  if (keywords.length === 0) errors.push("match.keywords が空です（振り分けに使えません）");
  const description = isStr(matchRaw.description, 1000) ? matchRaw.description : summary;

  const inputCols = strArr(isObj(raw.input) ? raw.input.columns : undefined, 60, 60);
  if (!inputCols || inputCols.length === 0) errors.push("input.columns が空です");

  const known = new Set(inputCols ?? []);
  const lists = opts.lists ? new Set(opts.lists) : null;
  const steps: RecipeStep[] = [];
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) errors.push("steps が空です");
  else if (raw.steps.length > MAX_STEPS) errors.push(`steps は${MAX_STEPS}個までです`);
  else {
    raw.steps.forEach((s, i) => {
      const step = checkStep(s, i, known, lists, errors);
      if (step) steps.push(step);
    });
  }

  const outRaw = isObj(raw.output) ? raw.output : {};
  const outCols = strArr(outRaw.columns, 60, 60) ?? [];
  if (outCols.length === 0) errors.push("output.columns が空です");
  for (const c of outCols) if (!known.has(c)) errors.push(`output.columns の「${c}」を作る手順がありません`);
  const rules: Record<string, RuleSpec[]> = {};
  if (isObj(outRaw.rules)) {
    for (const [col, list] of Object.entries(outRaw.rules)) {
      if (!outCols.includes(col)) {
        errors.push(`output.rules の「${col}」は出力列にありません`);
        continue;
      }
      if (!Array.isArray(list)) continue;
      rules[col] = list.map((r, j) => checkRule(r, `output.rules.${col}[${j}]`, errors)).filter((r): r is RuleSpec => !!r);
    }
  }

  let testSet: TestSet | null = null;
  if (raw.testSet !== undefined && raw.testSet !== null) {
    const t = isObj(raw.testSet) ? raw.testSet : {};
    const input = checkRows(t.input, MAX_TEST_ROWS);
    const expected = checkRows(t.expected, MAX_TEST_ROWS);
    if (!input || !expected || input.length === 0 || input.length !== expected.length) {
      errors.push(`testSet は input と expected を同じ行数（1〜${MAX_TEST_ROWS}行）で持ってください`);
    } else {
      const compare = (strArr(t.compareColumns, 60, 60) ?? []).filter((c) => outCols.includes(c));
      testSet = {
        input,
        expected,
        compareColumns: compare,
        source: t.source === "human" ? "human" : "model",
        // 分からなければ安全側（依頼者の資料扱い）に倒す
        dataClass: t.dataClass === "public" ? "public" : "confidential",
      };
    }
  }

  const now = opts.now ?? new Date().toISOString();
  const id = isStr(raw.id, 80) && /^[a-z0-9][a-z0-9_-]{2,79}$/.test(raw.id) ? raw.id : slugFrom(name, now);
  const pref = isObj(raw.preferred) ? raw.preferred : {};
  const preferred: Recipe["preferred"] =
    (pref.provider === "claude" || pref.provider === "gemini") && isStr(pref.model, 80)
      ? { provider: pref.provider, model: pref.model }
      : null;
  const statsRaw = isObj(raw.stats) ? raw.stats : {};

  if (errors.length > 0) return { ok: false, recipe: null, errors };

  return {
    ok: true,
    errors: [],
    recipe: {
      id,
      version: Number.isInteger(raw.version) && (raw.version as number) > 0 ? (raw.version as number) : 1,
      name,
      summary,
      match: { keywords, description },
      input: { columns: inputCols ?? [] },
      steps,
      output: { columns: outCols, rules },
      tier: checkTier(raw.tier) ?? "light",
      preferred,
      testSet,
      trials: Array.isArray(raw.trials) ? (raw.trials as ModelTrial[]).slice(-20) : [],
      parentId: isStr(raw.parentId, 80) ? raw.parentId : null,
      createdFromJobId: isStr(raw.createdFromJobId, 80) ? raw.createdFromJobId : null,
      createdAt: isStr(raw.createdAt, 40) ? raw.createdAt : now,
      updatedAt: now,
      stats: {
        runs: Number(statsRaw.runs) || 0,
        approved: Number(statsRaw.approved) || 0,
        rejected: Number(statsRaw.rejected) || 0,
        lastUsedAt: isStr(statsRaw.lastUsedAt, 40) ? statsRaw.lastUsedAt : null,
      },
    },
  };
}

function slugFrom(name: string, now: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const stamp = now.replace(/[^0-9]/g, "").slice(0, 14);
  // 同じ秒に2つ作られても別の手順書になるように（同じ id だと版違いとして上書きされる）
  const salt = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `${ascii || "recipe"}-${stamp}-${salt}`;
}

/** 手順書が使うAIの段のうち、いちばん重いもの。使用量の見積りに使う。 */
export function aiStepsOf(recipe: Pick<Recipe, "steps">): Extract<RecipeStep, { op: `ai_${string}` }>[] {
  return recipe.steps.filter((s): s is Extract<RecipeStep, { op: `ai_${string}` }> => s.op.startsWith("ai_"));
}
