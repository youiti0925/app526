"use client";

/**
 * データ作業エンジン — dataops のエンジン群を案件が来た瞬間に使うための画面。
 * すべてブラウザ内で処理する。サーバーにも生成AIにもデータを送らない
 * （NDA前提の名刺・顧客リスト案件を想定した設計判断）。
 */
import { useMemo, useState } from "react";
import { Cpu, Download, Play } from "lucide-react";
import {
  extractAll,
  checkRow, type ColumnRule,
  reconcileRow, summarizeReconcile, type FieldKind,
  dedupeRows, excludeByNgList, diffAgainstExisting, type KeyKind,
  valueCounts, crossTab, numericSummary,
  mailMerge,
  parseTable, toCsvText,
  DATAOPS_PATTERNS, matchDataOpsPatterns,
} from "@/lib/hustle/dataops";

type ToolId = "pattern" | "extract" | "inspect" | "dedupe" | "ng_filter" | "diff" | "tabulate" | "mail_merge";

interface ToolDef {
  id: ToolId;
  label: string;
  mainLabel: string;
  paramLabel: string | null;
  hint: string;
}

const TOOLS: ToolDef[] = [
  { id: "pattern", label: "① 募集文からパターン判定", mainLabel: "募集文を貼り付け", paramLabel: null, hint: "どのエンジンで受けられる案件か、どこまで自動でどこから人かを即答します。" },
  { id: "extract", label: "② テキストから項目抽出", mainLabel: "元テキスト（コピペ・HTML可）", paramLabel: null, hint: "電話番号・メール・URL・社名・価格・日付を拾って表にします。" },
  { id: "inspect", label: "③ リスト検査（納品前チェック）", mainLabel: "CSV（1行目=見出し）", paramLabel: null, hint: "空欄・電話/URLの形式・ダミー番号を機械検査し、要確認行を分けます。" },
  { id: "dedupe", label: "④ 名寄せ・重複統合", mainLabel: "CSV（1行目=見出し）", paramLabel: null, hint: "社名・電話・URL列の表記ゆれを吸収して重複を畳みます。" },
  { id: "ng_filter", label: "⑤ NGリスト除外", mainLabel: "CSV（1行目=見出し）", paramLabel: "NGリスト（1行1名称）", hint: "法人格・全半角の揺れごと除外。英字⇔カナは人の確認行に回します。" },
  { id: "diff", label: "⑥ 既存リストとの差分", mainLabel: "新しく集めたCSV", paramLabel: "既存リストのCSV", hint: "「既存と重複しないこと」という定番要件に。重複納品を防ぎます。" },
  { id: "tabulate", label: "⑦ アンケート集計", mainLabel: "回答CSV（1行目=見出し）", paramLabel: "集計する列名（2行目にクロス集計の列名・任意）", hint: "度数分布・複数回答の分解・クロス集計・数値要約。" },
  { id: "mail_merge", label: "⑧ 差し込み書類の量産", mainLabel: "データCSV（1行目=見出し）", paramLabel: "テンプレート（{{列名}} が差し込み位置）", hint: "全件差し込み、埋まらない穴と未使用列を必ず報告します。" },
];

const PHONE_COL = /電話|TEL/i;
const URL_COL = /URL|HP|ホームページ|サイト/i;
const CORP_COL = /社名|会社|運営|法人|企業|施設/;

interface RunResult {
  summary: string[];
  rows?: Record<string, string>[];
  headers?: string[];
  text?: string;
}

