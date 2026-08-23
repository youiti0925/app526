"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Inbox,
  Check,
  X,
  Wand2,
  Loader2,
  ExternalLink,
  Copy,
  AlertTriangle,
  HelpCircle,
  FileText,
  Mail,
  Tag,
  BarChart3,
  RefreshCw,
} from "lucide-react";
import StorageNotice from "@/components/hustle/StorageNotice";
import type { InboxItem, InboxKind } from "@/lib/hustle/agent/types";

const KIND_META: Record<InboxKind, { label: string; Icon: typeof FileText; cls: string; approvable: boolean }> = {
  proposal: { label: "提案文", Icon: FileText, cls: "badge-success", approvable: true },
  outreach: { label: "営業メール", Icon: Mail, cls: "badge-info", approvable: true },
  listing: { label: "出品文", Icon: Tag, cls: "badge-info", approvable: true },
  deliverable: { label: "納品物", Icon: FileText, cls: "badge-info", approvable: true },
  warning: { label: "危険", Icon: AlertTriangle, cls: "badge-danger", approvable: false },
  question: { label: "判断が要る", Icon: HelpCircle, cls: "badge-warning", approvable: true },
  report: { label: "レポート", Icon: BarChart3, cls: "badge-info", approvable: false },
};

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/hustle/agent/inbox");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "読み込みに失敗しました");
      setItems(data.inbox ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function replaceItem(next: InboxItem) {
    setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)));
  }

  return (
    <div className="p-8 max-w-4xl">
      <StorageNotice />

      <header className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Inbox className="w-6 h-6 text-emerald-600" />
              承認キュー
              {items.length > 0 && (
                <span className="badge badge-danger tabular-nums">{items.length}</span>
              )}
            </h1>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              エージェントが作ったものが、優先度の高い順に並んでいます。
              上から「送る / 直す / 捨てる」を決めるだけです。
              <strong className="text-slate-900">送信はあなたが行います</strong>
              （自動送信は各社の規約でアカウント停止の対象なので実装していません）。
            </p>
          </div>
          <button onClick={load} className="btn-secondary !py-1.5 !px-3 text-sm flex items-center gap-1.5 shrink-0">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            更新
          </button>
        </div>
      </header>

      {error && <p className="text-sm text-rose-600 mb-4">{error}</p>}

      {loading && items.length === 0 ? (
        <div className="card text-sm text-slate-500">読み込み中…</div>
      ) : items.length === 0 ? (
        <div className="card">
          <p className="text-sm text-slate-600 leading-relaxed">
            承認待ちはありません。
            <Link href="/hustle/agent" className="text-emerald-700 hover:underline mx-1">
              自律運転
            </Link>
            で「今すぐ回す」を押すか、案件を取り込むとここに溜まります。
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <InboxCard key={item.id} item={item} onDone={removeItem} onUpdate={replaceItem} />
          ))}
        </div>
      )}
    </div>
  );
}

