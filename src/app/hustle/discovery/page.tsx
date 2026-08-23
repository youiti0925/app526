"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Telescope,
  Loader2,
  ExternalLink,
  Terminal,
  ShieldQuestion,
  TrendingDown,
  Play,
  Pause,
  X,
} from "lucide-react";
import StorageNotice from "@/components/hustle/StorageNotice";
import { CHANNEL_LABELS, CHANNEL_NOTES, type Discovery } from "@/lib/hustle/agent/discovery-core";

const STATUS_LABELS: Record<Discovery["status"], string> = {
  new: "未着手",
  trying: "やってみている",
  parked: "保留",
  dropped: "やめた",
};

export default function DiscoveryPage() {
  const [discoveries, setDiscoveries] = useState<Discovery[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/hustle/agent/discovery?format=json");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "読み込みに失敗しました");
      setDiscoveries(data.discoveries ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      setDiscoveries([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(id: string, status: Discovery["status"]) {
    setDiscoveries((list) => list?.map((d) => (d.id === id ? { ...d, status } : d)) ?? null);
    const res = await fetch("/api/hustle/agent/discovery", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (!res.ok) void load();
    else if (status === "dropped") void load();
  }

  if (!discoveries) {
    return (
      <div className="max-w-4xl mx-auto p-6 flex items-center gap-2 text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        読み込み中…
      </div>
    );
  }

  const passed = discoveries.filter((d) => d.meetsBar);
  const failed = discoveries.filter((d) => !d.meetsBar);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <StorageNotice />

      <div className="mb-5">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Telescope className="w-5 h-5 text-emerald-600" />
          市場を探す
        </h1>
        <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
          このアプリの他の画面は「来た案件を裁く」ためのものです。ここだけは違って、
          <strong>募集として公開されていない仕事</strong>を探しに行った結果を並べます。
          実効時給が高い仕事ほど募集一覧に出てこないので、待っているだけでは見つかりません。
        </p>
      </div>

      <HowToRun />

      {error && (
        <div className="card mb-4 border-rose-300 bg-rose-50 text-sm text-rose-700">{error}</div>
      )}

      {discoveries.length === 0 && !error && (
        <div className="card text-sm text-slate-600 leading-relaxed">
          まだ何も探していません。上のコマンドを実行すると、ここに結果が並びます。
        </div>
      )}

      {passed.length > 0 && (
        <section className="mb-6">
          <h2 className="font-semibold text-sm mb-2">基準を満たした市場（{passed.length}件）</h2>
          <div className="space-y-3">
            {passed.map((d) => (
              <Card key={d.id} d={d} onStatus={setStatus} />
            ))}
          </div>
        </section>
      )}

      {failed.length > 0 && (
        <section>
          <h2 className="font-semibold text-sm mb-1 flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-slate-400" />
            調べたが割に合わなかった市場（{failed.length}件）
          </h2>
          <p className="text-xs text-slate-500 mb-2 leading-relaxed">
            消さずに残しています。同じ市場を何度も調べ直さないためです。
          </p>
          <div className="space-y-3 opacity-70">
            {failed.map((d) => (
              <Card key={d.id} d={d} onStatus={setStatus} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function HowToRun() {
  return (
    <div className="card mb-4">
      <h2 className="font-semibold text-sm mb-1 flex items-center gap-2">
        <Terminal className="w-4 h-4 text-emerald-600" />
        探しに行かせる
      </h2>
      <p className="text-xs text-slate-500 mb-2 leading-relaxed">
        アプリを起動したまま、別のターミナルで実行してください。
        Web を実際に見に行くので、1回に数分かかります。
      </p>
      <pre className="rounded-lg bg-slate-900 text-slate-100 p-3 text-xs overflow-x-auto">
        npm run claude-batch -- --discover
      </pre>
      <p className="text-xs text-slate-500 mt-2 leading-relaxed">
        <code className="text-slate-700">--dry-run</code> を足すと、何も呼ばずに指示書だけを表示します。
        認証は Claude.ai のサブスクで通ります（一度 <code className="text-slate-700">claude</code> を対話で起動して
        <code className="text-slate-700"> /login</code> すれば、APIクレジットは要りません）。
      </p>
    </div>
  );
}

function Card({
  d,
  onStatus,
}: {
  d: Discovery;
  onStatus: (id: string, status: Discovery["status"]) => void;
}) {
  const rate = d.hourlyJpy
    ? `${d.hourlyJpy.low.toLocaleString()}〜${d.hourlyJpy.high.toLocaleString()}円/時`
    : "時給は計算できていません";

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm">{d.title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {CHANNEL_LABELS[d.channel]} — {CHANNEL_NOTES[d.channel]}
          </p>
        </div>
        <span
          className={`shrink-0 text-xs font-bold px-2 py-1 rounded tabular-nums ${
            d.meetsBar ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"
          }`}
        >
          {rate}
        </span>
      </div>

      <dl className="mt-3 text-xs space-y-1.5">
        <Row label="相場">
          {d.priceJpy.low.toLocaleString()}〜{d.priceJpy.high.toLocaleString()}円
          {d.priceUnit && `（${d.priceUnit}）`} / 想定 {d.estimatedHours.low}〜{d.estimatedHours.high}時間
        </Row>
        <Row label="需要">{d.demandSignal || "（根拠なし）"}</Row>
        <Row label="競合">{d.supplySignal || "（根拠なし）"}</Row>
        <Row label="AIに潰されない理由">{d.whyAiCannotKill || "（説明なし）"}</Row>
        <Row label="資格の壁">{d.qualificationBarrier}</Row>
        {d.timeToFirstYen && <Row label="最初の1円まで">{d.timeToFirstYen}</Row>}
        {d.evidence && <Row label="見たもの">{d.evidence}</Row>}
      </dl>

      {d.firstStep && (
        <p className="mt-3 text-sm rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 leading-relaxed">
          <strong className="text-emerald-800">明日やる1手:</strong> {d.firstStep}
        </p>
      )}

      <p className="mt-2 text-xs text-slate-600 leading-relaxed">{d.note}</p>

      {d.confidence !== "high" && (
        <p className="mt-2 text-xs text-amber-700 flex items-start gap-1.5 leading-relaxed">
          <ShieldQuestion className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          確信度 {d.confidence}。動く前に自分で裏を取ってください。
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {d.url && (
          <a
            href={d.url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1 text-emerald-700 underline"
          >
            <ExternalLink className="w-3 h-3" />
            根拠のページ
          </a>
        )}
        <span className="text-slate-400">状態: {STATUS_LABELS[d.status]}</span>
        <div className="ml-auto flex gap-1.5">
          <StatusButton current={d.status} value="trying" onClick={() => onStatus(d.id, "trying")}>
            <Play className="w-3 h-3" />
            やる
          </StatusButton>
          <StatusButton current={d.status} value="parked" onClick={() => onStatus(d.id, "parked")}>
            <Pause className="w-3 h-3" />
            保留
          </StatusButton>
          <StatusButton current={d.status} value="dropped" onClick={() => onStatus(d.id, "dropped")}>
            <X className="w-3 h-3" />
            やめる
          </StatusButton>
        </div>
      </div>
    </div>
  );
}

function StatusButton({
  current,
  value,
  onClick,
  children,
}: {
  current: Discovery["status"];
  value: Discovery["status"];
  onClick: () => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded border transition-colors ${
        active ? "bg-slate-800 text-white border-slate-800" : "hover:bg-slate-100"
      }`}
      style={active ? undefined : { borderColor: "var(--card-border)" }}
    >
      {children}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 w-36 text-slate-500">{label}</dt>
      <dd className="flex-1 text-slate-700 leading-relaxed">{children}</dd>
    </div>
  );
}
