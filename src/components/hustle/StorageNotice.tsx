"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Download, Upload } from "lucide-react";
import { useHustleStore } from "@/store/useHustleStore";

/**
 * サーバー側ストレージが揮発する環境（Vercel 等）で、
 * データがブラウザ側に退避されていることを説明し、手動バックアップも促す。
 */
export default function StorageNotice() {
  const { meta, exportBackup, importBackup, error } = useHustleStore();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(sessionStorage.getItem("hustle-storage-notice") === "1");
  }, []);

  function handleExport() {
    const backup = exportBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hustle-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        void importBackup(JSON.parse(String(reader.result)));
      } catch {
        alert("バックアップファイルを読み込めませんでした");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  if (error) {
    return (
      <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (!meta.ephemeralStorage || dismissed) {
    return (
      <div className="mb-4 flex justify-end gap-2 text-xs">
        <button onClick={handleExport} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-slate-600 hover:bg-slate-50" style={{ borderColor: "var(--card-border)" }}>
          <Download className="w-3.5 h-3.5" />
          バックアップ書き出し
        </button>
        <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-slate-600 hover:bg-slate-50 cursor-pointer" style={{ borderColor: "var(--card-border)" }}>
          <Upload className="w-3.5 h-3.5" />
          読み込み
          <input type="file" accept="application/json" className="hidden" onChange={handleImport} />
        </label>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold mb-1">この環境ではサーバー側の保存が一時的です</p>
          <p className="text-xs leading-relaxed">
            記録はこのブラウザにも自動で複製され、サーバーが初期化されたら自動で書き戻します。
            ただしブラウザのデータを消すと失われるので、ときどきファイルに書き出してください。
          </p>
          <div className="flex gap-2 mt-2">
            <button onClick={handleExport} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white border border-blue-300 text-xs font-medium hover:bg-blue-100">
              <Download className="w-3.5 h-3.5" />
              いま書き出す
            </button>
            <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white border border-blue-300 text-xs font-medium hover:bg-blue-100 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              読み込む
              <input type="file" accept="application/json" className="hidden" onChange={handleImport} />
            </label>
            <button
              onClick={() => {
                sessionStorage.setItem("hustle-storage-notice", "1");
                setDismissed(true);
              }}
              className="px-2.5 py-1.5 text-xs text-blue-700 hover:underline"
            >
              閉じる
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
