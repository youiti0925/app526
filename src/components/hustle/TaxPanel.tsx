"use client";

import { useMemo, useState } from "react";
import { Receipt, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { EXPENSE_HINTS, summarizeTax } from "@/lib/hustle/tax";
import type { HustleEntry } from "@/lib/hustle/types";

const FLAG_CLASS: Record<string, string> = {
  no_records: "badge-info",
  under_threshold: "badge-success",
  near_threshold: "badge-warning",
  over_threshold: "badge-danger",
};

/**
 * 税金の目安。
 *
 * ここが無かったので、tax.ts は書かれていたのに一度も画面に出ていませんでした。
 * 副業で一番よくある事故が「20万円以下なら申告不要」の誤解で、
 * これは所得税だけの話です。住民税の申告は金額に関係なく必要で、
 * 放置すると後から追徴が来ます。出しておくべきものでした。
 */
export default function TaxPanel({ entries }: { entries: HustleEntry[] }) {
  const [openHints, setOpenHints] = useState(false);
  const year = new Date().getFullYear();

  const summary = useMemo(() => {
    const ofYear = entries.filter((e) => e.date.startsWith(`${year}-`));
    // 売上は入金済みだけ。未入金は今年の所得ではありません。
    const revenueJpy = ofYear
      .filter((e) => e.kind === "income" && e.settled)
      .reduce((a, e) => a + e.amountJpy, 0);
    const expenseJpy = ofYear
      .filter((e) => e.kind === "expense")
      .reduce((a, e) => a + e.amountJpy, 0);
    return summarizeTax({
      revenueJpy,
      expenseJpy,
      hasExpenseRecords: ofYear.some((e) => e.kind === "expense"),
      // 給与所得がある前提（20万円の特例が使えるのは給与所得者だけ）。
      // 該当しない場合は下の注意書きで案内します。
      isEmployee: true,
    });
  }, [entries, year]);

  return (
    <section className="card mb-6">
      <h2 className="font-semibold mb-1 flex items-center gap-2">
        <Receipt className="w-4 h-4" />
        {year}年の税金の目安
        <span className={`badge ${FLAG_CLASS[summary.flag] ?? "badge-info"}`}>
          所得 {summary.incomeJpy.toLocaleString()}円
        </span>
      </h2>
      <p className="text-xs text-slate-500 mb-3">
        売上 {summary.revenueJpy.toLocaleString()}円 − 経費 {summary.expenseJpy.toLocaleString()}円
        （入金済みのものだけ。未入金は今年の所得に入れていません）
      </p>

      <p className="text-sm leading-relaxed mb-3">{summary.note}</p>

      {summary.warnings.map((w, i) => (
        <p key={i} className="text-sm text-amber-800 leading-relaxed flex gap-2 mb-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{w.replace(/\*\*/g, "")}</span>
        </p>
      ))}

      {summary.todo.length > 0 && (
        <>
          <h3 className="text-sm font-medium mt-3 mb-1">やること</h3>
          <ul className="text-sm space-y-1 list-disc pl-5 leading-relaxed">
            {summary.todo.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </>
      )}

      <button
        onClick={() => setOpenHints((v) => !v)}
        className="btn-ghost text-xs mt-3 flex items-center gap-1"
      >
        {openHints ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        経費に入れられるものの例
      </button>
      {openHints && (
        <ul className="text-xs mt-2 space-y-1.5 leading-relaxed">
          {EXPENSE_HINTS.map((h) => (
            <li key={h.label}>
              <span className="font-medium">{h.label}</span>
              <span className="text-slate-600"> — {h.note}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-slate-500 mt-3 leading-relaxed">
        給与所得が無い場合、20万円の特例は使えません。
        金額が近づいたら税務署（無料相談があります）か税理士に確認してください。
        ここは記録された数字からの目安で、判断はしていません。
      </p>
    </section>
  );
}
