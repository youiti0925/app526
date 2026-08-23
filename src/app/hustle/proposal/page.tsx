"use client";

import { useEffect, useState } from "react";
import {
  Handshake,
  Loader2,
  ShieldX,
  ShieldAlert,
  ShieldCheck,
  Copy,
  Check,
  Save,
  HelpCircle,
  TrendingDown,
} from "lucide-react";
import { useHustleStore } from "@/store/useHustleStore";
import StorageNotice from "@/components/hustle/StorageNotice";
import { PLATFORM_FEES } from "@/lib/hustle/payout";
import type { ScamScoreResult } from "@/lib/hustle/scam-rules";

interface TriageResponse {
  scam: ScamScoreResult;
  ai: {
    summary?: string;
    estimatedHours?: { low: number; high: number };
    offeredJpy?: number | null;
    fairRangeJpy?: { low: number; high: number };
    scopeRisks?: string[];
    missingTerms?: string[];
    fitNotes?: string;
    questions?: string[];
  } | null;
  aiError: string | null;
  hourly: { low: number; high: number } | null;
  grossHourly: { low: number; high: number } | null;
  netJpy: number | null;
  platform: { id: string; name: string; feeRate: number };
  rateVerdict: "unknown" | "below_minimum" | "thin" | "acceptable";
  recommendation: "reject" | "verify_first" | "proceed";
  recommendationReason: string;
  minWage: number;
  aiUsed: boolean;
}

interface Variant {
  angle: string;
  subject: string;
  body: string;
}

