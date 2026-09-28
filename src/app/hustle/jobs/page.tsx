"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Workflow, Loader2, Plus, Trash2, Check, X, RotateCcw, Download, AlertTriangle, BookOpen, Gauge, ChevronLeft, FlaskConical,
} from "lucide-react";
import StorageNotice from "@/components/hustle/StorageNotice";

type Status = "queued" | "working" | "waiting_quota" | "awaiting_approval" | "needs_human" | "approved" | "rejected" | "failed";

const STATUS: Record<Status, { label: string; cls: string }> = {
  queued: { label: "処理待ち", cls: "badge-info" },
  working: { label: "処理中", cls: "badge-info" },
  waiting_quota: { label: "上限待ち", cls: "badge-warning" },
  awaiting_approval: { label: "承認待ち", cls: "badge-success" },
  needs_human: { label: "自動では無理", cls: "badge-danger" },
  approved: { label: "承認済み", cls: "badge-success" },
  rejected: { label: "差し戻し", cls: "badge-warning" },
  failed: { label: "エラー", cls: "badge-danger" },
};

const ORIGIN: Record<string, string> = {
  existing: "既存の手順書をそのまま使用",
  new: "新しく作った手順書",
  adapted: "既存の手順書を直して使用",
  fixed: "改修した手順書",
};

const PURPOSE: Record<string, string> = {
  route: "振り分け", author: "手順書づくり", fix: "手順書の改修", run: "作業", review: "検品", compare: "モデル比較",
};

interface JobSummary {
  id: string;
  title: string;
  status: Status;
  note: string;
  deadline: string;
  priceJpy: number;
  createdAt: string;
  updatedAt: string;
  qualityPass: boolean | null;
  issueCount: number;
  error: string;
}

interface UsageTotal {
  provider: string;
  model: string;
  calls: number;
  failed: number;
  minutes: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  costUsd: number;
  purpose?: string;
}

interface RecipeSummary {
  id: string;
  version: number;
  name: string;
  summary: string;
  tier: string;
  preferred: { provider: string; model: string } | null;
  stats: { runs: number; approved: number; rejected: number; lastUsedAt: string | null };
  trials: { provider: string; model: string; accuracy: number; at: string; note: string }[];
  hasTestSet: boolean;
  testSetSource: "model" | "human" | null;
  steps: string[];
  outputColumns: string[];
}

interface ListData {
  jobs: JobSummary[];
  recipes: RecipeSummary[];
  usageWeek: UsageTotal[];
  workerRunning: boolean;
  claude: { installed: boolean; loggedIn: boolean; method: string; detail: string };
  models: { light: string; standard: string; heavy: string };
}

export default function JobsPage() {
  return (
    <Suspense fallback={<div className="p-6"><Loader2 className="w-5 h-5 animate-spin" /></div>}>
      <JobsInner />
    </Suspense>
  );
}

function JobsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("id");
  const [data, setData] = useState<ListData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/hustle/jobs");
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "読み込みに失敗しました");
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    }
  }, []);

  const busy = data?.jobs.some((j) => j.status === "queued" || j.status === "working") ?? false;
  useEffect(() => {
    void load();
    const t = setInterval(load, busy ? 4000 : 30000);
    return () => clearInterval(t);
  }, [load, busy]);

  const open = (id: string | null) => router.push(id ? `/hustle/jobs?id=${id}` : "/hustle/jobs");

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <StorageNotice />
      <header className="mb-5">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Workflow className="w-6 h-6 text-emerald-600" />
          仕事ライン
        </h1>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          依頼文と入力の表を入れると、振り分け → 手順書（無ければ上位モデルが作る）→ 作業 → 検品 → やり直し までをアプリとAIだけで進めます。
          あなたがやるのは最後の承認だけです。承認しても送信はされません。納品は各サイトで行ってください。
        </p>
        {data && <ClaudeBadge claude={data.claude} models={data.models} />}
      </header>
      {error && <p className="text-sm text-rose-600 mb-4">{error}</p>}

      {selected ? (
        <JobDetail id={selected} onBack={() => open(null)} onChanged={load} />
      ) : (
        <>
          <JobList jobs={data?.jobs ?? []} onOpen={open} loading={!data} />
          <NewJobForm onCreated={(id) => { void load(); open(id); }} />
          <Recipes recipes={data?.recipes ?? []} onChanged={load} />
          <Usage usage={data?.usageWeek ?? []} />
        </>
      )}
    </div>
  );
}

