"use client";

import { Bell, Search, Globe, Moon } from "lucide-react";
import { useState } from "react";

export default function Header() {
  const [searchQuery, setSearchQuery] = useState("");
  const [language, setLanguage] = useState<"ja" | "en">("ja");

  return (
    <header className="h-16 border-b flex items-center justify-between px-6" style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <div className="flex items-center gap-4 flex-1">
        <div className="relative w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="プロジェクト・作業標準書を検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            style={{ borderColor: "var(--card-border)" }}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => setLanguage(language === "ja" ? "en" : "ja")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm hover:bg-slate-100 transition-colors"
        >
          <Globe className="w-4 h-4" />
          {language === "ja" ? "日本語" : "English"}
        </button>

        <button className="p-2 rounded-lg hover:bg-slate-100 transition-colors relative">
          <Bell className="w-5 h-5 text-slate-600" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
        </button>

        <button className="p-2 rounded-lg hover:bg-slate-100 transition-colors">
          <Moon className="w-5 h-5 text-slate-600" />
        </button>
      </div>
    </header>
  );
}
