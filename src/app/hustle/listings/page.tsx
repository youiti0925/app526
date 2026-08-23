"use client";

import { useCallback, useEffect, useState } from "react";
import { Store, Loader2, RefreshCw, ExternalLink } from "lucide-react";
import StorageNotice from "@/components/hustle/StorageNotice";
import {
  LISTING_VERDICT_LABELS,
  type ListingReview,
  type PublishedListing,
} from "@/lib/hustle/agent/listing-tracker";

interface Payload {
  listings: PublishedListing[];
  reviews: ListingReview[];
  summary: string;
}

const VERDICT_CLASS: Record<string, string> = {
  too_early: "badge-info",
  invisible: "badge-warning",
  no_conversion: "badge-warning",
  working: "badge-success",
  stop: "badge-danger",
};

export default function ListingsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/hustle/agent/listings");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "読み込みに失敗しました");
      setData(json);
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

  async function save(id: string, patch: Record<string, unknown>) {
    setSaving(id);
    try {
      const res = await fetch(`/api/hustle/agent/listings/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "保存に失敗しました");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <StorageNotice />

      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Store className="w-5 h-5" />
          出品の実績
        </h1>
        <button onClick={() => void load()} className="btn-ghost text-xs flex items-center gap-1">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          再読み込み
        </button>
      </div>

      <p className="text-sm text-slate-600 mb-4 leading-relaxed">
        承認した出品案が、ここに並びます。
        <strong>閲覧数・問い合わせ数・受注数は、出品先の管理画面を見て自分で入れてください。</strong>
        自動では取りに行きません（ログインが要るうえ、各社の規約に触れます）。
        数字が入って初めて「見られていないのか、見られているのに売れないのか」を分けて判断できます。
      </p>

      {error && <p className="text-sm text-rose-600 mb-4">{error}</p>}

      {loading && !data && (
        <p className="text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          読み込み中
        </p>
      )}

      {data && data.listings.length === 0 && (
        <div className="card">
          <p className="text-sm text-slate-600 leading-relaxed">
            まだ出品がありません。
            <br />
            承認キューで「出品案」を承認すると、ここに記録されます。
            承認は「この内容で出す」という意思表示で、実際の出品はご自身で行ってください
            （アプリが代わりに出品することはありません。各社の規約違反になります）。
          </p>
        </div>
      )}

      {data && data.summary && (
        <p className="text-sm mb-4 p-3 rounded" style={{ background: "var(--card-bg)" }}>
          {data.summary}
        </p>
      )}

      <div className="space-y-3">
        {data?.listings.map((l) => {
          const review = data.reviews.find((r) => r.listingId === l.id);
          return (
            <div key={l.id} className="card">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <h2 className="font-medium text-sm truncate">{l.title}</h2>
                  <p className="text-xs text-slate-500">
                    {l.publishedAt} に出品 / 標準 {l.priceJpy.toLocaleString()}円
                    {review && ` / ${review.ageDays}日経過`}
                  </p>
                </div>
                {review && (
                  <span className={`badge ${VERDICT_CLASS[review.verdict] ?? "badge-info"} shrink-0`}>
                    {LISTING_VERDICT_LABELS[review.verdict]}
                  </span>
                )}
              </div>

              {review && (
                <div className="text-xs leading-relaxed mb-3">
                  <p className="text-slate-600">{review.reason}</p>
                  <p className="mt-1">
                    <span className="font-medium">次にやること: </span>
                    {review.nextAction}
                  </p>
                </div>
              )}

              <form
                className="flex flex-wrap items-end gap-2 text-xs"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void save(l.id, {
                    url: f.get("url"),
                    views: f.get("views"),
                    inquiries: f.get("inquiries"),
                    orders: f.get("orders"),
                    status: f.get("status"),
                  });
                }}
              >
                <label className="flex flex-col gap-0.5">
                  <span className="text-slate-500">出品URL</span>
                  <input
                    name="url"
                    defaultValue={l.url}
                    placeholder="https://coconala.com/services/..."
                    className="w-56 rounded border px-1.5 py-1"
                    style={{ borderColor: "var(--card-border)" }}
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-slate-500">閲覧</span>
                  <input
                    name="views"
                    type="number"
                    min={0}
                    defaultValue={l.views}
                    className="w-20 rounded border px-1.5 py-1"
                    style={{ borderColor: "var(--card-border)" }}
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-slate-500">問い合わせ</span>
                  <input
                    name="inquiries"
                    type="number"
                    min={0}
                    defaultValue={l.inquiries}
                    className="w-20 rounded border px-1.5 py-1"
                    style={{ borderColor: "var(--card-border)" }}
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-slate-500">受注</span>
                  <input
                    name="orders"
                    type="number"
                    min={0}
                    defaultValue={l.orders}
                    className="w-20 rounded border px-1.5 py-1"
                    style={{ borderColor: "var(--card-border)" }}
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-slate-500">状態</span>
                  <select
                    name="status"
                    defaultValue={l.status}
                    className="rounded border px-1.5 py-1"
                    style={{ borderColor: "var(--card-border)" }}
                  >
                    <option value="published">出品中</option>
                    <option value="paused">停止中</option>
                    <option value="closed">取り下げ</option>
                  </select>
                </label>
                <button type="submit" className="btn-primary text-xs" disabled={saving === l.id}>
                  {saving === l.id ? "保存中" : "保存"}
                </button>
                {l.url && (
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-1 underline text-slate-500"
                  >
                    <ExternalLink className="w-3 h-3" />
                    開く
                  </a>
                )}
              </form>

              {l.lastCheckedAt && (
                <p className="text-[11px] text-slate-400 mt-2">
                  最終更新: {l.lastCheckedAt.slice(0, 16).replace("T", " ")}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
