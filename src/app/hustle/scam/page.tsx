"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, ShieldCheck, ShieldX, Loader2, Phone } from "lucide-react";
import { useHustleStore } from "@/store/useHustleStore";
import StorageNotice from "@/components/hustle/StorageNotice";
import type { ScamCheck } from "@/lib/hustle/types";

const SAMPLE = `【急募】スマホ1台で誰でも月収50万円！
AIが自動で稼いでくれる最新システムを提供します。
初心者でも必ず稼げます。1日10分のコピペ作業だけ。
まずは公式LINEにご登録ください。詳細は登録後にお伝えします。
※本日限定 残り3名様
※初期費用として教材費19,800円が必要です（すぐに回収できます）`;

export default function ScamCheckPage() {
  const { load, recordScamCheck, scamChecks, meta } = useHustleStore();
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [result, setResult] = useState<ScamCheck | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  async function run() {
    if (text.trim().length < 10) {
      setError("判定する本文を10文字以上入力してください");
      return;
    }
    setLoading(true);
    setError(null);
    setAiError(null);
    try {
      const res = await fetch("/api/hustle/scam-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "判定に失敗しました");
      setResult(data.check);
      setAiError(data.aiError ?? null);
      recordScamCheck(data.check);
    } catch (e) {
      setError(e instanceof Error ? e.message : "判定に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-5xl">
      <StorageNotice />

      <header className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldAlert className="w-6 h-6 text-rose-600" />
          詐欺・搾取案件チェック
        </h1>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          怪しい募集文・DM・LINEのメッセージをそのまま貼り付けてください。
          法令と消費者被害の典型手口に照らして危険度を判定します。
          <strong className="text-slate-900">お金がないときほど狙われます。着手する前に必ずここを通してください。</strong>
        </p>
      </header>

      <div className="card mb-6">
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-semibold">募集文・メッセージの全文</label>
          <button
            onClick={() => setText(SAMPLE)}
            className="text-xs text-slate-500 hover:text-slate-800 hover:underline"
          >
            サンプルを入れて試す
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder="ここに募集文をそのまま貼り付け（省略せず全部貼るほど精度が上がります）"
          className="w-full rounded-lg border p-3 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-500"
          style={{ borderColor: "var(--card-border)" }}
        />
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="どこで見つけたか（X のDM、Indeed、知人の紹介 など）"
            className="flex-1 min-w-56 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            style={{ borderColor: "var(--card-border)" }}
          />
          <button onClick={run} disabled={loading} className="btn-primary flex items-center gap-2 disabled:opacity-60">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
            判定する
          </button>
        </div>
        {!meta.aiEnabled && (
          <p className="text-xs text-slate-500 mt-2">
            AIキー未設定でもルールベース判定は動きます（設定するとAIによる追加チェックが入ります）。
          </p>
        )}
        {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
        {aiError && <p className="text-xs text-amber-600 mt-2">AI補助は使えませんでした: {aiError}（ルール判定の結果は有効です）</p>}
      </div>

      {result && <ResultCard check={result} />}

      {scamChecks.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-slate-500 mb-3">これまでの判定</h2>
          <div className="space-y-2">
            {scamChecks.slice(0, 10).map((c) => (
              <button
                key={c.id}
                onClick={() => setResult(c)}
                className="w-full text-left card !py-3 hover:border-emerald-400 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <VerdictBadge verdict={c.verdict} score={c.score} />
                  <span className="text-sm text-slate-700 truncate flex-1">
                    {c.source ? `[${c.source}] ` : ""}
                    {c.text.slice(0, 60)}…
                  </span>
                  <span className="text-xs text-slate-400 shrink-0">
                    {new Date(c.createdAt).toLocaleDateString("ja-JP")}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function VerdictBadge({ verdict, score }: { verdict: ScamCheck["verdict"]; score: number }) {
  const map = {
    danger: { cls: "badge-danger", label: "危険", Icon: ShieldX },
    caution: { cls: "badge-warning", label: "要注意", Icon: ShieldAlert },
    safe: { cls: "badge-success", label: "明確な危険なし", Icon: ShieldCheck },
  } as const;
  const { cls, label, Icon } = map[verdict];
  return (
    <span className={`badge ${cls} gap-1 shrink-0`}>
      <Icon className="w-3.5 h-3.5" />
      {label} {score}
    </span>
  );
}

function ResultCard({ check }: { check: ScamCheck }) {
  const tone =
    check.verdict === "danger"
      ? { bg: "#fef2f2", border: "#fecaca", bar: "#ef4444" }
      : check.verdict === "caution"
        ? { bg: "#fffbeb", border: "#fde68a", bar: "#f59e0b" }
        : { bg: "#f0fdf4", border: "#bbf7d0", bar: "#10b981" };

  const sorted = [...check.signals].sort((a, b) => b.weight - a.weight);

  return (
    <div className="rounded-xl border p-6" style={{ background: tone.bg, borderColor: tone.border }}>
      <div className="flex items-center gap-4 mb-4">
        <VerdictBadge verdict={check.verdict} score={check.score} />
        <div className="flex-1">
          <div className="progress-bar">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${check.score}%`, background: tone.bar }}
            />
          </div>
        </div>
        <span className="text-2xl font-bold tabular-nums" style={{ color: tone.bar }}>
          {check.score}
          <span className="text-sm font-normal text-slate-500">/100</span>
        </span>
      </div>

      <div className="rounded-lg bg-white/80 p-4 mb-4">
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{check.advice}</p>
      </div>

      {sorted.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold mb-2">検出された危険シグナル（{sorted.length}件）</h3>
          <ul className="space-y-2">
            {sorted.map((s, i) => (
              <li key={`${s.id}-${i}`} className="rounded-lg bg-white/80 p-3">
                <div className="flex items-start gap-2">
                  <span
                    className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0 text-white"
                    style={{ background: s.weight >= 9 ? "#dc2626" : s.weight >= 7 ? "#f59e0b" : "#64748b" }}
                  >
                    {s.weight}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{s.label}</p>
                    <p className="text-xs text-slate-600 mt-1 whitespace-pre-wrap leading-relaxed">{s.why}</p>
                    {s.excerpt && (
                      <p className="text-xs text-slate-500 mt-1.5 font-mono bg-slate-100 rounded px-2 py-1 break-all">
                        {s.excerpt}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-slate-600">既知の危険シグナルは検出されませんでした。</p>
      )}

      <div className="mt-4 rounded-lg bg-white/80 p-3 text-xs text-slate-600 flex items-start gap-2">
        <Phone className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          迷ったら契約前に無料で相談できます —
          <strong className="text-slate-900"> 消費者ホットライン 188</strong>（局番なし） /
          <strong className="text-slate-900"> 警察相談専用電話 #9110</strong>。
          この判定はあくまで補助であり、安全を保証するものではありません。
        </span>
      </div>
    </div>
  );
}