function ClaudeBadge({ claude, models }: { claude: ListData["claude"]; models: ListData["models"] }) {
  const ok = claude.installed && claude.loggedIn && !/api.?key/i.test(claude.method);
  return (
    <div className={`mt-3 rounded-lg p-3 text-sm ${ok ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
      <p className="font-semibold">{ok ? "Claude: サブスクで接続済み" : "Claude: 要設定"}</p>
      <p className="mt-1">{claude.detail}</p>
      <p className="mt-1 text-xs opacity-80">
        使うモデル — 軽い: {models.light} / 中くらい: {models.standard} / 上位: {models.heavy}
      </p>
    </div>
  );
}

function JobList({ jobs, onOpen, loading }: { jobs: JobSummary[]; onOpen: (id: string) => void; loading: boolean }) {
  const waiting = jobs.filter((j) => j.status === "awaiting_approval");
  return (
    <section className="mb-6">
      <h2 className="font-semibold mb-2">依頼 {waiting.length > 0 && <span className="badge badge-success ml-1">承認待ち {waiting.length}</span>}</h2>
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      ) : jobs.length === 0 ? (
        <p className="text-sm text-slate-500">まだ依頼がありません。下のフォームから入れてください。</p>
      ) : (
        <ul className="space-y-2">
          {jobs.map((j) => (
            <li key={j.id}>
              <button onClick={() => onOpen(j.id)} className="card !p-3 w-full text-left hover:border-emerald-400">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`badge ${STATUS[j.status].cls}`}>{STATUS[j.status].label}</span>
                  {(j.status === "queued" || j.status === "working") && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                  {j.qualityPass === false && <span className="badge badge-warning">品質基準未達</span>}
                  <span className="font-medium break-all">{j.title}</span>
                </div>
                <p className="text-xs text-slate-600 mt-1 break-words">{j.error || j.note}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {new Date(j.createdAt).toLocaleString("ja-JP")}
                  {j.deadline && ` ・ 締切 ${j.deadline}`}
                  {j.priceJpy > 0 && ` ・ ${j.priceJpy.toLocaleString()}円`}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewJobForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [lists, setLists] = useState<{ name: string; text: string }[]>([]);
  const [dataClass, setDataClass] = useState<"public" | "confidential">("confidential");
  const [deadline, setDeadline] = useState("");
  const [price, setPrice] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadFile(file: File | undefined) {
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) {
      setError("Excelファイルはまだ読めません。ExcelでCSV UTF-8として保存してから入れてください。");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("5MBを超えるファイルは入れられません。分けてください。");
      return;
    }
    setCsv(await file.text());
    setFileName(file.name);
    setError(null);
  }

  async function submit() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/hustle/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, instructions, inputCsv: csv, dataClass, deadline, priceJpy: Number(price) || 0,
          lists: Object.fromEntries(lists.filter((l) => l.name.trim()).map((l) => [l.name.trim(), l.text])),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "登録に失敗しました");
      setTitle(""); setInstructions(""); setCsv(""); setFileName(""); setLists([]); setDeadline(""); setPrice("");
      setOpen(false);
      onCreated(d.job.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary flex items-center gap-2 mb-6 w-full sm:w-auto justify-center">
        <Plus className="w-4 h-4" /> 依頼を入れる
      </button>
    );
  }
  return (
    <section className="card mb-6 space-y-4">
      <h2 className="font-semibold">依頼を入れる</h2>
      <Field label="件名">
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="input w-full" placeholder="例: 関東のホテル100件 公式サイト照合" />
      </Field>
      <Field label="依頼内容（依頼者のメッセージをそのまま貼る）">
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={8} className="input w-full"
          placeholder="納品してほしい列・条件・形式・除外条件などが書かれた依頼文" />
      </Field>
      <Field label="入力の表（CSV / TSV。1行目は見出し）">
        <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,text/plain" onChange={(e) => void loadFile(e.target.files?.[0])}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2" />
        {fileName && <p className="text-xs text-slate-500 mt-1">読み込み済み: {fileName}（{csv.split(/\r?\n/).length - 1}行）</p>}
        <textarea value={csv} onChange={(e) => { setCsv(e.target.value); setFileName(""); }} rows={4} className="input w-full mt-2 font-mono text-xs"
          placeholder={"または貼り付け\n施設名,所在地\nホテルA,東京都…"} />
      </Field>
      <div>
        <p className="text-sm font-semibold mb-1">添付リスト（NGリスト・既存リストなど。1行に1つ）</p>
        {lists.map((l, i) => (
          <div key={i} className="flex gap-2 mb-2 items-start">
            <div className="flex-1 space-y-1">
              <input value={l.name} onChange={(e) => setLists(lists.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                className="input w-full" placeholder="リストの名前（例: NGリスト）" />
              <textarea value={l.text} onChange={(e) => setLists(lists.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                rows={3} className="input w-full text-xs" placeholder={"株式会社A\n株式会社B"} />
            </div>
            <button onClick={() => setLists(lists.filter((_, j) => j !== i))} className="btn-secondary !p-2" aria-label="削除"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        <button onClick={() => setLists([...lists, { name: "", text: "" }])} className="btn-secondary text-sm flex items-center gap-1">
          <Plus className="w-4 h-4" /> リストを足す
        </button>
      </div>
      <Field label="データの種類">
        <div className="space-y-1 text-sm">
          <label className="flex gap-2 items-start">
            <input type="radio" checked={dataClass === "confidential"} onChange={() => setDataClass("confidential")} className="mt-1" />
            <span>依頼者の資料を含む（無料枠のGeminiには送らない。迷ったらこちら）</span>
          </label>
          <label className="flex gap-2 items-start">
            <input type="radio" checked={dataClass === "public"} onChange={() => setDataClass("public")} className="mt-1" />
            <span>公開情報だけ（安いモデルの比較にGemini無料枠も使える）</span>
          </label>
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="締切"><input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="input w-full" /></Field>
        <Field label="金額（円）"><input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))} className="input w-full" /></Field>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={sending || !title.trim() || !instructions.trim() || !csv.trim()} className="btn-primary flex items-center gap-2">
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Workflow className="w-4 h-4" />} 処理を始める
        </button>
        <button onClick={() => setOpen(false)} className="btn-secondary">閉じる</button>
      </div>
    </section>
  );
}

interface Issue { src: number; column: string; reason: string; severity: "error" | "warn"; fromAi: boolean }

interface Detail {
  job: JobSummary & {
    instructions: string;
    dataClass: string;
    route: { action: string; reason: string; by: string } | null;
    report: {
      recipe: { id: string; version: number; name: string; origin: string };
      test: { accuracy: number; cells: number } | null;
      expectedCorrections: { index: number; column: string; value: string; reason: string }[];
      attempts: { phase: string; tier: string; rows: number; errorRate: number; note: string }[];
      quality: { rows: number; errorRows: number; warnRows: number; errorRate: number; pass: boolean };
      systemic: string;
      inputRows: number;
      outputRows: number;
    } | null;
    issues: Issue[];
    removed: { src: number; reason: string }[];
    feedback: string;
  };
  output: { headers: string[]; rows: Record<string, string>[]; src: number[]; total: number };
  usage: UsageTotal[];
}

const TIER_JA: Record<string, string> = { light: "軽い", standard: "中くらい", heavy: "上位" };
const PHASE_JA: Record<string, string> = { run: "作業", rerun_rows: "要確認の行を上のモデルでやり直し", fixed_recipe: "手順書を改修してやり直し" };

function JobDetail({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [acting, setActing] = useState(false);
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/hustle/jobs/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "読み込みに失敗しました");
      setD(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    }
  }, [id]);

  const running = d && (d.job.status === "queued" || d.job.status === "working");
  useEffect(() => {
    void load();
    const t = setInterval(load, running ? 4000 : 60000);
    return () => clearInterval(t);
  }, [load, running]);

  const issuesBySrc = useMemo(() => {
    const m = new Map<number, Issue[]>();
    for (const i of d?.job.issues ?? []) m.set(i.src, [...(m.get(i.src) ?? []), i]);
    return m;
  }, [d]);

  async function act(action: "approve" | "reject" | "redo") {
    setActing(true);
    try {
      const res = await fetch(`/api/hustle/jobs/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "失敗しました");
      setNote("");
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "失敗しました");
    } finally {
      setActing(false);
    }
  }

  if (!d) return <div>{error ? <p className="text-sm text-rose-600">{error}</p> : <Loader2 className="w-5 h-5 animate-spin" />}</div>;
  const { job, report } = { job: d.job, report: d.job.report };
  const rows = d.output.rows.map((r, i) => ({ r, src: d.output.src[i] })).filter((x) => !onlyFlagged || issuesBySrc.has(x.src));
  const topIssues = summarizeIssues(job.issues);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-slate-600 flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> 一覧へ</button>
      <section className="card">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`badge ${STATUS[job.status].cls}`}>{STATUS[job.status].label}</span>
          {running && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          <h2 className="font-semibold break-all">{job.title}</h2>
        </div>
        <p className="text-sm mt-2 break-words">{job.error || job.note}</p>
        {job.route && <p className="text-xs text-slate-500 mt-2">振り分け（{job.route.by === "rule" ? "機械" : "AI"}）: {job.route.reason}</p>}
        {report && (
          <div className="text-xs text-slate-600 mt-2 space-y-1">
            <p>手順書: {report.recipe.name}（第{report.recipe.version}版・{ORIGIN[report.recipe.origin] ?? report.recipe.origin}）</p>
            {report.test && <p>手本との一致率: {Math.round(report.test.accuracy * 100)}%（{report.test.cells}セル）</p>}
            {report.attempts.map((a, i) => (
              <p key={i}>・{PHASE_JA[a.phase] ?? a.phase}（{TIER_JA[a.tier] ?? a.tier}モデル・{a.rows}行）→ 要確認 {Math.round(a.errorRate * 100)}% {a.note}</p>
            ))}
          </div>
        )}
      </section>

      {report && (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Metric label="入力" value={`${report.inputRows}行`} />
          <Metric label="出力" value={`${report.outputRows}行`} />
          <Metric label="要確認" value={`${report.quality.errorRows}行`} warn={report.quality.errorRows > 0} />
          <Metric label="除外" value={`${job.removed.length}行`} />
        </section>
      )}

      {report?.systemic && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> 検品AIの指摘（全体）</p>
          <p className="mt-1">{report.systemic}</p>
        </div>
      )}
      {report && report.expectedCorrections.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">AIが手本（正解）を訂正しました。正しいか確認してください</p>
          <ul className="list-disc list-inside mt-1">
            {report.expectedCorrections.map((c, i) => <li key={i}>{c.index + 1}行目 {c.column} →「{c.value}」: {c.reason}</li>)}
          </ul>
        </div>
      )}

      {job.status === "awaiting_approval" && (
        <section className="card space-y-3">
          <h3 className="font-semibold">承認（ここだけあなたの作業）</h3>
          {job.qualityPass === false && (
            <p className="text-sm text-amber-800">品質基準に届いていません。要確認の行を見てから判断してください。</p>
          )}
          <div className="flex flex-wrap gap-2">
            <a href={`/api/hustle/jobs/${id}/csv`} className="btn-secondary flex items-center gap-1 text-sm"><Download className="w-4 h-4" /> 納品用CSV</a>
            <a href={`/api/hustle/jobs/${id}/csv?kind=annotated`} className="btn-secondary flex items-center gap-1 text-sm"><Download className="w-4 h-4" /> 確認メモ付きCSV</a>
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="input w-full text-sm"
            placeholder="作り直すときは、どこを直すかを書く（例: 電話番号はハイフン付きで）" />
          <div className="grid grid-cols-3 gap-2">
            <button disabled={acting} onClick={() => act("approve")} className="btn-primary flex items-center justify-center gap-1 !py-3"><Check className="w-4 h-4" /> 承認</button>
            <button disabled={acting || !note.trim()} onClick={() => act("redo")} className="btn-secondary flex items-center justify-center gap-1 !py-3"><RotateCcw className="w-4 h-4" /> 作り直し</button>
            <button disabled={acting} onClick={() => act("reject")} className="btn-secondary flex items-center justify-center gap-1 !py-3"><X className="w-4 h-4" /> 却下</button>
          </div>
        </section>
      )}
      {(job.status === "rejected" || job.status === "needs_human") && (
        <section className="card space-y-2">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="input w-full text-sm"
            placeholder="作り直すときの指示（例: 依頼文の3番目の条件を満たす形で）" />
          <button disabled={acting || !note.trim()} onClick={() => act("redo")} className="btn-secondary flex items-center gap-1"><RotateCcw className="w-4 h-4" /> 指示を付けて作り直す</button>
        </section>
      )}
      {job.status === "approved" && (
        <div className="flex flex-wrap gap-2">
          <a href={`/api/hustle/jobs/${id}/csv`} className="btn-primary flex items-center gap-1 text-sm"><Download className="w-4 h-4" /> 納品用CSV</a>
        </div>
      )}

      {topIssues.length > 0 && (
        <section className="card">
          <h3 className="font-semibold mb-2">要確認の内訳</h3>
          <ul className="text-sm space-y-1">
            {topIssues.slice(0, 12).map((t, i) => (
              <li key={i} className={t.severity === "error" ? "text-rose-700" : "text-slate-600"}>
                {t.severity === "error" ? "要確認" : "注意"} ・ {t.column || "全体"}: {t.reason}（{t.count}行）
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.output.total > 0 && (
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="font-semibold">出力（{d.output.total}行{d.output.total > d.output.rows.length ? `中 先頭${d.output.rows.length}行` : ""}）</h3>
            <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /> 要確認だけ</label>
          </div>
          <div className="overflow-x-auto rounded border" style={{ borderColor: "var(--card-border)" }}>
            <table className="min-w-full text-xs">
              <thead className="bg-slate-100">
                <tr>{["#", ...d.output.headers].map((h) => <th key={h} className="px-2 py-1 text-left whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map(({ r, src }) => {
                  const iss = issuesBySrc.get(src) ?? [];
                  const bad = new Set(iss.filter((i) => i.severity === "error").map((i) => i.column));
                  return (
                    <tr key={src} className="border-t align-top">
                      <td className="px-2 py-1 text-slate-400">{src + 1}</td>
                      {d.output.headers.map((h) => (
                        <td key={h} className={`px-2 py-1 max-w-64 break-words ${bad.has(h) ? "bg-rose-50 text-rose-800" : ""}`}
                          title={iss.filter((i) => i.column === h).map((i) => i.reason).join(" / ")}>
                          {r[h] || <span className="text-slate-300">空欄</span>}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {job.removed.length > 0 && (
        <details className="card text-sm">
          <summary className="font-semibold cursor-pointer">除外した行（{job.removed.length}行）</summary>
          <ul className="mt-2 space-y-1 text-xs">{job.removed.slice(0, 100).map((r, i) => <li key={i}>{r.src + 1}行目: {r.reason}</li>)}</ul>
        </details>
      )}

      <UsageTable title="この依頼で使ったAI" usage={d.usage} withPurpose />
      <details className="card text-sm">
        <summary className="font-semibold cursor-pointer">依頼内容</summary>
        <pre className="whitespace-pre-wrap text-xs mt-2">{job.instructions}</pre>
      </details>
    </div>
  );
}

function summarizeIssues(issues: Issue[]) {
  const m = new Map<string, { column: string; reason: string; severity: string; count: number }>();
  for (const i of issues) {
    const reason = i.reason.replace(/「[^」]*」/g, "「…」");
    const k = `${i.severity}|${i.column}|${reason}`;
    const cur = m.get(k) ?? { column: i.column, reason, severity: i.severity, count: 0 };
    cur.count++;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === "error" ? -1 : 1));
}

function Recipes({ recipes, onChanged }: { recipes: RecipeSummary[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  async function compare(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/hustle/recipes/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "compare" }) });
      const d = await res.json();
      setMsg((m) => ({ ...m, [id]: res.ok ? d.summary : d.error ?? "失敗しました" }));
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-6">
      <h2 className="font-semibold mb-2 flex items-center gap-2"><BookOpen className="w-4 h-4" /> 手順書（{recipes.length}）</h2>
      {recipes.length === 0 ? (
        <p className="text-sm text-slate-500">まだありません。新しい型の依頼が来ると、上位モデルが1つ作ります。</p>
      ) : (
        <ul className="space-y-2">
          {recipes.map((r) => (
            <li key={r.id} className="card !p-3 text-sm">
              <p className="font-medium">{r.name} <span className="text-xs text-slate-500">第{r.version}版</span></p>
              <p className="text-xs text-slate-600 mt-1">{r.summary}</p>
              <p className="text-xs text-slate-500 mt-1">
                実行 {r.stats.runs}回 ・ 承認 {r.stats.approved} ・ 差し戻し {r.stats.rejected} ・
                使うモデル: {r.preferred ? `${r.preferred.provider} ${r.preferred.model}（比較で決定）` : `${TIER_JA[r.tier] ?? r.tier}モデル`} ・
                手本: {r.hasTestSet ? (r.testSetSource === "human" ? "人が承認したもの" : "上位モデルが作ったもの") : "なし"}
              </p>
              <p className="text-xs text-slate-400 mt-1">工程: {r.steps.join(" → ")}</p>
              {r.trials.length > 0 && (
                <p className="text-xs text-slate-500 mt-1">
                  試験: {r.trials.map((t) => `${t.provider === "claude" && t.model.startsWith("tier:") ? t.model.replace("tier:", "") : `${t.provider} ${t.model}`} ${Math.round(t.accuracy * 100)}%`).join(" / ")}
                </p>
              )}
              <button disabled={!!busy || !r.hasTestSet} onClick={() => compare(r.id)} className="btn-secondary text-xs mt-2 flex items-center gap-1">
                {busy === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <FlaskConical className="w-3 h-3" />} 安いモデルで足りるか試す
              </button>
              {msg[r.id] && <p className="text-xs mt-1">{msg[r.id]}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Usage({ usage }: { usage: UsageTotal[] }) {
  return (
    <section className="mb-6">
      <UsageTable title="直近7日のAI使用量（実測）" usage={usage} />
      <p className="text-xs text-slate-500 mt-2 leading-relaxed">
        サブスクの週の上限は数値が公開されていないため、残り何%かは出せません。時間とトークンの実測だけを出しています。
        「API換算」は同じ量をAPIで使った場合の料金の目安で、サブスクでは請求されません。
      </p>
    </section>
  );
}

function UsageTable({ title, usage, withPurpose = false }: { title: string; usage: UsageTotal[]; withPurpose?: boolean }) {
  return (
    <div className="card overflow-hidden">
      <h3 className="font-semibold mb-2 flex items-center gap-2"><Gauge className="w-4 h-4" /> {title}</h3>
      {usage.length === 0 ? (
        <p className="text-sm text-slate-500">まだ使っていません。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                {withPurpose && <th className="pr-3 py-1">用途</th>}
                <th className="pr-3 py-1">モデル</th><th className="pr-3 py-1">回数</th><th className="pr-3 py-1">時間</th>
                <th className="pr-3 py-1">入力</th><th className="pr-3 py-1">出力</th><th className="pr-3 py-1">API換算</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u, i) => (
                <tr key={i} className="border-t">
                  {withPurpose && <td className="pr-3 py-1">{PURPOSE[u.purpose ?? ""] ?? u.purpose}</td>}
                  <td className="pr-3 py-1 whitespace-nowrap">{u.provider} {u.model}</td>
                  <td className="pr-3 py-1 tabular-nums">{u.calls}{u.failed > 0 && <span className="text-rose-600">（失敗{u.failed}）</span>}</td>
                  <td className="pr-3 py-1 tabular-nums">{u.minutes}分</td>
                  <td className="pr-3 py-1 tabular-nums">{(u.inputTokens + u.cacheTokens).toLocaleString()}</td>
                  <td className="pr-3 py-1 tabular-nums">{u.outputTokens.toLocaleString()}</td>
                  <td className="pr-3 py-1 tabular-nums">${u.costUsd.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold mb-1">{label}</span>
      {children}
    </label>
  );
}

function Metric({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="card !p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${warn ? "text-rose-700" : ""}`}>{value}</p>
    </div>
  );
}