function runTool(tool: ToolId, main: string, param: string): RunResult {
  if (tool === "pattern") {
    const matches = matchDataOpsPatterns(main);
    if (matches.length === 0) return { summary: ["登録済み21パターンには当たりませんでした。定型外の案件か、判定キーワードの追加が要ります。"] };
    return {
      summary: matches.map((m) =>
        `【${m.pattern.name}】相場: ${m.pattern.priceHint ?? "調査中"} / 自動: ${m.pattern.autoParts.join("・")} / 人: ${m.pattern.humanParts.join("・")} / 注意: ${m.pattern.caution}`
      ),
    };
  }

  if (tool === "extract") {
    const f = extractAll(main);
    const rows: Record<string, string>[] = [
      ...f.phones.map((v) => ({ 種類: "電話", 値: v })),
      ...f.emails.map((v) => ({ 種類: "メール", 値: v })),
      ...f.urls.map((v) => ({ 種類: "URL", 値: v })),
      ...f.corpNames.map((v) => ({ 種類: "法人名", 値: v })),
      ...f.prices.map((p) => ({ 種類: "価格", 値: `${p.jpy.toLocaleString()}円 (${p.raw})` })),
      ...f.dates.map((v) => ({ 種類: "日付", 値: v })),
    ];
    return { summary: [`${rows.length}項目を抽出しました。`], rows, headers: ["種類", "値"] };
  }

  const table = parseTable(main);
  if (table.rows.length === 0) return { summary: ["CSVを読めませんでした。1行目に見出しがあるか確認してください。"] };
  const { headers, rows } = table;

  if (tool === "inspect") {
    const rules: Record<string, ColumnRule[]> = {};
    for (const h of headers) {
      rules[h] = [{ kind: "required" }];
      if (PHONE_COL.test(h)) rules[h].push({ kind: "phone" });
      if (URL_COL.test(h)) rules[h].push({ kind: "url" });
    }
    let ok = 0;
    const flagged: Record<string, string>[] = [];
    rows.forEach((row, i) => {
      const c = checkRow(row, rules);
      if (c.ok) { ok++; return; }
      flagged.push({
        行: String(i + 2),
        ...row,
        問題: [...c.missing.map((m) => `${m}が空欄`), ...c.invalid.map((v) => `${v.column}: ${v.reason}`)].join(" / "),
      });
    });
    return {
      summary: [
        `${rows.length}行中 ${ok}行 が機械検査を通過。${flagged.length}行 が要確認です。`,
        "要確認行だけを下に出しています。ここだけ目視すれば納品できます。",
      ],
      rows: flagged,
      headers: ["行", ...headers, "問題"],
    };
  }

  if (tool === "dedupe") {
    const keys = headers.flatMap((h): { column: string; kind: KeyKind }[] => {
      if (CORP_COL.test(h)) return [{ column: h, kind: "corp" }];
      if (PHONE_COL.test(h)) return [{ column: h, kind: "phone" }];
      if (URL_COL.test(h)) return [{ column: h, kind: "url" }];
      return [];
    });
    if (keys.length === 0) return { summary: ["名寄せキーになる列（社名/会社/運営/電話/URL/HP）が見出しにありません。"] };
    const r = dedupeRows(rows, keys);
    return {
      summary: [
        `キー列: ${keys.map((k) => k.column).join("・")} / ${rows.length}行 → ${r.kept.length}行（重複 ${r.removed.length}行を統合）`,
        ...r.removed.slice(0, 5).map((d) => `統合: ${Object.values(d.row).filter(Boolean).slice(0, 3).join(" | ")}`),
      ],
      rows: r.kept,
      headers,
    };
  }

  if (tool === "ng_filter") {
    const ngNames = param.split(/\n/).map((s) => s.trim()).filter(Boolean);
    if (ngNames.length === 0) return { summary: ["NGリストを右の欄に1行1名称で入れてください。"] };
    const col = headers.find((h) => CORP_COL.test(h));
    if (!col) return { summary: ["法人名の列（社名/会社/運営など）が見つかりません。"] };
    const r = excludeByNgList(rows, col, ngNames);
    return {
      summary: [
        `${rows.length}行中: 通過 ${r.kept.length} / NG除外 ${r.excluded.length} / 人の確認へ ${r.review.length}`,
        ...r.excluded.slice(0, 5).map((e) => `除外: ${e.row[col]} ←→ ${e.matchedNg}（${e.how === "exact" ? "一致" : "包含"}）`),
        ...r.review.slice(0, 5).map((v) => `要確認: ${v.row[col] || "(空欄)"} — ${v.reason}`),
      ],
      rows: r.kept,
      headers,
    };
  }

  if (tool === "diff") {
    const existing = parseTable(param);
    if (existing.rows.length === 0) return { summary: ["既存リストのCSVを右の欄に貼ってください。"] };
    const keys = headers.flatMap((h): { column: string; kind: KeyKind }[] => {
      if (CORP_COL.test(h)) return [{ column: h, kind: "corp" }];
      if (PHONE_COL.test(h)) return [{ column: h, kind: "phone" }];
      if (URL_COL.test(h)) return [{ column: h, kind: "url" }];
      return [{ column: h, kind: "text" }];
    });
    const r = diffAgainstExisting(rows, existing.rows, keys);
    return {
      summary: [`新規 ${r.fresh.length}行 / 既存と重複 ${r.alreadyListed.length}行（重複分は納品から外してください）`],
      rows: r.fresh,
      headers,
    };
  }

  if (tool === "tabulate") {
    const lines = param.split(/\n/).map((s) => s.trim()).filter(Boolean);
    const col = lines[0];
    if (!col || !headers.includes(col)) return { summary: [`集計する列名を右の欄に書いてください。候補: ${headers.join(" / ")}`] };
    if (lines[1] && headers.includes(lines[1])) {
      const ct = crossTab(rows, col, lines[1]);
      const outRows = ct.rowValues.map((rv, i) => {
        const row: Record<string, string> = { [col]: rv };
        ct.colValues.forEach((cv, j) => { row[cv] = String(ct.cells[i][j]); });
        row["合計"] = String(ct.rowTotals[i]);
        return row;
      });
      return { summary: [`クロス集計: ${col} × ${lines[1]}（全${ct.total}件）`], rows: outRows, headers: [col, ...ct.colValues, "合計"] };
    }
    const counts = valueCounts(rows, col, { splitMulti: /[、,／/]/ });
    const ns = numericSummary(rows, col);
    const summary = [`${col} の度数分布（全${rows.length}件）`];
    if (ns.count > 0 && ns.count >= rows.length / 2) {
      summary.push(`数値として: 平均 ${ns.mean} / 中央値 ${ns.median} / 最小 ${ns.min} / 最大 ${ns.max}（数値化できず ${ns.invalid}件）`);
    }
    return {
      summary,
      rows: counts.map((c) => ({ 値: c.value, 件数: String(c.count), 割合: `${c.percent}%` })),
      headers: ["値", "件数", "割合"],
    };
  }

  // mail_merge
  if (!param.trim()) return { summary: ["テンプレートを右の欄に書いてください。{{列名}} が差し込み位置です。"] };
  const m = mailMerge(param, rows);
  return {
    summary: [
      `${rows.length}件中: 完成 ${m.complete} / 穴あき ${m.incomplete}${m.unusedColumns.length ? ` / 使われていない列: ${m.unusedColumns.join("・")}` : ""}`,
      ...(m.incomplete > 0 ? ["穴あき分は {{列名}} のまま残しています。埋めるか、先方に「この項目は含みません」と明示してください。"] : []),
    ],
    text: m.docs.map((d, i) => `----- ${i + 1}件目${d.missing.length ? `（未記入: ${d.missing.join("・")}）` : ""} -----\n${d.text}`).join("\n\n"),
  };
}