function InboxCard({
  item,
  onDone,
  onUpdate,
}: {
  item: InboxItem;
  onDone: (id: string) => void;
  onUpdate: (item: InboxItem) => void;
}) {
  const meta = KIND_META[item.kind] ?? KIND_META.report;
  const [body, setBody] = useState(item.body);
  const [busy, setBusy] = useState<"approve" | "reject" | "revise" | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [showRevise, setShowRevise] = useState(false);
  const [note, setNote] = useState("");
  const [instruction, setInstruction] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 承認したときに送る本文は、画面で手直しした後のもの
  const sendable = body.includes("\n---\n") ? body.split("\n---\n").slice(1).join("\n---\n").trim() : body;

  async function post(payload: Record<string, unknown>) {
    const res = await fetch(`/api/hustle/agent/inbox/${item.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "失敗しました");
    return data;
  }

  async function approve() {
    setBusy("approve");
    setError(null);
    try {
      if (body !== item.body) await post({ action: "save", body });
      if (meta.approvable && item.kind !== "question") {
        await navigator.clipboard.writeText(sendable).catch(() => undefined);
      }
      await post({ status: "approved", note: "" });
      if (item.actionUrl) window.open(item.actionUrl, "_blank", "noopener,noreferrer");
      onDone(item.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    setBusy("reject");
    setError(null);
    try {
      await post({ status: "rejected", note });
      onDone(item.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function revise() {
    setBusy("revise");
    setError(null);
    try {
      const data = await post({ action: "revise", instruction });
      setBody(data.item.body);
      onUpdate({ ...item, body: data.item.body });
      setShowRevise(false);
      setInstruction("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "失敗しました");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`card ${item.kind === "warning" ? "border-l-4 !border-l-rose-500" : ""}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <span className={`badge ${meta.cls} gap-1 mb-1.5`}>
            <meta.Icon className="w-3.5 h-3.5" />
            {meta.label}
          </span>
          <h2 className="font-semibold text-sm break-words">{item.title}</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {new Date(item.createdAt).toLocaleString("ja-JP")}
            {typeof item.meta.usedAi === "boolean" && (item.meta.usedAi ? " · AI生成" : " · 雛形")}
          </p>
        </div>
        {item.actionUrl && (
          <a
            href={item.actionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-emerald-700 hover:underline flex items-center gap-1 shrink-0"
          >
            送信先を開く
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={Math.min(20, Math.max(6, body.split("\n").length + 1))}
        className="w-full rounded-lg border p-3 text-sm leading-relaxed font-sans bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        style={{ borderColor: "var(--card-border)" }}
      />

      {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 mt-3">
        {meta.approvable ? (
          <button
            onClick={approve}
            disabled={busy !== null}
            className="btn-primary !py-1.5 !px-4 text-sm flex items-center gap-1.5 disabled:opacity-60"
          >
            {busy === "approve" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {item.kind === "question" ? "これで進める" : "承認（コピーして送信先を開く）"}
          </button>
        ) : (
          <button
            onClick={() => void post({ status: "approved", note: "確認済み" }).then(() => onDone(item.id))}
            className="btn-secondary !py-1.5 !px-4 text-sm flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            確認した
          </button>
        )}

        <button
          onClick={async () => {
            await navigator.clipboard.writeText(sendable);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="btn-secondary !py-1.5 !px-3 text-sm flex items-center gap-1.5"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "コピーしました" : "コピーだけ"}
        </button>

        <button
          onClick={() => {
            setShowRevise(!showRevise);
            setShowReject(false);
          }}
          className="btn-secondary !py-1.5 !px-3 text-sm flex items-center gap-1.5"
        >
          <Wand2 className="w-3.5 h-3.5" />
          直させる
        </button>

        <button
          onClick={() => {
            setShowReject(!showReject);
            setShowRevise(false);
          }}
          className="text-sm text-slate-500 hover:text-rose-600 px-2 flex items-center gap-1.5"
        >
          <X className="w-3.5 h-3.5" />
          捨てる
        </button>
      </div>

      {showRevise && (
        <div className="mt-3 flex gap-2">
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && instruction.trim() && revise()}
            placeholder="例: もっと短く / 実績の話を減らして / 納期の不安を先に潰して"
            className="flex-1 rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--card-border)" }}
          />
          <button
            onClick={revise}
            disabled={busy !== null || !instruction.trim()}
            className="btn-primary !py-2 !px-4 text-sm flex items-center gap-1.5 disabled:opacity-60"
          >
            {busy === "revise" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            直す
          </button>
        </div>
      )}

      {showReject && (
        <div className="mt-3">
          <div className="flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && reject()}
              placeholder="なぜ捨てるか（次の生成に反映されます）"
              className="flex-1 rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--card-border)" }}
            />
            <button
              onClick={reject}
              disabled={busy !== null}
              className="btn-secondary !py-2 !px-4 text-sm disabled:opacity-60"
            >
              {busy === "reject" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "捨てる"}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1.5">
            理由を書くと、エージェントが次から同じものを出さないように調整します。
          </p>
        </div>
      )}
    </div>
  );
}
