"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FlaskConical,
  Loader2,
  Terminal,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ExternalLink,
} from "lucide-react";
import StorageNotice from "@/components/hustle/StorageNotice";
import {
  EVIDENCE_LABELS,
  VERDICT_LABELS,
  getGenreTarget,
  type DryRun,
  type DryRunVerdict,
  type Evidence,
} from "@/lib/hustle/agent/dryrun-core";
import type { Capability } from "@/lib/hustle/agent/deliverability";

interface Payload {
  dryRuns: DryRun[];
  evidence: { genre: Capability; evidence: Evidence; runs: number }[];
  contradictions: { genre: Capability; claim: string; evidence: Evidence; note: string }[];
  untested: { genre: Capability; label: string; claim: string }[];
}

const VERDICT_STYLE: Record<DryRunVerdict, { icon: typeof CheckCircle2; className: string }> = {
  pass: { icon: CheckCircle2, className: "bg-emerald-100 text-emerald-800" },
  needs_work: { icon: AlertTriangle, className: "bg-amber-100 text-amber-800" },
  fail: { icon: XCircle, className: "bg-rose-100 text-rose-800" },
  cannot_produce: { icon: XCircle, className: "bg-slate-200 text-slate-700" },
};

const EVIDENCE_STYLE: Record<Evidence, string> = {
  proven: "bg-emerald-100 text-emerald-800",
  needs_human: "bg-amber-100 text-amber-800",
  disproven: "bg-rose-100 text-rose-800",
  untested: "bg-slate-200 text-slate-600",
};

export default function DryRunPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/hustle/agent/dryrun?format=json");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "読み込みに失敗しました");
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data && !error) {
    return (
      <div className="max-w-4xl mx-auto p-6 flex items-center gap-2 text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        読み込み中…
      </div>
    );
  }

  const runs = data?.dryRuns ?? [];
  const graded = runs.filter((r) => r.grade);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <StorageNotice />

      <div className="mb-5">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-emerald-600" />
          試作の検証
        </h1>
        <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
          「AIで作れる／作れない」の判定は、もともと根拠のない主張でした。ここでは
          <strong>実在する案件を疑似的に受注して、実際に成果物を作り、別の目で採点します。</strong>
          合格したジャンルだけを「実証済み」にします。作れないと主張しているジャンルも必ず試します
          （試さないと、取れたはずの仕事を捨て続けることになるため）。
        </p>
      </div>

      <HowToRun />

      {error && <div className="card mb-4 border-rose-300 bg-rose-50 text-sm text-rose-700">{error}</div>}

      {data && data.contradictions.length > 0 && (
        <div className="card mb-4 border-amber-300 bg-amber-50">
          <h2 className="font-semibold text-sm mb-2 flex items-center gap-2 text-amber-900">
            <AlertTriangle className="w-4 h-4" />
            主張と結果が食い違っています（{data.contradictions.length}件）
          </h2>
          <ul className="text-sm space-y-2 text-amber-900">
            {data.contradictions.map((c) => (
              <li key={c.genre} className="leading-relaxed">
                <strong>{getGenreTarget(c.genre)?.label ?? c.genre}</strong>: {c.note}
              </li>
            ))}
          </ul>
          <p className="text-xs text-amber-800 mt-2">
            ここが、判定ロジックを直すべき箇所です。
          </p>
        </div>
      )}

      {data && data.evidence.length > 0 && (
        <div className="card mb-4">
          <h2 className="font-semibold text-sm mb-2">ジャンルごとの検証状況</h2>
          <div className="flex flex-wrap gap-2">
            {data.evidence.map((e) => (
              <span
                key={e.genre}
                className={`text-xs px-2 py-1 rounded ${EVIDENCE_STYLE[e.evidence]}`}
                title={EVIDENCE_LABELS[e.evidence]}
              >
                {getGenreTarget(e.genre)?.label ?? e.genre}: {EVIDENCE_LABELS[e.evidence]}
              </span>
            ))}
            {data.untested.map((u) => (
              <span key={u.genre} className={`text-xs px-2 py-1 rounded ${EVIDENCE_STYLE.untested}`}>
                {u.label}: 未検証
              </span>
            ))}
          </div>
        </div>
      )}

      {runs.length === 0 && !error && (
        <div className="card text-sm text-slate-600 leading-relaxed">
          まだ試作していません。上のコマンドを実行すると、実案件の成果物を作って採点します。
        </div>
      )}

      <div className="space-y-3">
        {runs.map((run) => (
          <RunCard key={run.id} run={run} open={open === run.id} onToggle={() => setOpen(open === run.id ? null : run.id)} />
        ))}
      </div>

      {graded.length > 0 && (
        <p className="text-xs text-slate-500 mt-4 leading-relaxed">
          採点は、成果物を作ったのとは別のプロセスで行っています。同じ文脈で採点させると、
          自分が作ったものなので甘い点がつくためです。さらに「そのまま納品できる」なのに
          人の作業が何時間も残っている、といった矛盾はこちらで検算して落としています。
        </p>
      )}
    </div>
  );
}

