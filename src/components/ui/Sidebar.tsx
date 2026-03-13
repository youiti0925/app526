"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderOpen,
  PlusCircle,
  FileText,
  Settings,
  HelpCircle,
  Video,
  ClipboardCheck,
  BarChart3,
} from "lucide-react";

const navItems = [
  { href: "/", label: "ダッシュボード", icon: LayoutDashboard },
  { href: "/projects", label: "プロジェクト一覧", icon: FolderOpen },
  { href: "/projects/new", label: "新規作成", icon: PlusCircle },
];

const secondaryItems = [
  { href: "#templates", label: "テンプレート", icon: FileText },
  { href: "#analytics", label: "分析レポート", icon: BarChart3 },
  { href: "#settings", label: "設定", icon: Settings },
  { href: "#help", label: "ヘルプ", icon: HelpCircle },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 min-h-screen flex flex-col" style={{ background: "var(--sidebar-bg)", color: "var(--sidebar-text)" }}>
      <div className="p-5 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
            <Video className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-white">VideoSOP Pro</h1>
            <p className="text-xs text-slate-400">作業標準書 自動生成</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4">
        <div className="mb-6">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-3">
            メイン
          </p>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 transition-all text-sm ${
                  isActive
                    ? "bg-blue-600 text-white font-medium"
                    : "text-slate-300 hover:bg-slate-700 hover:text-white"
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-3">
            ツール
          </p>
          {secondaryItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 transition-all text-sm text-slate-300 hover:bg-slate-700 hover:text-white"
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="p-4 border-t border-slate-700">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-sm font-bold text-white">
            田
          </div>
          <div>
            <p className="text-sm font-medium text-white">田中 太郎</p>
            <p className="text-xs text-slate-400">品質管理部</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
