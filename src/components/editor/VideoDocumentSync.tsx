"use client";

import { useState, useEffect } from "react";
import {
  Link2,
  Unlink,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ArrowLeftRight,
  Clock,
  Video,
  FileText,
  Bell,
  BellOff,
  ChevronDown,
  ChevronUp,
  Eye,
  X,
} from "lucide-react";
import type { WorkStandard, VideoDocumentLink, SyncAlert } from "@/types";

interface VideoDocumentSyncProps {
  workStandard: WorkStandard;
  videoFile?: File | null;
  onSeekVideo?: (time: number) => void;
}

const syncStatusConfig: Record<VideoDocumentLink["syncStatus"], { label: string; color: string; bgColor: string }> = {
  synced: { label: "同期済み", color: "#10b981", bgColor: "#d1fae5" },
  "video-updated": { label: "動画更新あり", color: "#f59e0b", bgColor: "#fef3c7" },
  "document-updated": { label: "文書更新あり", color: "#3b82f6", bgColor: "#dbeafe" },
  conflict: { label: "競合", color: "#ef4444", bgColor: "#fee2e2" },
};

export default function VideoDocumentSync({
  workStandard,
  videoFile,
  onSeekVideo,
}: VideoDocumentSyncProps) {
  const [links, setLinks] = useState<VideoDocumentLink[]>([]);
  const [alerts, setAlerts] = useState<SyncAlert[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [showAlerts, setShowAlerts] = useState(true);
  const [expandedLink, setExpandedLink] = useState<string | null>(null);

  // Initialize links from work standard steps
  useEffect(() => {
    if (workStandard && links.length === 0) {
      const initialLinks: VideoDocumentLink[] = workStandard.steps.map((step) => ({
        id: crypto.randomUUID(),
        stepId: step.id,
        videoTimestamp: step.videoTimestamp,
        documentSection: `Step ${step.stepNumber}: ${step.title}`,
        syncStatus: "synced" as const,
        lastSyncedAt: new Date().toISOString(),
      }));
      setLinks(initialLinks);
    }
  }, [workStandard, links.length]);

  const runSyncCheck = async () => {
    setIsScanning(true);
    const newAlerts: SyncAlert[] = [];
    const updatedLinks = [...links];

    for (let i = 0; i < updatedLinks.length; i++) {
      await new Promise((r) => setTimeout(r, 200 + Math.random() * 200));

      const link = updatedLinks[i];
      const step = workStandard.steps.find((s) => s.id === link.stepId);
      if (!step) continue;

      // Simulate detecting changes
      const rand = Math.random();

      if (rand > 0.75) {
        // Video has been updated
        updatedLinks[i] = { ...link, syncStatus: "video-updated" };
        newAlerts.push({
          id: crypto.randomUUID(),
          linkId: link.id,
          type: "video-changed",
          description: `ステップ${step.stepNumber}「${step.title}」の動画区間に変更が検出されました。文書の更新が必要です。`,
          stepId: step.id,
          stepTitle: step.title,
          createdAt: new Date().toISOString(),
          resolved: false,
        });
      } else if (rand > 0.6) {
        // Document has been updated
        updatedLinks[i] = { ...link, syncStatus: "document-updated" };
        newAlerts.push({
          id: crypto.randomUUID(),
          linkId: link.id,
          type: "document-changed",
          description: `ステップ${step.stepNumber}「${step.title}」の文書が更新されましたが、対応する動画区間が古いままです。`,
          stepId: step.id,
          stepTitle: step.title,
          createdAt: new Date().toISOString(),
          resolved: false,
        });
      } else if (rand > 0.55) {
        // Conflict
        updatedLinks[i] = { ...link, syncStatus: "conflict" };
        newAlerts.push({
          id: crypto.randomUUID(),
          linkId: link.id,
          type: "video-changed",
          description: `ステップ${step.stepNumber}「${step.title}」で動画と文書の両方が変更されています。手動での確認が必要です。`,
          stepId: step.id,
          stepTitle: step.title,
          createdAt: new Date().toISOString(),
          resolved: false,
        });
      } else {
        // Synced
        updatedLinks[i] = { ...link, syncStatus: "synced", lastSyncedAt: new Date().toISOString() };
      }
    }

    setLinks(updatedLinks);
    setAlerts((prev) => [...newAlerts, ...prev]);
    setIsScanning(false);
  };

  const resolveAlert = (alertId: string) => {
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === alertId ? { ...a, resolved: true, resolvedAt: new Date().toISOString() } : a
      )
    );
  };

  const markAsSynced = (linkId: string) => {
    setLinks((prev) =>
      prev.map((l) =>
        l.id === linkId ? { ...l, syncStatus: "synced" as const, lastSyncedAt: new Date().toISOString() } : l
      )
    );
    // Resolve related alerts
    setAlerts((prev) =>
      prev.map((a) =>
        a.linkId === linkId ? { ...a, resolved: true, resolvedAt: new Date().toISOString() } : a
      )
    );
  };

  const unresolvedAlerts = alerts.filter((a) => !a.resolved);
  const syncedCount = links.filter((l) => l.syncStatus === "synced").length;
  const unsyncedCount = links.length - syncedCount;

  const formatTimestamp = (ts: { start: number; end: number }) => {
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    return `${fmt(ts.start)} - ${fmt(ts.end)}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="w-5 h-5 text-cyan-500" />
          <h3 className="font-bold text-slate-900">動画-文書 双方向同期</h3>
        </div>
        <div className="flex items-center gap-2">
          {unresolvedAlerts.length > 0 && (
            <button
              onClick={() => setShowAlerts(!showAlerts)}
              className="relative btn-secondary flex items-center gap-1 text-xs py-1 px-2"
            >
              {showAlerts ? <BellOff className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
              {showAlerts ? "通知非表示" : "通知表示"}
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                {unresolvedAlerts.length}
              </span>
            </button>
          )}
          <button
            onClick={runSyncCheck}
            disabled={isScanning}
            className="btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3 disabled:opacity-50"
            style={{ background: "#06b6d4" }}
          >
            <RefreshCw className={`w-4 h-4 ${isScanning ? "animate-spin" : ""}`} />
            {isScanning ? "スキャン中..." : "同期チェック"}
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-500">
        各作業ステップと動画の対応区間を追跡し、どちらかが更新された際に自動的にフラグを立てます。
        動画の再撮影や文書の改訂を検知し、整合性を維持します。
      </p>

      {/* Summary Bar */}
      <div className="grid grid-cols-4 gap-3">
        <div className="card flex items-center gap-2 py-3">
          <Link2 className="w-5 h-5 text-slate-400" />
          <div>
            <div className="text-lg font-bold text-slate-900">{links.length}</div>
            <div className="text-xs text-slate-500">リンク総数</div>
          </div>
        </div>
        <div className="card flex items-center gap-2 py-3">
          <CheckCircle2 className="w-5 h-5 text-green-500" />
          <div>
            <div className="text-lg font-bold text-green-600">{syncedCount}</div>
            <div className="text-xs text-slate-500">同期済み</div>
          </div>
        </div>
        <div className="card flex items-center gap-2 py-3">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <div>
            <div className="text-lg font-bold text-amber-600">{unsyncedCount}</div>
            <div className="text-xs text-slate-500">要確認</div>
          </div>
        </div>
        <div className="card flex items-center gap-2 py-3">
          <Bell className="w-5 h-5 text-red-500" />
          <div>
            <div className="text-lg font-bold text-red-600">{unresolvedAlerts.length}</div>
            <div className="text-xs text-slate-500">未解決通知</div>
          </div>
        </div>
      </div>

      {/* Unresolved Alerts */}
      {showAlerts && unresolvedAlerts.length > 0 && (
        <div className="card border-l-4" style={{ borderLeftColor: "#f59e0b" }}>
          <h4 className="font-medium text-sm text-amber-800 mb-3 flex items-center gap-2">
            <Bell className="w-4 h-4" />
            未解決の同期アラート ({unresolvedAlerts.length})
          </h4>
          <div className="space-y-2">
            {unresolvedAlerts.slice(0, 5).map((alert) => (
              <div
                key={alert.id}
                className="flex items-start gap-3 p-2 bg-amber-50 rounded-lg"
              >
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700">{alert.description}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {new Date(alert.createdAt).toLocaleString("ja-JP")}
                  </p>
                </div>
                <button
                  onClick={() => resolveAlert(alert.id)}
                  className="text-xs text-amber-700 hover:text-amber-900 bg-amber-100 px-2 py-1 rounded flex-shrink-0"
                >
                  解決
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Link List */}
      <div className="space-y-2">
        {links.map((link) => {
          const step = workStandard.steps.find((s) => s.id === link.stepId);
          if (!step) return null;
          const statusConf = syncStatusConfig[link.syncStatus];
          const isExpanded = expandedLink === link.id;

          return (
            <div
              key={link.id}
              className="border rounded-lg bg-white overflow-hidden"
              style={{ borderColor: "var(--card-border)" }}
            >
              <div
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-slate-50"
                onClick={() => setExpandedLink(isExpanded ? null : link.id)}
              >
                {/* Sync Status Indicator */}
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: statusConf.color }}
                />

                {/* Step Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">
                      Step {step.stepNumber}: {step.title}
                    </span>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ background: statusConf.bgColor, color: statusConf.color }}
                    >
                      {statusConf.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <Video className="w-3 h-3" />
                      {formatTimestamp(link.videoTimestamp)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      最終同期: {new Date(link.lastSyncedAt).toLocaleString("ja-JP")}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {link.syncStatus !== "synced" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        markAsSynced(link.id);
                      }}
                      className="p-1.5 bg-green-50 hover:bg-green-100 rounded text-green-600"
                      title="同期済みとしてマーク"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {onSeekVideo && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSeekVideo(link.videoTimestamp.start);
                      }}
                      className="p-1.5 hover:bg-slate-100 rounded text-slate-500"
                      title="動画の該当位置へ移動"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </div>
              </div>

              {/* Expanded Detail */}
              {isExpanded && (
                <div className="border-t p-4 space-y-3" style={{ borderColor: "var(--card-border)" }}>
                  <div className="grid grid-cols-2 gap-4">
                    {/* Video Side */}
                    <div className="bg-slate-50 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Video className="w-4 h-4 text-blue-500" />
                        <h5 className="text-xs font-medium text-slate-700">動画区間</h5>
                      </div>
                      <div className="space-y-1 text-xs text-slate-600">
                        <p>開始: {Math.floor(link.videoTimestamp.start / 60)}分{Math.floor(link.videoTimestamp.start % 60)}秒</p>
                        <p>終了: {Math.floor(link.videoTimestamp.end / 60)}分{Math.floor(link.videoTimestamp.end % 60)}秒</p>
                        <p>長さ: {link.videoTimestamp.end - link.videoTimestamp.start}秒</p>
                      </div>
                      {onSeekVideo && (
                        <button
                          onClick={() => onSeekVideo(link.videoTimestamp.start)}
                          className="mt-2 text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3" /> 動画で確認
                        </button>
                      )}
                    </div>

                    {/* Document Side */}
                    <div className="bg-slate-50 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <FileText className="w-4 h-4 text-green-500" />
                        <h5 className="text-xs font-medium text-slate-700">文書セクション</h5>
                      </div>
                      <div className="space-y-1 text-xs text-slate-600">
                        <p>セクション: {link.documentSection}</p>
                        <p>説明: {step.description || "（説明なし）"}</p>
                        <p>ポイント数: {step.keyPoints.length}</p>
                        <p>注意事項数: {step.cautions.length}</p>
                      </div>
                    </div>
                  </div>

                  {/* Sync Actions */}
                  {link.syncStatus !== "synced" && (
                    <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: "var(--card-border)" }}>
                      <button
                        onClick={() => markAsSynced(link.id)}
                        className="btn-primary text-xs py-1 px-3"
                        style={{ background: "#10b981" }}
                      >
                        同期済みとしてマーク
                      </button>
                      <span className="text-xs text-slate-400">
                        内容を確認してから同期済みにしてください
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {links.length === 0 && (
        <div className="card text-center py-12">
          <ArrowLeftRight className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h4 className="font-medium text-slate-700 mb-1">リンクがありません</h4>
          <p className="text-sm text-slate-500">
            作業標準書のステップが作成されると、自動的に動画-文書リンクが生成されます。
          </p>
        </div>
      )}
    </div>
  );
}
