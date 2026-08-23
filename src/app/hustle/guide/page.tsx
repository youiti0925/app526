"use client";

import { BookOpen, Phone, AlertCircle, Scale, Lightbulb } from "lucide-react";
import { EMERGENCY_RESOURCES, TAX_NOTES, REALITY_CHECKS } from "@/lib/hustle/guide-data";

export default function GuidePage() {
  const now = EMERGENCY_RESOURCES.filter((r) => r.urgency === "now");
  const soon = EMERGENCY_RESOURCES.filter((r) => r.urgency !== "now");

  return (
    <div className="p-8 max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-emerald-600" />
          現実と相談窓口
        </h1>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          このアプリを作るにあたって調べた、副業市場の実際のところと、
          副業より先に使うべき制度をまとめてあります。
        </p>
      </header>

      <section className="mb-8">
        <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-6">
          <h2 className="font-bold flex items-center gap-2 text-rose-900">
            <AlertCircle className="w-5 h-5" />
            今日・今週の生活費が足りないなら、先にこちら
          </h2>
          <p className="text-sm text-rose-900 mt-2 leading-relaxed">
            副業で最初の1円が口座に入るまで、どんなに速くても2〜3週間かかります。
            家賃や光熱費の期限がそれより早いなら、副業では間に合いません。
            下の窓口は無料で、相談したこと自体が不利になることはありません。
          </p>
          <div className="mt-4 space-y-3">
            {now.map((r) => (
              <ResourceCard key={r.name} resource={r} />
            ))}
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="font-semibold mb-3">もう少し先を見据えた制度</h2>
        <div className="space-y-3">
          {soon.map((r) => (
            <ResourceCard key={r.name} resource={r} />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="font-semibold flex items-center gap-2 mb-1">
          <Lightbulb className="w-5 h-5 text-amber-500" />
          よく言われていることと、調べた結果
        </h2>
        <p className="text-sm text-slate-600 mb-3">
          市場調査で確認できた範囲の事実です。気持ちのいい話は書いていません。
        </p>
        <div className="space-y-3">
          {REALITY_CHECKS.map((c) => (
            <div key={c.claim} className="card">
              <p className="text-sm font-medium text-slate-500 line-through decoration-rose-400 decoration-2">
                「{c.claim}」
              </p>
              <p className="text-sm mt-2 leading-relaxed">{c.reality}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <Scale className="w-5 h-5 text-slate-500" />
          税金と勤務先まわりで、後から効いてくること
        </h2>
        <div className="space-y-3">
          {TAX_NOTES.map((n) => (
            <div key={n.title} className="card">
              <h3 className="font-semibold text-sm">{n.title}</h3>
              <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{n.body}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-3">
          税制は改正されます。金額が大きくなってきたら、お住まいの税務署（相談は無料）か税理士に確認してください。
        </p>
      </section>

      <section>
        <h2 className="font-semibold mb-3">このアプリが意図的に作らなかったもの</h2>
        <div className="card">
          <ul className="space-y-2 text-sm">
            {[
              ["自動応募・自動営業", "各プラットフォームの規約でBAN対象です。提案は1件ずつ相手を見て書く前提で作っています。"],
              ["検索結果の自動収集", "Google の利用規約と robots.txt に反します。キーワード調査は手作業か公式APIに限定しています。"],
              ["AI記事の自動投稿", "Googleのスパムポリシーに直撃し、ブログサービス側の規約でも禁止されています。生成物は必ず人が確認する導線にしています。"],
              ["収益の予測グラフ", "予測が当たらないだけでなく、当たると信じさせること自体が有害です。実績のみを表示します。"],
              ["有料プラン・アフィリエイトリンク", "このアプリはあなたから1円も取りません。稼げない人から金を取る構造を作らないためです。"],
            ].map(([title, body]) => (
              <li key={title}>
                <span className="font-medium">{title}</span>
                <p className="text-slate-600 text-xs mt-0.5 leading-relaxed">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function ResourceCard({ resource }: { resource: (typeof EMERGENCY_RESOURCES)[number] }) {
  return (
    <div className="rounded-lg bg-white border p-4" style={{ borderColor: "var(--card-border)" }}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-sm">{resource.name}</h3>
        {resource.contact && (
          <span className="badge badge-danger gap-1 shrink-0 tabular-nums">
            <Phone className="w-3 h-3" />
            {resource.contact}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-700 mt-1.5 leading-relaxed">{resource.what}</p>
      <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{resource.how}</p>
    </div>
  );
}