export default function DataOpsEngine() {
  const [tool, setTool] = useState<ToolId>("pattern");
  const [main, setMain] = useState("");
  const [param, setParam] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);
  const def = TOOLS.find((t) => t.id === tool)!;
  const preview = useMemo(() => result?.rows?.slice(0, 12) ?? [], [result]);

  function download() {
    if (!result) return;
    const isCsv = !!result.rows;
    const content = isCsv ? toCsvText(result.rows!, result.headers) : result.text ?? "";
    const blob = new Blob([content], { type: isCsv ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = isCsv ? `${tool}_result.csv` : `${tool}_result.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="mt-10">
      <header className="mb-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Cpu className="w-5 h-5 text-indigo-600" />
          データ作業エンジン
        </h2>
        <p className="text-sm text-slate-600 mt-1 leading-relaxed">
          データ入力・リスト作成・書類作成の定型処理をその場で実行します。処理はすべてブラウザ内で完結し、外部に送信しません。
        </p>
      </header>

      <div className="card mb-5">
        <div className="flex flex-wrap gap-2 mb-3">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTool(t.id); setResult(null); }}
              className={`text-xs rounded-full px-3 py-1.5 border ${t.id === tool ? "bg-indigo-600 text-white border-indigo-600" : "hover:bg-slate-100"}`}
              style={t.id === tool ? undefined : { borderColor: "var(--card-border)" }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 mb-3">{def.hint}</p>

        <div className={`grid gap-3 ${def.paramLabel ? "md:grid-cols-2" : ""}`}>
          <div>
            <label className="block text-xs font-semibold mb-1">{def.mainLabel}</label>
            <textarea
              value={main}
              onChange={(e) => setMain(e.target.value)}
              rows={8}
              className="w-full rounded-lg border p-2 text-xs font-mono"
              style={{ borderColor: "var(--card-border)" }}
            />
          </div>
          {def.paramLabel && (
            <div>
              <label className="block text-xs font-semibold mb-1">{def.paramLabel}</label>
              <textarea
                value={param}
                onChange={(e) => setParam(e.target.value)}
                rows={8}
                className="w-full rounded-lg border p-2 text-xs font-mono"
                style={{ borderColor: "var(--card-border)" }}
              />
            </div>
          )}
        </div>

        <button
          onClick={() => setResult(main.trim() ? runTool(tool, main, param) : { summary: ["入力が空です。"] })}
          className="btn-primary flex items-center gap-2 mt-4"
        >
          <Play className="w-4 h-4" />
          実行する
        </button>
      </div>

      {result && (
        <div className="card mb-6">
          <ul className="text-sm space-y-1.5 leading-relaxed">
            {result.summary.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
          {result.rows && result.rows.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-lg border mt-4" style={{ borderColor: "var(--card-border)" }}>
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-slate-100">
                      {(result.headers ?? Object.keys(result.rows[0])).map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-t">
                        {(result.headers ?? Object.keys(result.rows![0])).map((h) => (
                          <td key={h} className="px-3 py-2 whitespace-nowrap max-w-72 truncate" title={row[h]}>{row[h]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.rows.length > preview.length && (
                <p className="text-xs text-slate-500 mt-2">先頭12行のみ表示。全{result.rows.length}行はダウンロードで。</p>
              )}
            </>
          )}
          {result.text && (
            <pre className="mt-4 rounded-lg border p-3 text-xs whitespace-pre-wrap max-h-72 overflow-y-auto" style={{ borderColor: "var(--card-border)" }}>{result.text.slice(0, 4000)}</pre>
          )}
          {(result.rows?.length || result.text) && (
            <button onClick={download} className="btn-primary flex items-center gap-2 mt-4">
              <Download className="w-4 h-4" />
              結果を保存
            </button>
          )}
        </div>
      )}

      <div className="card">
        <h3 className="font-semibold mb-1">搭載パターン台帳（{DATAOPS_PATTERNS.length}種）</h3>
        <p className="text-xs text-slate-500 mb-3">
          市場調査（ココナラ実データ220件 + 相場調査 2026-08）で確認した定型案件と、受けたときの自動/人の分担です。
        </p>
        <div className="space-y-1.5">
          {DATAOPS_PATTERNS.map((p) => (
            <details key={p.id} className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--card-border)" }}>
              <summary className="text-sm font-medium cursor-pointer flex items-baseline justify-between gap-2">
                <span>{p.name}</span>
                <span className="text-xs text-slate-500 shrink-0">{p.priceHint ?? ""}</span>
              </summary>
              <div className="text-xs leading-relaxed mt-2 space-y-1 text-slate-600">
                <p><span className="font-semibold">こういう依頼: </span>{p.looksLike}</p>
                <p><span className="font-semibold">実例: </span>{p.marketExample}</p>
                <p><span className="font-semibold">自動: </span>{p.autoParts.join("・")}</p>
                <p><span className="font-semibold">人: </span>{p.humanParts.join("・")}</p>
                <p className="text-amber-700"><span className="font-semibold">注意: </span>{p.caution}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