function HowToRun() {
  return (
    <div className="card mb-4">
      <h2 className="font-semibold text-sm mb-1 flex items-center gap-2">
        <Terminal className="w-4 h-4 text-emerald-600" />
        試作を回す
      </h2>
      <pre className="rounded-lg bg-slate-900 text-slate-100 p-3 text-xs overflow-x-auto">
        npm run claude-batch -- --trial
      </pre>
      <p className="text-xs text-slate-500 mt-2 leading-relaxed">
        成果物を作る工程と採点する工程を、続けて別々に回します。
        <code className="text-slate-700">--produce</code> と{" "}
        <code className="text-slate-700">--grade</code> で片方だけ回すこともできます。
        成果物のファイルが散らかるので、作業用のディレクトリで実行してください。
      </p>
    </div>
  );
}

function RunCard({ run, open, onToggle }: { run: DryRun; open: boolean; onToggle: () => void }) {
  const target = getGenreTarget(run.genre);
  const grade = run.grade;
  const style = grade ? VERDICT_STYLE[grade.verdict] : null;
  const Icon = style?.icon ?? HelpCircle;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
              {target?.label ?? run.genre}
            </span>
            <span className="text-xs text-slate-500">
              主張: {target?.claim === "can" ? "作れる" : "作れない"}
            </span>
          </div>
          <h3 className="font-semibold text-sm mt-1.5">{run.title || "（タイトルなし）"}</h3>
        </div>
        <span
          className={`shrink-0 text-xs font-bold px-2 py-1 rounded flex items-center gap-1 ${
            style?.className ?? "bg-slate-100 text-slate-600"
          }`}
        >
          <Icon className="w-3 h-3" />
          {grade ? VERDICT_LABELS[grade.verdict] : run.status === "produced" ? "採点待ち" : "未着手"}
        </span>
      </div>

      {grade && (
        <dl className="mt-3 text-xs space-y-1.5">
          <Row label="要求充足度">{grade.meetsRequirement} / 100</Row>
          <Row label="納品までの人の作業">{grade.humanHoursNeeded}時間</Row>
          {grade.gaps.length > 0 && <Row label="足りない点">{grade.gaps.join(" / ")}</Row>}
          {grade.needsFactCheck.length > 0 && (
            <Row label="裏取りが必要">{grade.needsFactCheck.join(" / ")}</Row>
          )}
          <Row label="判定理由">{grade.reason}</Row>
        </dl>
      )}

      {run.blockedReason && (
        <p className="mt-2 text-xs text-rose-700 leading-relaxed">作れなかった理由: {run.blockedReason}</p>
      )}

      <div className="mt-3 flex items-center gap-3 text-xs">
        {run.sourceUrl && (
          <a
            href={run.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1 text-emerald-700 underline"
          >
            <ExternalLink className="w-3 h-3" />
            元の募集
          </a>
        )}
        {(run.artifact || run.method) && (
          <button onClick={onToggle} className="underline text-slate-600 hover:text-slate-900">
            {open ? "成果物を閉じる" : `成果物を見る（${run.artifact.length.toLocaleString()}文字）`}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          {run.method && (
            <div>
              <p className="text-xs font-medium text-slate-600 mb-1">作った手段</p>
              <pre className="text-xs whitespace-pre-wrap rounded-lg bg-slate-50 border p-3 overflow-x-auto" style={{ borderColor: "var(--card-border)" }}>
                {run.method}
              </pre>
            </div>
          )}
          {run.artifact && (
            <div>
              <p className="text-xs font-medium text-slate-600 mb-1">成果物</p>
              <pre className="text-xs whitespace-pre-wrap rounded-lg bg-slate-50 border p-3 max-h-[32rem] overflow-auto" style={{ borderColor: "var(--card-border)" }}>
                {run.artifact}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
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
