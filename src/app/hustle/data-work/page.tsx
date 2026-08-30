"use client";

import { useMemo, useState } from "react";
import { Download, FileSpreadsheet, ShieldCheck, Sparkles } from "lucide-react";
import StorageNotice from "@/components/hustle/StorageNotice";
import DataOpsEngine from "@/components/hustle/DataOpsEngine";
import {
  cleanCsv,
  DEFAULT_CSV_CLEAN_OPTIONS,
  type CsvCleanOptions,
  type CsvCleanResult,
} from "@/lib/hustle/csv-cleaner";

export default function DataWorkPage() {
  const [fileName, setFileName] = useState("");
  const [source, setSource] = useState("");
  const [options, setOptions] = useState<CsvCleanOptions>(DEFAULT_CSV_CLEAN_OPTIONS);
  const [result, setResult] = useState<CsvCleanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => result?.rows.slice(0, 12) ?? [], [result]);

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setResult(null);
    if (file.size > 15 * 1024 * 1024) {
      setError("15MBを超えるファイルは、ブラウザが重くなるため対象外です。");
      return;
    }
    try {
      const text = await file.text();
      setFileName(file.name);
      setSource(text);
    } catch {
      setError("ファイルを読み込めませんでした。CSV / TSV / TXT形式を選んでください。");
    }
  }

  function run() {
    if (!source.trim()) {
      setError("CSVまたはTSVファイルを選んでください。");
      return;
    }
    setError(null);
    setResult(cleanCsv(source, options));
  }

  function download() {
    if (!result) return;
    const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${fileName.replace(/\.(csv|tsv|txt)$/i, "") || "data"}_cleaned.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-8 max-w-6xl">
      <StorageNotice />

      <header className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
          CSV整形・納品ツール
        </h1>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          「CSV・Excelの重複削除、空行削除、全角半角の統一」を受注したときの実作業を自動化します。
          ファイルはブラウザ内だけで処理し、サーバーや生成AIには送りません。
        </p>
      </header>

      <section className="card mb-6">
        <div className="flex items-start gap-3 mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" />
          <p>
            最初の商品は「1,000行まで3,000円、重複・空行・余分な空白を整理、要確認行の報告付き」が目安です。
            XLSXはExcelでCSV UTF-8として保存してから投入してください。
          </p>
        </div>

        <label className="block text-sm font-semibold mb-2">元データ</label>
        <input
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          onChange={(event) => void loadFile(event.target.files?.[0])}
          className="block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:font-medium hover:file:bg-slate-200"
        />
        {fileName && <p className="text-xs text-slate-500 mt-2">選択中: {fileName}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-5">
          <Option label="全角英数字を半角へ統一" checked={options.normalizeWidth} onChange={(value) => setOptions({ ...options, normalizeWidth: value })} />
          <Option label="セル前後の空白を削除" checked={options.trimCells} onChange={(value) => setOptions({ ...options, trimCells: value })} />
          <Option label="空行を削除" checked={options.removeBlankRows} onChange={(value) => setOptions({ ...options, removeBlankRows: value })} />
          <Option label="完全一致の重複行を削除" checked={options.removeDuplicates} onChange={(value) => setOptions({ ...options, removeDuplicates: value })} />
        </div>

        <button onClick={run} className="btn-primary flex items-center gap-2 mt-5">
          <Sparkles className="w-4 h-4" />
          整形して検査する
        </button>
        {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}
      </section>

      {result && (
        <section className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Metric label="入力行" value={result.stats.inputRows} />
            <Metric label="出力行" value={result.stats.outputRows} />
            <Metric label="重複削除" value={result.stats.duplicatesRemoved} />
            <Metric label="空行削除" value={result.stats.blankRowsRemoved} />
            <Metric label="変更セル" value={result.stats.cellsChanged} />
          </div>

          {result.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h2 className="text-sm font-semibold text-amber-900">納品前の要確認</h2>
              <ul className="list-disc list-inside text-sm text-amber-800 mt-2 space-y-1">
                {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h2 className="font-semibold">先頭12行の確認</h2>
                <p className="text-xs text-slate-500 mt-1">列数の違う行がないか、文字が欠けていないかを目視してください。</p>
              </div>
              <button onClick={download} className="btn-primary flex items-center gap-2 shrink-0">
                <Download className="w-4 h-4" />
                CSVを納品用に保存
              </button>
            </div>
            <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--card-border)" }}>
              <table className="min-w-full text-xs">
                <tbody>
                  {preview.map((row, rowIndex) => (
                    <tr key={rowIndex} className={rowIndex === 0 ? "bg-slate-100 font-semibold" : "border-t"}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="px-3 py-2 whitespace-nowrap max-w-72 truncate" title={cell}>
                          {cell || <span className="text-slate-300">空欄</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <DataOpsEngine />
    </div>
  );
}

function Option({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--card-border)" }}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="accent-emerald-600" />
      {label}
    </label>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="card !p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-xl font-bold tabular-nums mt-1">{value.toLocaleString()}</p>
    </div>
  );
}
