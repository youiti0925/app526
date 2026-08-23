"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Bot,
  Play,
  Loader2,
  Inbox,
  Plus,
  Rss,
  Brain,
  ScrollText,
  AlertTriangle,
  CheckCircle2,
  Info,
  Zap,
} from "lucide-react";
import StorageNotice from "@/components/hustle/StorageNotice";
import { STEP_LABELS, type AgentConfig, type AgentEvent, type AgentRun, type StepId } from "@/lib/hustle/agent/types";

interface AgentState {
  config: AgentConfig;
  runs: AgentRun[];
  lastRun: AgentRun | null;
  events: AgentEvent[];
  inboxCount: number;
  runsToday: number;
  leads: { new: number; triaged: number; drafted: number; rejected: number };
  aiEnabled: boolean;
}

const STEP_ORDER: StepId[] = ["ingest", "triage", "draft", "plan", "review", "learn"];

export default function AgentPage() {
  const [state, setState] = useState<AgentState | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/hustle/agent/state");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "読み込みに失敗しました");
      setState(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patchConfig(patch: Partial<AgentConfig>) {
    const res = await fetch("/api/hustle/agent/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = await res.json();
      setState((s) => (s ? { ...s, config: data.config } : s));
    }
  }

  async function runNow() {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/hustle/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "manual", force: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "実行に失敗しました");
      setNotice(data.ran ? data.result.run.summary : `実行しませんでした: ${data.reason}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "実行に失敗しました");
    } finally {
      setRunning(false);
    }
  }

  if (!state) {
    return (
      <div className="p-8 max-w-4xl">
        <StorageNotice />
        <p className="text-sm text-slate-500">{error ?? "読み込み中…"}</p>
      </div>
    );
  }

  const { config } = state;

  return (
    <div className="p-8 max-w-4xl">
      <StorageNotice />

      <header className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bot className="w-6 h-6 text-emerald-600" />
          自律運転
        </h1>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          案件の取り込み・判定・下書き・計画の組み直し・収支レビュー・自己調整を、まとめて回します。
          結果は<Link href="/hustle/inbox" className="text-emerald-700 hover:underline mx-1">承認キュー</Link>
          に積まれます。何を見て何を判断したかは、下のログに全部残ります。
        </p>
      </header>

      {/* --- 運転状態 --- */}
      <div className="card mb-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => patchConfig({ enabled: !config.enabled })}
              className={`relative w-14 h-8 rounded-full transition-colors ${config.enabled ? "bg-emerald-600" : "bg-slate-300"}`}
              aria-label="自律運転の切り替え"
            >
              <span
                className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${config.enabled ? "left-7" : "left-1"}`}
              />
            </button>
            <div>
              <p className="font-semibold text-sm">{config.enabled ? "自律運転オン" : "自律運転オフ"}</p>
              <p className="text-xs text-slate-500">
                {config.enabled
                  ? `画面を開いたとき${config.runOnOpen ? "と" : "は回さず、"}1日${config.maxRunsPerDay}回まで自動で回します（今日 ${state.runsToday}回）`
                  : "オンにすると、開いたときに自動で回ります"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/hustle/inbox" className="btn-secondary !py-1.5 !px-3 text-sm flex items-center gap-1.5">
              <Inbox className="w-3.5 h-3.5" />
              承認待ち
              {state.inboxCount > 0 && <span className="badge badge-danger tabular-nums">{state.inboxCount}</span>}
            </Link>
            <button onClick={runNow} disabled={running} className="btn-primary flex items-center gap-2 disabled:opacity-60">
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              今すぐ回す
            </button>
          </div>
        </div>

        {notice && <p className="text-sm text-emerald-700 mt-3">{notice}</p>}
        {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}

        {!state.aiEnabled && (
          <p className="text-xs text-amber-700 mt-3 leading-relaxed">
            AIキーが未設定です。取り込み・判定・計画・レビューはルールで動きますが、提案文は雛形になります。
            <Link href="/settings" className="underline ml-1">設定する</Link>
          </p>
        )}
      </div>

      {/* --- パイプラインの状態 --- */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="未判定の案件" value={state.leads.new} />
        <Stat label="判定済み" value={state.leads.triaged} />
        <Stat label="下書き済み" value={state.leads.drafted} />
        <Stat label="除外" value={state.leads.rejected} muted />
      </div>

      <LeadInput onDone={load} />

      {/* --- 工程 --- */}
      <div className="card mb-4">
        <h2 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-emerald-600" />
          回す工程
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {STEP_ORDER.map((step) => (
            <label
              key={step}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition-colors ${
                config.steps[step] ? "bg-emerald-50 border-emerald-300" : "bg-white"
              }`}
              style={config.steps[step] ? undefined : { borderColor: "var(--card-border)" }}
            >
              <input
                type="checkbox"
                checked={config.steps[step]}
                onChange={(e) => patchConfig({ steps: { ...config.steps, [step]: e.target.checked } })}
              />
              {STEP_LABELS[step]}
            </label>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          <NumberField
            label="1日の実行回数"
            value={config.maxRunsPerDay}
            onChange={(v) => patchConfig({ maxRunsPerDay: v })}
          />
          <NumberField
            label="1回のAI呼び出し上限"
            value={config.callBudget}
            onChange={(v) => patchConfig({ callBudget: v })}
            help="無料枠を使い切らないための上限"
          />
          <NumberField
            label="1回に作る下書きの数"
            value={config.maxDraftsPerRun}
            onChange={(v) => patchConfig({ maxDraftsPerRun: v })}
          />
        </div>

        <label className="flex items-center gap-2 text-sm mt-3">
          <input
            type="checkbox"
            checked={config.runOnOpen}
            onChange={(e) => patchConfig({ runOnOpen: e.target.checked })}
          />
          アプリを開いたときに自動で回す
        </label>
      </div>

      <FeedEditor config={config} onSave={(feeds) => patchConfig({ feeds })} />

      {/* --- 学習パラメータ --- */}
      <div className="card mb-4">
        <h2 className="font-semibold text-sm mb-2 flex items-center gap-2">
          <Brain className="w-4 h-4 text-emerald-600" />
          自己調整の状態（第{config.learned.revision}版）
        </h2>
        <dl className="text-sm space-y-1.5">
          <Row label="案件を切る実効時給の基準" value={`${config.learned.minHourlyJpy.toLocaleString()}円`} />
          <Row label="提案文の狙う文字数" value={`${config.learned.targetProposalChars}文字`} />
          <Row
            label="通りやすい切り口"
            value={config.learned.preferredAngles.length ? config.learned.preferredAngles.join(" / ") : "（まだ学習していません）"}
          />
          <Row
            label="避けるべき点"
            value={config.learned.avoidNotes.length ? config.learned.avoidNotes.join(" / ") : "（まだありません）"}
          />
        </dl>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">
          承認キューで「承認」「捨てる（理由つき）」を続けると、ここが自動で更新されます。
          実績の実効時給が上がれば、安い案件を自動で切るようになります。
        </p>
      </div>

      {/* --- ログ --- */}
      <div className="card">
        <h2 className="font-semibold text-sm mb-1 flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-emerald-600" />
          直近の実行ログ
        </h2>
        {state.lastRun ? (
          <p className="text-xs text-slate-500 mb-3">
            {new Date(state.lastRun.startedAt).toLocaleString("ja-JP")} ·{" "}
            {state.lastRun.status === "done" ? "完了" : state.lastRun.status === "failed" ? "一部失敗" : "実行中"} ·
            AI呼び出し {state.lastRun.callsUsed}回 · {state.lastRun.summary}
          </p>
        ) : (
          <p className="text-sm text-slate-500">まだ実行していません。</p>
        )}

        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {state.events.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </div>

        {state.runs.length > 1 && (
          <div className="mt-4 pt-3 border-t" style={{ borderColor: "var(--card-border)" }}>
            <h3 className="text-xs font-semibold text-slate-500 mb-2">これまでの実行</h3>
            <ul className="space-y-1 text-xs text-slate-600">
              {state.runs.slice(1).map((r) => (
                <li key={r.id} className="flex gap-2">
                  <span className="tabular-nums shrink-0">{new Date(r.startedAt).toLocaleString("ja-JP")}</span>
                  <span className="truncate">{r.summary}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400 mt-6 leading-relaxed">
        PCをつけっぱなしにできるなら <code className="bg-slate-100 px-1 rounded">npm run agent</code> で常駐させられます。
        外部のスケジューラから <code className="bg-slate-100 px-1 rounded">POST /api/hustle/agent/run</code> を叩く形でも動きます。
      </p>
    </div>
  );
}

function Stat({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="card !p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${muted ? "text-slate-400" : ""}`}>{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-600 shrink-0">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  help,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  help?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-lg border px-3 py-2 text-sm mt-1"
        style={{ borderColor: "var(--card-border)" }}
      />
      {help && <span className="text-xs text-slate-400">{help}</span>}
    </label>
  );
}

function EventRow({ event }: { event: AgentEvent }) {
  const tone = {
    info: { Icon: Info, cls: "text-slate-400" },
    action: { Icon: CheckCircle2, cls: "text-emerald-600" },
    decision: { Icon: Brain, cls: "text-blue-600" },
    warn: { Icon: AlertTriangle, cls: "text-amber-600" },
    error: { Icon: AlertTriangle, cls: "text-rose-600" },
  }[event.level];

  return (
    <div className="flex items-start gap-2 text-sm">
      <tone.Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${tone.cls}`} />
      <span className="text-xs text-slate-400 tabular-nums shrink-0 w-14">
        {new Date(event.createdAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </span>
      <span className="text-xs text-slate-400 shrink-0 w-20 truncate">
        {event.step === "runner" ? "全体" : STEP_LABELS[event.step as StepId]}
      </span>
      <span className="leading-relaxed">{event.message}</span>
    </div>
  );
}

function LeadInput({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [source, setSource] = useState<"paste" | "email">("paste");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/hustle/agent/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "投入に失敗しました");
      setResult(`${data.created}件 取り込みました（重複 ${data.duplicated}件）`);
      setText("");
      onDone();
    } catch (e) {
      setResult(e instanceof Error ? e.message : "投入に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mb-4">
      <h2 className="font-semibold text-sm mb-1 flex items-center gap-2">
        <Plus className="w-4 h-4 text-emerald-600" />
        案件を投入する
      </h2>
      <p className="text-xs text-slate-500 mb-3 leading-relaxed">
        募集文を <code className="bg-slate-100 px-1 rounded">---</code> の行で区切って何件でも貼れます。
        案件通知メールをそのまま貼る場合は「メール」を選ぶと、引用や署名を落としてから取り込みます。
        投入した案件は次の実行で自動的に判定され、通ったものだけ提案文が作られます。
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={"1件目の募集文…\n\n---\n\n2件目の募集文…"}
        className="w-full rounded-lg border p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
        style={{ borderColor: "var(--card-border)" }}
      />
      <div className="flex flex-wrap items-center gap-3 mt-2">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as typeof source)}
          className="rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--card-border)" }}
        >
          <option value="paste">貼り付け</option>
          <option value="email">メール本文</option>
        </select>
        <button onClick={submit} disabled={busy || text.trim().length < 20} className="btn-primary !py-2 !px-4 text-sm flex items-center gap-1.5 disabled:opacity-60">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          取り込む
        </button>
        {result && <span className="text-sm text-slate-600">{result}</span>}
      </div>
    </div>
  );
}

function FeedEditor({ config, onSave }: { config: AgentConfig; onSave: (feeds: string[]) => void }) {
  const [text, setText] = useState(config.feeds.join("\n"));

  useEffect(() => {
    setText(config.feeds.join("\n"));
  }, [config.feeds]);

  return (
    <div className="card mb-4">
      <h2 className="font-semibold text-sm mb-1 flex items-center gap-2">
        <Rss className="w-4 h-4 text-emerald-600" />
        自動で取り込むフィード（RSS / Atom）
      </h2>
      <p className="text-xs text-slate-500 mb-3 leading-relaxed">
        求人・案件情報をRSSで配信しているサイトのURLを1行ずつ。実行のたびに新着だけを取り込みます。
        <strong className="text-slate-700">
          RSSを配信していないサイトを自動巡回することはしません
        </strong>
        （主要なクラウドソーシングは robots.txt と利用規約で自動取得を禁止しています）。
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onSave(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))}
        rows={3}
        placeholder="https://example.com/jobs.rss"
        className="w-full rounded-lg border p-3 text-sm font-mono"
        style={{ borderColor: "var(--card-border)" }}
      />
    </div>
  );
}
