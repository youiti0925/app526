"use client";

import { useEffect, useState } from "react";
import { Layers, Loader2, ShieldX, ShieldAlert, ShieldCheck, ArrowRight } from "lucide-react";
import Link from "next/link";
import StorageNotice from "@/components/hustle/StorageNotice";
import { useHustleStore } from "@/store/useHustleStore";

interface BatchItem {
  index: number;
  excerpt: string;
  scamScore: number;
  scamVerdict: "safe" | "caution" | "danger";
  recommendation: "reject" | "verify_first" | "proceed";
  recommendationReason: string;
  hourly: { low: number; high: number } | null;
  offeredJpy: number | null;
  estimatedHours: { low: number; high: number } | null;
  error?: string;
}

const SEPARATOR = /^\s*---+\s*$/m;

export default function BatchPage() {
  const { load, meta } = useHustleStore();
  const [raw, setRaw] = useState("");
  const [items, setItems] = useState<BatchItem[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [background, setBackground] = useState("");

  useEffect(() => {
    void load();
    setBackground(localStorage.getItem("hustle-background") ?? "");
  }, [load]);

  const chunks = raw
    .split(SEPARATOR)
    .map((c) => c.trim())
    .filter((c) => c.length >= 20);

  async function run() {
    if (chunks.length === 0) {
      setError("案件を1件以上入力してください（20文字以上）");
      return;
    }
    setError(null);
    setItems([]);
    setProgress({ done: 0, total: chunks.length });

    const results: BatchItem[] = [];
    for (let i = 0; i < chunks.length; i++) {
      try {
        const res = await fetch("/api/hustle/triage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobText: chunks[i], background }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "分析に失敗しました");
        results.push({
          index: i,
          excerpt: chunks[i].slice(0, 80).replace(/\s+/g, " "),
          scamScore: data.scam.score,
          scamVerdict: data.scam.verdict,
          recommendation: data.recommendation,
          recommendationReason: data.recommendationReason,
          hourly: data.hourly,
          offeredJpy: data.ai?.offeredJpy ?? null,
          estimatedHours: data.ai?.estimatedHours ?? null,
        });
      } catch (e) {
        results.push({
          index: i,
          excerpt: chunks[i].slice(0, 80).replace(/\s+/g, " "),
          scamScore: 0,
          scamVerdict: "safe",
          recommendation: "verify_first",
          recommendationReason: "分析に失敗しました",
          hourly: null,
          offeredJpy: null,
          estimatedHours: null,
          error: e instanceof Error ? e.message : "不明なエラー",
        });
      }
      setProgress({ done: i + 1, total: chunks.length });
      setItems([...results]);

      // 無料枠のレート制限に当たらないよう、間隔を空ける
      if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 4500));
    }
    setProgress(null);
  }

  // 受けてよいものを、実効時給の高い順に
  const sorted = [...items].sort((a, b) => {
    const rank = { proceed: 0, verify_first: 1, reject: 2 };
    if (rank[a.recommendation] !== rank[b.recommendation]) {
      return rank[a.recommendation] - rank[b.recommendation];
    }
    return (b.hourly?.low ?? -1) - (a.hourly?.low ?? -1);
  });

  return (
    <div className="p-8 max-w-5xl">
      <StorageNotice />

      <header className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Layers className="w-6 h-6 text-emerald-600" />
          複数の案件をまとめて判定
        </h1>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          案件を1件ずつ読んで判断していると、それだけで週に何時間も消えます。
          まとめて貼り付けると、詐欺判定と実効時給の見込みで並べ替えます。
          <strong className="text-slate-900">上から順に応募すれば、選ぶ時間はゼロになります。</strong>
        </p>
      </header>

      <div className="card mb-6">
        <label className="block text-sm font-semibold mb-1">
          案件をまとめて貼り付け（案件と案件のあいだに <code className="bg-slate-100 px-1 rounded">---</code> の行を入れる）
        </label>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={14}
          placeholder={`1件目の募集文…\n\n---\n\n2件目の募集文…\n\n---\n\n3件目の募集文…`}
          className="w-full rounded-lg border p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
          style={{ borderColor: "var(--card-border)" }}
        />
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <button
            onClick={run}
            disabled={progress !== null}
            className="btn-primary flex items-center gap-2 disabled:opacity-60"
          >
            {progress ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
            {progress ? `判定中 ${progress.done}/${progress.total}` : `${chunks.length}件を判定する`}
          </button>
          <span className="text-xs text-slate-500">
            {meta.aiEnabled
              ? "無料枠のレート制限を避けるため、1件ずつ約4.5秒あけて処理します"
              : "APIキー未設定のため、詐欺判定のみ実行されます（単価分析にはキーが必要）"}
          </span>
        </div>
        {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
      </div>

      {items.length > 0 && (
        <section>
          <h2 className="font-semibold mb-3">判定結果（おすすめ順）</h2>
          <div className="space-y-2">
            {sorted.map((item) => (
              <BatchRow key={item.index} item={item} />
            ))}
          </div>
          <p className="text-sm text-slate-600 mt-4">
            応募したい案件が決まったら、
            <Link href="/hustle/proposal" className="text-emerald-700 hover:underline mx-1">
              案件を判定・提案
            </Link>
            で提案文を3案つくってください。
          </p>
        </section>
      )}
    </div>
  );
}

function BatchRow({ item }: { item: BatchItem }) {
  const tone =
    item.recommendation === "reject"
      ? { cls: "badge-danger", label: "受けない", Icon: ShieldX }
      : item.recommendation === "verify_first"
        ? { cls: "badge-warning", label: "要確認", Icon: ShieldAlert }
        : { cls: "badge-info", label: "止める理由なし", Icon: ShieldCheck };

  return (
    <div className="card !py-3">
      <div className="flex items-start gap-3">
        <span className="text-xs text-slate-400 tabular-nums shrink-0 mt-1">#{item.index + 1}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-slate-700 truncate">{item.excerpt}…</p>
            <span className={`badge ${tone.cls} gap-1 shrink-0`}>
              <tone.Icon className="w-3.5 h-3.5" />
              {tone.label}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-slate-500">
            <span>詐欺スコア {item.scamScore}/100</span>
            {item.offeredJpy != null && <span>提示 {item.offeredJpy.toLocaleString()}円</span>}
            {item.estimatedHours && (
              <span>
                想定 {item.estimatedHours.low}〜{item.estimatedHours.high}時間
              </span>
            )}
            {item.hourly && (
              <span className={item.hourly.high < 1121 ? "text-rose-600 font-medium" : "text-emerald-700 font-medium"}>
                実効時給 {item.hourly.low.toLocaleString()}〜{item.hourly.high.toLocaleString()}円
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            {item.error ? `エラー: ${item.error}` : item.recommendationReason}
          </p>
        </div>
      </div>
    </div>
  );
}
