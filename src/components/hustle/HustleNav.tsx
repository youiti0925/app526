"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Wallet,
  Compass,
  ListChecks,
  Factory,
  Handshake,
  Layers,
  Bot,
  Telescope,
  FlaskConical,
  Store,
  Inbox,
  ShieldAlert,
  BookOpen,
  ArrowLeft,
  Settings,
} from "lucide-react";

const items = [
  { href: "/hustle", label: "今日やること", icon: ListChecks, exact: true },
  { href: "/hustle/inbox", label: "承認キュー", icon: Inbox, badge: true },
  { href: "/hustle/agent", label: "自律運転", icon: Bot },
  { href: "/hustle/discovery", label: "市場を探す", icon: Telescope },
  { href: "/hustle/dryrun", label: "試作の検証", icon: FlaskConical },
  { href: "/hustle/listings", label: "出品の実績", icon: Store },
  { href: "/hustle/diagnose", label: "副業を選ぶ", icon: Compass },
  { href: "/hustle/proposal", label: "案件を判定・提案", icon: Handshake },
  { href: "/hustle/batch", label: "案件をまとめて判定", icon: Layers },
  { href: "/hustle/factory", label: "コンテンツ量産", icon: Factory },
  { href: "/hustle/money", label: "収支と実効時給", icon: Wallet },
  { href: "/hustle/scam", label: "詐欺チェック", icon: ShieldAlert },
  { href: "/hustle/guide", label: "現実と相談窓口", icon: BookOpen },
];

export default function HustleNav() {
  const pathname = usePathname();
  const [pending, setPending] = useState(0);

  // 承認待ちの件数はナビに常に出す。溜まっていることに気づけないと、
  // エージェントが作ったものが誰にも見られないまま腐る。
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/hustle/agent/state")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (alive && d) setPending(d.inboxCount ?? 0);
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [pathname]);

  return (
    <aside
      className="w-60 shrink-0 min-h-screen flex flex-col"
      style={{ background: "var(--sidebar-bg)", color: "var(--sidebar-text)" }}
    >
      <div className="p-5 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center">
            <Wallet className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-base text-white leading-tight">副業パイプライン</h1>
            <p className="text-xs text-slate-400">作業を自動化して最初の1円へ</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 transition-all text-sm ${
                isActive
                  ? "bg-emerald-600 text-white font-medium"
                  : "text-slate-300 hover:bg-slate-700 hover:text-white"
              }`}
            >
              <Icon className="shrink-0" style={{ width: 18, height: 18 }} />
              <span className="flex-1">{item.label}</span>
              {"badge" in item && item.badge && pending > 0 && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-rose-500 text-white tabular-nums">
                  {pending}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-700 space-y-1">
        <Link
          href="/settings"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
        >
          <Settings className="w-4 h-4" />
          APIキーの設定
        </Link>
        <Link
          href="/"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          VideoSOP Pro に戻る
        </Link>
      </div>
    </aside>
  );
}