export default function ProposalPage() {
  const { load, addAsset, paths, meta } = useHustleStore();
  const [jobText, setJobText] = useState("");
  const [background, setBackground] = useState("");
  const [portfolio, setPortfolio] = useState("");
  const [pathId, setPathId] = useState("");
  const [platformId, setPlatformId] = useState("crowdworks");

  const [triage, setTriage] = useState<TriageResponse | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const saved = localStorage.getItem("hustle-background");
    if (saved) setBackground(saved);
  }, []);

  useEffect(() => {
    if (background) localStorage.setItem("hustle-background", background);
  }, [background]);

  async function analyze() {
    if (jobText.trim().length < 20) {
      setError("案件の本文を20文字以上入力してください");
      return;
    }
    setAnalyzing(true);
    setError(null);
    setVariants([]);
    try {
      const res = await fetch("/api/hustle/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobText, background, platformId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "分析に失敗しました");
      setTriage(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析に失敗しました");
    } finally {
      setAnalyzing(false);
    }
  }

  async function writeProposals() {
    setWriting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/hustle/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: "proposal",
          values: { jobText, myBackground: background, portfolio },
          count: 3,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "生成に失敗しました");
      setVariants(data.variants ?? []);
      setNotice(data.notice ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成に失敗しました");
    } finally {
      setWriting(false);
    }
  }

  return (
    <div className="p-8 max-w-5xl">
      <StorageNotice />

      <header className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Handshake className="w-6 h-6 text-emerald-600" />
          案件を判定して提案文をつくる
        </h1>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          応募する前に「そもそも受けていい案件か」を先に判定します。
          詐欺かどうか、実効時給が最低賃金を割らないか、範囲が膨らむ箇所はどこか。
          通ったものだけ提案文を3案つくります。
        </p>
      </header>

      <div className="card mb-6">
        <label className="block text-sm font-semibold mb-1">案件の募集文（全文）</label>
        <textarea
          value={jobText}
          onChange={(e) => setJobText(e.target.value)}
          rows={10}
          placeholder="ランサーズ・クラウドワークス・ココナラ・Indeed などの募集本文をそのまま貼り付け"
          className="w-full rounded-lg border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          style={{ borderColor: "var(--card-border)" }}
        />

        <label className="block text-sm font-semibold mb-1 mt-4">自分の経歴・できること</label>
        <textarea
          value={background}
          onChange={(e) => setBackground(e.target.value)}
          rows={4}
          placeholder="例: 製造業で7年、品質管理。Excelでの集計と手順書作成が得意。文章を書くのは苦にならない。"
          className="w-full rounded-lg border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          style={{ borderColor: "var(--card-border)" }}
        />
        <p className="text-xs text-slate-500 mt-1">この内容はこのブラウザに保存され、次回も引き継がれます。</p>

        <div className="flex flex-wrap items-center gap-3 mt-4">
          <label className="text-sm flex items-center gap-2">
            発注元
            <select
              value={platformId}
              onChange={(e) => setPlatformId(e.target.value)}
              className="rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--card-border)" }}
            >
              {PLATFORM_FEES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <button onClick={analyze} disabled={analyzing} className="btn-primary flex items-center gap-2 disabled:opacity-60">
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Handshake className="w-4 h-4" />}
            この案件を判定する
          </button>
          {!meta.aiEnabled && (
            <span className="text-xs text-slate-500">
              APIキー未設定でも詐欺判定は動きます（単価妥当性の分析にはキーが必要）
            </span>
          )}
        </div>
        {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}
      </div>

      {triage && (
        <TriageResult
          triage={triage}
          onWrite={writeProposals}
          writing={writing}
          portfolio={portfolio}
          setPortfolio={setPortfolio}
        />
      )}

      {notice && <p className="text-xs text-amber-700 my-3 leading-relaxed">{notice}</p>}

      {variants.length > 0 && (
        <section className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">提案文 3案</h2>
            {paths.length > 0 && (
              <select
                value={pathId}
                onChange={(e) => setPathId(e.target.value)}
                className="rounded-lg border px-3 py-1.5 text-sm"
                style={{ borderColor: "var(--card-border)" }}
              >
                <option value="">チャネル未指定</option>
                {paths.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="space-y-4">
            {variants.map((variant, i) => (
              <ProposalCard
                key={i}
                index={i}
                variant={variant}
                onSave={async () => {
                  await addAsset({
                    pathId: pathId || null,
                    kind: "proposal",
                    title: variant.subject || `提案文 案${i + 1}`,
                    body: variant.body,
                    meta: { angle: variant.angle, jobText: jobText.slice(0, 500) },
                    status: "draft",
                  });
                }}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function TriageResult({
  triage,
  onWrite,
  writing,
  portfolio,
  setPortfolio,
}: {
  triage: TriageResponse;
  onWrite: () => void;
  writing: boolean;
  portfolio: string;
  setPortfolio: (v: string) => void;
}) {
  const tone =
    triage.recommendation === "reject"
      ? { bg: "#fef2f2", border: "#fecaca", label: "受けない", Icon: ShieldX, color: "#dc2626" }
      : triage.recommendation === "verify_first"
        ? { bg: "#fffbeb", border: "#fde68a", label: "条件を確認してから", Icon: ShieldAlert, color: "#d97706" }
        : { bg: "#f8fafc", border: "#cbd5e1", label: "止める理由は見つからなかった", Icon: ShieldCheck, color: "#334155" };

  const { ai } = triage;

  return (
    <div className="rounded-xl border p-6 mb-6" style={{ background: tone.bg, borderColor: tone.border }}>
      <div className="flex items-center gap-3 mb-4">
        <tone.Icon className="w-6 h-6" style={{ color: tone.color }} />
        <div>
          <h2 className="text-lg font-bold" style={{ color: tone.color }}>
            {tone.label}
          </h2>
          <p className="text-sm text-slate-700 mt-0.5">{triage.recommendationReason}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Metric label="詐欺スコア" value={`${triage.scam.score}/100`} sub={triage.scam.verdict === "danger" ? "危険" : triage.scam.verdict === "caution" ? "要注意" : "既知の手口には未該当"} />
        <Metric
          label="想定作業時間"
          value={ai?.estimatedHours ? `${ai.estimatedHours.low}〜${ai.estimatedHours.high}時間` : "—"}
          sub={ai?.estimatedHours ? "修正・やりとり込み" : "AI分析なし"}
        />
        <Metric
          label={`実効時給（${triage.platform.name}の手数料 ${Math.round(triage.platform.feeRate * 100)}% 控除後）`}
          value={triage.hourly ? `${triage.hourly.low.toLocaleString()}〜${triage.hourly.high.toLocaleString()}円` : "判定できず"}
          sub={
            triage.hourly && triage.grossHourly
              ? `手数料込みなら ${triage.grossHourly.low.toLocaleString()}〜${triage.grossHourly.high.toLocaleString()}円 / 最低賃金 ${triage.minWage.toLocaleString()}円`
              : `最低賃金 ${triage.minWage.toLocaleString()}円`
          }
          warn={triage.rateVerdict === "below_minimum" || triage.rateVerdict === "thin"}
        />
      </div>

      {ai?.summary && (
        <div className="rounded-lg bg-white/80 p-3 mb-3">
          <p className="text-sm leading-relaxed">{ai.summary}</p>
        </div>
      )}

      {ai?.fairRangeJpy && (
        <div className="rounded-lg bg-white/80 p-3 mb-3 text-sm">
          <span className="font-semibold">妥当な報酬レンジ: </span>
          {ai.fairRangeJpy.low.toLocaleString()}〜{ai.fairRangeJpy.high.toLocaleString()}円
          {ai.offeredJpy != null && (
            <span className="text-slate-600">
              （提示額 {ai.offeredJpy.toLocaleString()}円
              {ai.offeredJpy < ai.fairRangeJpy.low && (
                <strong className="text-rose-600"> — 相場より低いので交渉の余地があります</strong>
              )}
              ）
            </span>
          )}
        </div>
      )}

      {triage.scam.signals.length > 0 && (
        <Section title={`危険シグナル（${triage.scam.signals.length}件）`}>
          <ul className="space-y-1.5">
            {[...triage.scam.signals]
              .sort((a, b) => b.weight - a.weight)
              .map((s, i) => (
                <li key={i} className="text-sm">
                  <span
                    className="text-xs font-bold px-1.5 py-0.5 rounded mr-2 text-white"
                    style={{ background: s.weight >= 9 ? "#dc2626" : s.weight >= 7 ? "#f59e0b" : "#64748b" }}
                  >
                    {s.weight}
                  </span>
                  <span className="font-medium">{s.label}</span>
                  <p className="text-xs text-slate-600 mt-0.5 ml-8 whitespace-pre-wrap">{s.why}</p>
                </li>
              ))}
          </ul>
        </Section>
      )}

      {(ai?.scopeRisks?.length ?? 0) > 0 && (
        <Section title="あとから作業が膨らむ箇所">
          <ul className="list-disc list-inside space-y-1 text-sm">
            {ai!.scopeRisks!.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Section>
      )}

      {(ai?.missingTerms?.length ?? 0) > 0 && (
        <Section title="着手前に必ず詰めること">
          <ul className="list-disc list-inside space-y-1 text-sm">
            {ai!.missingTerms!.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Section>
      )}

      {(ai?.questions?.length ?? 0) > 0 && <QuestionBlock questions={ai!.questions!} />}

      {ai?.fitNotes && <Section title="あなたの経歴との適合">{<p className="text-sm leading-relaxed">{ai.fitNotes}</p>}</Section>}

      {triage.aiError && (
        <p className="text-xs text-amber-700 mt-3">
          AI分析は使えませんでした: {triage.aiError}（詐欺判定の結果は有効です）
        </p>
      )}

      {triage.recommendation !== "reject" && (
        <div className="mt-5 pt-4 border-t" style={{ borderColor: tone.border }}>
          <label className="block text-sm font-medium mb-1">見せられる実績（あれば）</label>
          <input
            value={portfolio}
            onChange={(e) => setPortfolio(e.target.value)}
            placeholder="例: 自作サンプル、過去の納品物、GitHub。無ければ空欄でOK"
            className="w-full rounded-lg border px-3 py-2 text-sm mb-3"
            style={{ borderColor: "var(--card-border)" }}
          />
          <button onClick={onWrite} disabled={writing} className="btn-primary flex items-center gap-2 disabled:opacity-60">
            {writing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Handshake className="w-4 h-4" />}
            提案文を3案つくる
          </button>
        </div>
      )}

      {triage.recommendation === "reject" && (
        <div className="mt-5 pt-4 border-t text-sm" style={{ borderColor: tone.border }}>
          <p className="flex items-start gap-2">
            <TrendingDown className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" />
            <span>
              この案件に時間を使わないでください。提案文の生成は止めてあります。
              単価が理由の場合は、同じ時間で受けられる別案件を探すか、単価交渉を先に行ってください。
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-white/80 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${warn ? "text-rose-600" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white/80 p-3 mb-3">
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      {children}
    </div>
  );
}

function QuestionBlock({ questions }: { questions: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");

  return (
    <div className="rounded-lg bg-white/80 p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <HelpCircle className="w-4 h-4" />
          そのまま送れる確認質問
        </h3>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="btn-secondary !px-2.5 !py-1 text-xs flex items-center gap-1.5"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "コピーしました" : "コピー"}
        </button>
      </div>
      <ol className="list-decimal list-inside space-y-1 text-sm">
        {questions.map((q, i) => (
          <li key={i}>{q}</li>
        ))}
      </ol>
    </div>
  );
}

function ProposalCard({ index, variant, onSave }: { index: number; variant: Variant; onSave: () => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <span className="badge badge-info mb-1.5">案{index + 1}</span>
          {variant.angle && <p className="text-xs text-slate-500">切り口: {variant.angle}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(variant.body);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="btn-secondary !px-3 !py-1.5 text-xs flex items-center gap-1.5"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "コピーしました" : "コピー"}
          </button>
          <button
            onClick={async () => {
              await onSave();
              setSaved(true);
              setTimeout(() => setSaved(false), 1500);
            }}
            className="btn-secondary !px-3 !py-1.5 text-xs flex items-center gap-1.5"
          >
            {saved ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Save className="w-3.5 h-3.5" />}
            {saved ? "保存しました" : "保存"}
          </button>
        </div>
      </div>
      <pre className="text-sm whitespace-pre-wrap leading-relaxed font-sans bg-slate-50 rounded-lg p-3 border" style={{ borderColor: "var(--card-border)" }}>
        {variant.body}
      </pre>
    </div>
  );
}
