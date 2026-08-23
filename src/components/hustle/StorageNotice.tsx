"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Download, Upload, X } from "lucide-react";
import { useHustleStore } from "@/store/useHustleStore";

/**
 * データの置き場所についての状態表示。
 *
 * このアプリは金の記録を扱うので、「保存されているつもりで消えていた」が
 * 最悪の事故になる。サーバーが揮発性か、ブラウザへの複製ができているか、
 * サーバーに書けていない記録があるか、をそれぞれ別に伝える。
 */
export default function StorageNotice() {
  const { meta, exportBackup, importBackup, error, clearError, mirrorHealthy, unsyncedCount } =
    useHustleStore();
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
        alert("バックアップファイルを読み込めませんでした（JSONとして壊れています）");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  const buttons = (variant: "plain" | "onBanner") => (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={handleExport}
        className={
          variant === "plain"
            ? "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs text-slate-600 hover:bg-slate-50"
            : "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white border text-xs font-medium hover:bg-slate-50"
        }
        style={{ borderColor: "var(--card-border)" }}
      >
        <Download className="w-3.5 h-3.5" />
        バックアップ書き出し
      </button>
      <label
        className={
          variant === "plain"
            ? "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs text-slate-600 hover:bg-slate-50 cursor-pointer"
            : "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white border text-xs font-medium hover:bg-slate-50 cursor-pointer"
        }
        style={{ borderColor: "var(--card-border)" }}
      >
        <Upload className="w-3.5 h-3.5" />
        読み込み
        <input type="file" accept="application/json" className="hidden" onChange={handleImport} />
      </label>
    </div>
  );

  // 最も重い問題から順に、ひとつだけ出す
  if (!mirrorHealthy) {
    return (
      <Banner tone="danger" title="このブラウザに記録を保存できていません">
        <p className="text-xs leading-relaxed">
          プライベートモードか、サイトデータがブロックされている可能性があります。
          サーバー側の保存だけが頼りの状態なので、
          <strong>いま必ずファイルに書き出してください。</strong>
        </p>
        <div className="mt-2">{buttons("onBanner")}</div>
      </Banner>
    );
  }

  if (unsyncedCount > 0) {
    return (
      <Banner tone="warning" title={`サーバーに保存できていない記録が ${unsyncedCount} 件あります`}>
        <p className="text-xs leading-relaxed">
          入力はこのブラウザに残してあり、次にこのページを開いたときに自動で書き戻します。
          別の端末では見えないので、心配ならファイルに書き出しておいてください。
        </p>
        <div className="mt-2">{buttons("onBanner")}</div>
      </Banner>
    );
  }

  if (error) {
    return (
      <Banner tone="warning" title="注意" onClose={clearError}>
        <p className="text-xs leading-relaxed">{error}</p>
      </Banner>
    );
  }

  if (meta.ephemeralStorage && !dismissed) {
    return (
      <Banner tone="info" title="この環境ではサーバー側の保存が一時的です">
        <p className="text-xs leading-relaxed">
          記録はこのブラウザにも自動で複製され、サーバーが初期化されたら自動で書き戻します。
          ただしブラウザのデータを消すと失われるので、ときどきファイルに書き出してください。
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {buttons("onBanner")}
          <button
            onClick={() => {
              sessionStorage.setItem("hustle-storage-notice", "1");
              setDismissed(true);
            }}
            className="px-2.5 py-1.5 text-xs text-slate-600 hover:underline"
          >
            閉じる
          </button>
        </div>
      </Banner>
    );
  }

  return <div className="mb-4 flex justify-end">{buttons("plain")}</div>;
}

function Banner({
  tone,
  title,
  children,
  onClose,
}: {
  tone: "danger" | "warning" | "info";
  title: string;
  children: React.ReactNode;
  onClose?: () => void;
}) {
  const style = {
    danger: { bg: "#fef2f2", border: "#fecaca", text: "#7f1d1d" },
    warning: { bg: "#fffbeb", border: "#fde68a", text: "#78350f" },
    info: { bg: "#eff6ff", border: "#bfdbfe", text: "#1e3a8a" },
  }[tone];

  return (
    <div
      className="mb-4 rounded-lg border px-4 py-3"
      style={{ background: style.bg, borderColor: style.border, color: style.text }}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm mb-1">{title}</p>
          {children}
        </div>
        {onClose && (
          <button onClick={onClose} className="shrink-0 opacity-60 hover:opacity-100" aria-label="閉じる">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
