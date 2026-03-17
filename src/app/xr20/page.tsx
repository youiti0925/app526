"use client";

import { useState, useCallback, useMemo } from "react";
import Sidebar from "@/components/ui/Sidebar";
import Header from "@/components/ui/Header";
import {
  Settings,
  List,
  Monitor,
  Database,
  BarChart3,
  FileText,
  Download,
  Play,
  Pause,
  Square,
  RefreshCw,
  Copy,
  Crosshair,
} from "lucide-react";
import {
  XR20Settings,
  DEFAULT_SETTINGS,
  TargetPoint,
  MeasurementRow,
  EvaluationStats,
  XR20Tab,
} from "@/lib/xr20/types";
import {
  generateTargetList,
  generateNCProgram,
  calculateStats,
  parseCSVData,
} from "@/lib/xr20/calculations";

export default function XR20Page() {
  const [activeTab, setActiveTab] = useState<XR20Tab>("settings");
  const [settings, setSettings] = useState<XR20Settings>(DEFAULT_SETTINGS);
  const [targets, setTargets] = useState<TargetPoint[]>([]);
  const [ncProgram, setNcProgram] = useState("");
  const [csvInput, setCsvInput] = useState("");
  const [measurements, setMeasurements] = useState<MeasurementRow[]>([]);
  const [monitorStatus, setMonitorStatus] = useState<"idle" | "running" | "paused">("idle");
  const [currentPoint, setCurrentPoint] = useState(0);
  const [logMessages, setLogMessages] = useState<string[]>([]);

  const cwData = useMemo(
    () => measurements.filter((m) => m.direction === "cw"),
    [measurements]
  );
  const ccwData = useMemo(
    () => measurements.filter((m) => m.direction === "ccw"),
    [measurements]
  );
  const cwStats = useMemo(() => calculateStats(cwData), [cwData]);
  const ccwStats = useMemo(() => calculateStats(ccwData), [ccwData]);

  const tabs: { id: XR20Tab; label: string; icon: React.ElementType }[] = [
    { id: "settings", label: "設定", icon: Settings },
    { id: "targets", label: "ターゲットリスト", icon: List },
    { id: "control", label: "測定制御", icon: Monitor },
    { id: "data", label: "測定データ", icon: Database },
    { id: "results", label: "評価結果", icon: BarChart3 },
    { id: "report", label: "成績書", icon: FileText },
  ];

  const handleGenerateTargets = useCallback(() => {
    const list = generateTargetList(settings);
    setTargets(list);
    setActiveTab("targets");
  }, [settings]);

  const handleGenerateNC = useCallback(() => {
    if (targets.length === 0) {
      alert("先にターゲットリストを生成してください。");
      return;
    }
    const program = generateNCProgram(targets, settings);
    setNcProgram(program);
  }, [targets, settings]);

  const handleParseData = useCallback(() => {
    if (targets.length === 0) {
      alert("先にターゲットリストを生成してください。");
      return;
    }
    const rows = parseCSVData(csvInput, targets);
    setMeasurements(rows);
    if (rows.length > 0) {
      setActiveTab("results");
    }
  }, [csvInput, targets]);

  const handleDownloadNC = useCallback(() => {
    const blob = new Blob([ncProgram], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "O1000_XR20_EVAL.nc";
    a.click();
    URL.revokeObjectURL(url);
  }, [ncProgram]);

  const handleDownloadPython = useCallback(() => {
    const script = generatePythonScript(settings);
    const blob = new Blob([script], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "carto_monitor.py";
    a.click();
    URL.revokeObjectURL(url);
  }, [settings]);

  const updateSetting = <K extends keyof XR20Settings>(
    key: K,
    value: XR20Settings[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 bg-slate-50">
          <div className="p-6">
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <Crosshair className="w-7 h-7 text-blue-600" />
                XR20 自動トリガー＆ウォームホイール評価ツール
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                Renishaw XR20 回転分割測定器 - CARTO自動F9送信・ウォーム/ホイール評価
              </p>
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-1 mb-6 bg-white rounded-xl p-1 shadow-sm border border-slate-200 overflow-x-auto">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                      activeTab === tab.id
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Tab Content */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              {activeTab === "settings" && (
                <SettingsTab
                  settings={settings}
                  updateSetting={updateSetting}
                  onGenerateTargets={handleGenerateTargets}
                  onGenerateNC={handleGenerateNC}
                  onDownloadPython={handleDownloadPython}
                />
              )}
              {activeTab === "targets" && (
                <TargetsTab targets={targets} />
              )}
              {activeTab === "control" && (
                <ControlTab
                  settings={settings}
                  targets={targets}
                  monitorStatus={monitorStatus}
                  currentPoint={currentPoint}
                  logMessages={logMessages}
                />
              )}
              {activeTab === "data" && (
                <DataTab
                  csvInput={csvInput}
                  setCsvInput={setCsvInput}
                  onParse={handleParseData}
                  measurements={measurements}
                />
              )}
              {activeTab === "results" && (
                <ResultsTab
                  cwData={cwData}
                  ccwData={ccwData}
                  cwStats={cwStats}
                  ccwStats={ccwStats}
                />
              )}
              {activeTab === "report" && (
                <ReportTab
                  settings={settings}
                  cwData={cwData}
                  ccwData={ccwData}
                  cwStats={cwStats}
                  ccwStats={ccwStats}
                />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

/* =========================================================
   Settings Tab
   ========================================================= */
function SettingsTab({
  settings,
  updateSetting,
  onGenerateTargets,
  onGenerateNC,
  onDownloadPython,
}: {
  settings: XR20Settings;
  updateSetting: <K extends keyof XR20Settings>(key: K, value: XR20Settings[K]) => void;
  onGenerateTargets: () => void;
  onGenerateNC: () => void;
  onDownloadPython: () => void;
}) {
  return (
    <div className="space-y-8">
      {/* Machine Info */}
      <section>
        <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">
          機械情報
        </h2>
        <div className="grid grid-cols-3 gap-4">
          <InputField
            label="型式"
            value={settings.machineModel}
            onChange={(v) => updateSetting("machineModel", v)}
            placeholder="例: DMG MORI NTX 2000"
          />
          <InputField
            label="機番"
            value={settings.machineSerial}
            onChange={(v) => updateSetting("machineSerial", v)}
            placeholder="例: 12345"
          />
          <InputField
            label="NC装置型番"
            value={settings.ncModel}
            onChange={(v) => updateSetting("ncModel", v)}
            placeholder="例: FANUC 31i-B5"
          />
        </div>
      </section>

      {/* Evaluation Parameters */}
      <section>
        <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">
          評価パラメータ
        </h2>
        <div className="space-y-4">
          {/* Axis Type */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">軸タイプ</label>
            <div className="flex gap-4">
              <label className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer ${settings.axisType === "rotation" ? "bg-blue-50 border-blue-400 text-blue-700" : "border-slate-300 text-slate-600"}`}>
                <input type="radio" name="axisType" value="rotation" checked={settings.axisType === "rotation"} onChange={() => updateSetting("axisType", "rotation")} className="sr-only" />
                回転軸 (360°)
              </label>
              <label className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer ${settings.axisType === "tilt" ? "bg-blue-50 border-blue-400 text-blue-700" : "border-slate-300 text-slate-600"}`}>
                <input type="radio" name="axisType" value="tilt" checked={settings.axisType === "tilt"} onChange={() => updateSetting("axisType", "tilt")} className="sr-only" />
                傾斜軸 (任意範囲)
              </label>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <NumberField
              label="等分数"
              value={settings.divisions}
              onChange={(v) => updateSetting("divisions", v)}
              min={1}
            />
            {settings.axisType === "tilt" && (
              <>
                <NumberField
                  label="開始角度 (°)"
                  value={settings.startAngle}
                  onChange={(v) => updateSetting("startAngle", v)}
                  step={0.1}
                />
                <NumberField
                  label="終了角度 (°)"
                  value={settings.endAngle}
                  onChange={(v) => updateSetting("endAngle", v)}
                  step={0.1}
                />
              </>
            )}
            <NumberField
              label="オーバーラン角度 (°)"
              value={settings.overrunAngle}
              onChange={(v) => updateSetting("overrunAngle", v)}
              min={0.1}
              step={0.1}
            />
          </div>
        </div>
      </section>

      {/* Monitoring Parameters */}
      <section>
        <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">
          監視パラメータ
        </h2>
        <div className="grid grid-cols-3 gap-4">
          <NumberField
            label="監視間隔 (ms)"
            value={settings.monitorIntervalMs}
            onChange={(v) => updateSetting("monitorIntervalMs", v)}
            min={50}
            step={10}
          />
          <NumberField
            label="安定判定回数"
            value={settings.stabilityCount}
            onChange={(v) => updateSetting("stabilityCount", v)}
            min={3}
          />
          <NumberField
            label="安定閾値 (°)"
            value={settings.stabilityThreshold}
            onChange={(v) => updateSetting("stabilityThreshold", v)}
            min={0}
            step={0.0001}
          />
          <NumberField
            label="F9送信後待機 (ms)"
            value={settings.postF9WaitMs}
            onChange={(v) => updateSetting("postF9WaitMs", v)}
            min={100}
            step={100}
          />
          <NumberField
            label="安定最小時間 (ms)"
            value={settings.stabilityMinTimeMs}
            onChange={(v) => updateSetting("stabilityMinTimeMs", v)}
            min={100}
            step={100}
          />
        </div>
      </section>

      {/* CARTO Settings */}
      <section>
        <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">
          CARTO設定
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="CARTOウィンドウタイトル（部分一致）"
            value={settings.cartoWindowTitle}
            onChange={(v) => updateSetting("cartoWindowTitle", v)}
            placeholder="CARTO"
          />
          <NumberField
            label="NCドウェル時間 (ms)"
            value={settings.dwellTimeMs}
            onChange={(v) => updateSetting("dwellTimeMs", v)}
            min={1000}
            step={500}
          />
        </div>
      </section>

      {/* Action Buttons */}
      <div className="flex gap-3 pt-4 border-t">
        <button onClick={onGenerateTargets} className="btn-primary flex items-center gap-2">
          <List className="w-4 h-4" />
          ターゲットリスト生成
        </button>
        <button onClick={onGenerateNC} className="btn-secondary flex items-center gap-2">
          <Download className="w-4 h-4" />
          NCプログラム生成
        </button>
        <button onClick={onDownloadPython} className="btn-secondary flex items-center gap-2">
          <Download className="w-4 h-4" />
          CARTO監視スクリプト (Python)
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   Targets Tab
   ========================================================= */
function TargetsTab({ targets }: { targets: TargetPoint[] }) {
  const cwCount = targets.filter((t) => t.direction === "cw").length;
  const ccwCount = targets.filter((t) => t.direction === "ccw").length;

  if (targets.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <List className="w-12 h-12 mx-auto mb-3" />
        <p>ターゲットリストが未生成です。設定タブからリストを生成してください。</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">
          ターゲットリスト ({targets.length}点)
        </h2>
        <div className="flex gap-4 text-sm">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-green-500 inline-block" />
            CW: {cwCount}点
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-purple-500 inline-block" />
            CCW: {ccwCount}点
          </span>
        </div>
      </div>

      <div className="overflow-auto max-h-[600px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              <th className="text-left px-4 py-2 font-semibold text-slate-600">No.</th>
              <th className="text-left px-4 py-2 font-semibold text-slate-600">ターゲット角度 (°)</th>
              <th className="text-left px-4 py-2 font-semibold text-slate-600">方向</th>
              <th className="text-left px-4 py-2 font-semibold text-slate-600">ステータス</th>
            </tr>
          </thead>
          <tbody>
            {targets.map((t) => (
              <tr key={t.no} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2 text-slate-700">{t.no}</td>
                <td className="px-4 py-2 font-mono text-slate-800">{t.angle.toFixed(4)}</td>
                <td className="px-4 py-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      t.direction === "cw"
                        ? "bg-green-100 text-green-700"
                        : "bg-purple-100 text-purple-700"
                    }`}
                  >
                    {t.direction === "cw" ? "CW" : "CCW"}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      t.status === "measured"
                        ? "bg-green-100 text-green-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {t.status === "measured" ? "測定済" : "未測定"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* =========================================================
   Control Tab
   ========================================================= */
function ControlTab({
  settings,
  targets,
  monitorStatus,
  currentPoint,
  logMessages,
}: {
  settings: XR20Settings;
  targets: TargetPoint[];
  monitorStatus: "idle" | "running" | "paused";
  currentPoint: number;
  logMessages: string[];
}) {
  const statusLabels = {
    idle: { text: "待機中", color: "bg-slate-100 text-slate-600" },
    running: { text: "監視中", color: "bg-green-100 text-green-700" },
    paused: { text: "一時停止", color: "bg-amber-100 text-amber-700" },
  };
  const status = statusLabels[monitorStatus];

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
        <p className="font-medium mb-1">CARTO監視機能について</p>
        <p>
          CARTO画面監視と自動F9キー送信は、Windows上で動作するPythonスクリプトで実行されます。
          設定タブから「CARTO監視スクリプト (Python)」をダウンロードし、測定PCで実行してください。
        </p>
      </div>

      {/* Status Panel */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-slate-50 rounded-lg p-4">
          <p className="text-xs text-slate-500 mb-1">ステータス</p>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${status.color}`}>
            {status.text}
          </span>
        </div>
        <div className="bg-slate-50 rounded-lg p-4">
          <p className="text-xs text-slate-500 mb-1">現在の測定点</p>
          <p className="text-2xl font-bold text-slate-800">
            {currentPoint} <span className="text-sm font-normal text-slate-500">/ {targets.length}</span>
          </p>
        </div>
        <div className="bg-slate-50 rounded-lg p-4">
          <p className="text-xs text-slate-500 mb-1">残り</p>
          <p className="text-2xl font-bold text-slate-800">{Math.max(0, targets.length - currentPoint)}</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-4">
          <p className="text-xs text-slate-500 mb-1">CARTOウィンドウ</p>
          <p className="text-sm font-medium text-slate-600">{settings.cartoWindowTitle}</p>
        </div>
      </div>

      {/* Control Buttons */}
      <div className="flex gap-3">
        <button className="btn-primary flex items-center gap-2" disabled>
          <Play className="w-4 h-4" /> 監視開始
        </button>
        <button className="btn-secondary flex items-center gap-2" disabled>
          <Pause className="w-4 h-4" /> 一時停止
        </button>
        <button className="btn-secondary flex items-center gap-2" disabled>
          <Square className="w-4 h-4" /> 停止
        </button>
      </div>

      {/* State Machine */}
      <div className="bg-slate-50 rounded-lg p-4">
        <h3 className="text-sm font-bold text-slate-700 mb-3">状態遷移図</h3>
        <div className="flex items-center gap-3 text-xs font-mono flex-wrap">
          <StateBox label="待機中" active={monitorStatus === "idle"} />
          <Arrow />
          <StateBox label="移動検出" />
          <Arrow />
          <StateBox label="安定待ち" />
          <Arrow />
          <StateBox label="F9送信" />
          <Arrow />
          <StateBox label="キャプチャ完了" />
          <Arrow label="繰り返し" />
          <StateBox label="待機中" />
        </div>
      </div>

      {/* Log */}
      <div>
        <h3 className="text-sm font-bold text-slate-700 mb-2">動作ログ</h3>
        <div className="bg-slate-900 text-green-400 rounded-lg p-4 h-48 overflow-auto font-mono text-xs">
          {logMessages.length === 0 ? (
            <p className="text-slate-500">ログはPythonスクリプト側に出力されます。</p>
          ) : (
            logMessages.map((msg, i) => <div key={i}>{msg}</div>)
          )}
        </div>
      </div>
    </div>
  );
}

function StateBox({ label, active }: { label: string; active?: boolean }) {
  return (
    <div
      className={`px-3 py-1.5 rounded border ${
        active ? "bg-blue-100 border-blue-400 text-blue-800" : "bg-white border-slate-300 text-slate-600"
      }`}
    >
      {label}
    </div>
  );
}

function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-slate-400">→</span>
      {label && <span className="text-[10px] text-slate-400">{label}</span>}
    </div>
  );
}

/* =========================================================
   Data Tab
   ========================================================= */
function DataTab({
  csvInput,
  setCsvInput,
  onParse,
  measurements,
}: {
  csvInput: string;
  setCsvInput: (v: string) => void;
  onParse: () => void;
  measurements: MeasurementRow[];
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-800 mb-2">測定データ入力</h2>
        <p className="text-sm text-slate-500 mb-4">
          CARTOからエクスポートしたCSVデータを貼り付けてください。
          形式: ターゲット角度, 測定角度, 誤差(arc sec) （カンマまたはタブ区切り）
        </p>
        <textarea
          className="w-full h-64 border border-slate-300 rounded-lg p-4 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder={`0.0000, 0.0002, 0.72\n10.0000, 10.0001, 0.36\n20.0000, 19.9998, -0.72\n...`}
          value={csvInput}
          onChange={(e) => setCsvInput(e.target.value)}
        />
        <button onClick={onParse} className="btn-primary mt-3 flex items-center gap-2">
          <RefreshCw className="w-4 h-4" /> データ解析
        </button>
      </div>

      {measurements.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-slate-700 mb-2">
            解析済みデータ ({measurements.length}点)
          </h3>
          <div className="overflow-auto max-h-[400px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">No.</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">ターゲット角度</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">測定角度</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">誤差 (arc sec)</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">方向</th>
                </tr>
              </thead>
              <tbody>
                {measurements.map((m) => (
                  <tr key={m.no} className="border-t border-slate-100">
                    <td className="px-3 py-2">{m.no}</td>
                    <td className="px-3 py-2 font-mono">{m.targetAngle.toFixed(4)}</td>
                    <td className="px-3 py-2 font-mono">{m.measuredAngle.toFixed(4)}</td>
                    <td className={`px-3 py-2 font-mono ${m.errorArcSec > 0 ? "text-red-600" : m.errorArcSec < 0 ? "text-blue-600" : ""}`}>
                      {m.errorArcSec.toFixed(2)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        m.direction === "cw" ? "bg-green-100 text-green-700" : "bg-purple-100 text-purple-700"
                      }`}>
                        {m.direction === "cw" ? "CW" : "CCW"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   Results Tab
   ========================================================= */
function ResultsTab({
  cwData,
  ccwData,
  cwStats,
  ccwStats,
}: {
  cwData: MeasurementRow[];
  ccwData: MeasurementRow[];
  cwStats: EvaluationStats;
  ccwStats: EvaluationStats;
}) {
  if (cwData.length === 0 && ccwData.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <BarChart3 className="w-12 h-12 mx-auto mb-3" />
        <p>測定データがありません。データタブからデータを入力してください。</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {cwData.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-green-500 inline-block" />
            CW 評価結果
          </h2>
          <StatsCards stats={cwStats} />
          <div className="mt-4">
            <BarChartSVG data={cwData} color="#3b82f6" title="CW 各位置の誤差 (arc sec)" />
          </div>
          <DataTable data={cwData} />
        </section>
      )}

      {ccwData.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-purple-500 inline-block" />
            CCW 評価結果
          </h2>
          <StatsCards stats={ccwStats} />
          <div className="mt-4">
            <BarChartSVG data={ccwData} color="#8b5cf6" title="CCW 各位置の誤差 (arc sec)" />
          </div>
          <DataTable data={ccwData} />
        </section>
      )}
    </div>
  );
}

function StatsCards({ stats }: { stats: EvaluationStats }) {
  const items = [
    { label: "測定点数", value: stats.count.toString(), unit: "点" },
    { label: "最大誤差", value: stats.maxError.toFixed(2), unit: "arc sec" },
    { label: "最小誤差", value: stats.minError.toFixed(2), unit: "arc sec" },
    { label: "平均誤差", value: stats.meanError.toFixed(2), unit: "arc sec" },
    { label: "標準偏差 (σ)", value: stats.sigma.toFixed(2), unit: "arc sec" },
    { label: "割出し精度", value: stats.indexAccuracy.toFixed(2), unit: "arc sec" },
  ];

  return (
    <div className="grid grid-cols-6 gap-3">
      {items.map((item) => (
        <div key={item.label} className="bg-slate-50 rounded-lg p-3 text-center">
          <p className="text-xs text-slate-500">{item.label}</p>
          <p className="text-xl font-bold text-slate-800 mt-1">{item.value}</p>
          <p className="text-xs text-slate-400">{item.unit}</p>
        </div>
      ))}
    </div>
  );
}

function BarChartSVG({
  data,
  color,
  title,
}: {
  data: MeasurementRow[];
  color: string;
  title: string;
}) {
  const width = 800;
  const height = 300;
  const padding = { top: 30, right: 20, bottom: 50, left: 60 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const errors = data.map((d) => d.errorArcSec);
  const maxAbs = Math.max(Math.abs(Math.max(...errors)), Math.abs(Math.min(...errors)), 1);
  const yMin = -maxAbs * 1.2;
  const yMax = maxAbs * 1.2;
  const barW = Math.max(2, chartW / data.length - 2);

  const scaleY = (v: number) =>
    padding.top + chartH - ((v - yMin) / (yMax - yMin)) * chartH;
  const zeroY = scaleY(0);

  return (
    <div className="bg-slate-50 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-2">{title}</h3>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        {/* Grid */}
        <line x1={padding.left} y1={zeroY} x2={width - padding.right} y2={zeroY} stroke="#94a3b8" strokeWidth={1} />
        {[-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs].map((v) => (
          <g key={v}>
            <line
              x1={padding.left}
              y1={scaleY(v)}
              x2={width - padding.right}
              y2={scaleY(v)}
              stroke="#e2e8f0"
              strokeWidth={0.5}
              strokeDasharray={v === 0 ? "0" : "4,4"}
            />
            <text x={padding.left - 8} y={scaleY(v) + 4} textAnchor="end" fontSize={10} fill="#64748b">
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        {/* Bars */}
        {data.map((d, i) => {
          const x = padding.left + (i / data.length) * chartW + 1;
          const barHeight = Math.abs(scaleY(d.errorArcSec) - zeroY);
          const y = d.errorArcSec >= 0 ? scaleY(d.errorArcSec) : zeroY;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={barW}
              height={barHeight}
              fill={color}
              opacity={0.8}
              rx={1}
            >
              <title>{`${d.targetAngle.toFixed(2)}°: ${d.errorArcSec.toFixed(2)} arc sec`}</title>
            </rect>
          );
        })}
        {/* X axis labels */}
        {data
          .filter((_, i) => i % Math.max(1, Math.floor(data.length / 10)) === 0)
          .map((d, i) => {
            const idx = data.indexOf(d);
            const x = padding.left + (idx / data.length) * chartW + barW / 2;
            return (
              <text key={i} x={x} y={height - 10} textAnchor="middle" fontSize={9} fill="#64748b">
                {d.targetAngle.toFixed(1)}°
              </text>
            );
          })}
        {/* Y axis label */}
        <text x={15} y={height / 2} textAnchor="middle" fontSize={10} fill="#64748b" transform={`rotate(-90, 15, ${height / 2})`}>
          arc sec
        </text>
      </svg>
    </div>
  );
}

function LineChartSVG({
  data,
  color,
  title,
}: {
  data: MeasurementRow[];
  color: string;
  title: string;
}) {
  const width = 800;
  const height = 300;
  const padding = { top: 30, right: 20, bottom: 50, left: 60 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const errors = data.map((d) => d.errorArcSec);
  const maxAbs = Math.max(Math.abs(Math.max(...errors)), Math.abs(Math.min(...errors)), 1);
  const yMin = -maxAbs * 1.2;
  const yMax = maxAbs * 1.2;

  const scaleX = (i: number) => padding.left + (i / Math.max(1, data.length - 1)) * chartW;
  const scaleY = (v: number) => padding.top + chartH - ((v - yMin) / (yMax - yMin)) * chartH;
  const zeroY = scaleY(0);

  const pathD = data.map((d, i) => `${i === 0 ? "M" : "L"} ${scaleX(i)} ${scaleY(d.errorArcSec)}`).join(" ");

  return (
    <div className="bg-slate-50 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-2">{title}</h3>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        <line x1={padding.left} y1={zeroY} x2={width - padding.right} y2={zeroY} stroke="#94a3b8" strokeWidth={1} />
        {[-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs].map((v) => (
          <g key={v}>
            <line
              x1={padding.left}
              y1={scaleY(v)}
              x2={width - padding.right}
              y2={scaleY(v)}
              stroke="#e2e8f0"
              strokeWidth={0.5}
              strokeDasharray={v === 0 ? "0" : "4,4"}
            />
            <text x={padding.left - 8} y={scaleY(v) + 4} textAnchor="end" fontSize={10} fill="#64748b">
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        <path d={pathD} fill="none" stroke={color} strokeWidth={2} />
        {data.map((d, i) => (
          <circle key={i} cx={scaleX(i)} cy={scaleY(d.errorArcSec)} r={3} fill={color}>
            <title>{`${d.targetAngle.toFixed(4)}°: ${d.errorArcSec.toFixed(2)} arc sec`}</title>
          </circle>
        ))}
        {data.map((d, i) => (
          <text key={i} x={scaleX(i)} y={height - 10} textAnchor="middle" fontSize={9} fill="#64748b">
            {d.targetAngle.toFixed(2)}°
          </text>
        ))}
        <text x={15} y={height / 2} textAnchor="middle" fontSize={10} fill="#64748b" transform={`rotate(-90, 15, ${height / 2})`}>
          arc sec
        </text>
      </svg>
    </div>
  );
}

function DataTable({ data }: { data: MeasurementRow[] }) {
  return (
    <div className="mt-4 overflow-auto max-h-[300px]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-100">
          <tr>
            <th className="text-left px-3 py-2 font-semibold text-slate-600">No.</th>
            <th className="text-left px-3 py-2 font-semibold text-slate-600">ターゲット角度 (°)</th>
            <th className="text-left px-3 py-2 font-semibold text-slate-600">測定角度 (°)</th>
            <th className="text-left px-3 py-2 font-semibold text-slate-600">誤差 (arc sec)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((m, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="px-3 py-1.5">{i + 1}</td>
              <td className="px-3 py-1.5 font-mono">{m.targetAngle.toFixed(4)}</td>
              <td className="px-3 py-1.5 font-mono">{m.measuredAngle.toFixed(4)}</td>
              <td className={`px-3 py-1.5 font-mono ${m.errorArcSec > 0 ? "text-red-600" : m.errorArcSec < 0 ? "text-blue-600" : ""}`}>
                {m.errorArcSec.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* =========================================================
   Report Tab
   ========================================================= */
function ReportTab({
  settings,
  cwData,
  ccwData,
  cwStats,
  ccwStats,
}: {
  settings: XR20Settings;
  cwData: MeasurementRow[];
  ccwData: MeasurementRow[];
  cwStats: EvaluationStats;
  ccwStats: EvaluationStats;
}) {
  const handlePrint = () => {
    window.print();
  };

  if (cwData.length === 0 && ccwData.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <FileText className="w-12 h-12 mx-auto mb-3" />
        <p>データがありません。データタブから測定データを入力し評価を行ってください。</p>
      </div>
    );
  }

  const today = new Date().toLocaleDateString("ja-JP");
  const axisLabel = settings.axisType === "rotation" ? "回転軸" : "傾斜軸";
  const rangeInfo = settings.axisType === "rotation" ? "0° ~ 360°" : `${settings.startAngle}° ~ ${settings.endAngle}°`;

  const sections: { label: string; data: MeasurementRow[]; stats: EvaluationStats; bgClass: string; textClass: string; chartColor: string }[] = [
    { label: `CW 評価結果 (${settings.divisions}等分)`, data: cwData, stats: cwStats, bgClass: "bg-green-50", textClass: "text-green-800", chartColor: "#3b82f6" },
    { label: `CCW 評価結果 (${settings.divisions}等分)`, data: ccwData, stats: ccwStats, bgClass: "bg-purple-50", textClass: "text-purple-800", chartColor: "#8b5cf6" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={handlePrint} className="btn-primary flex items-center gap-2">
          <FileText className="w-4 h-4" /> 印刷
        </button>
      </div>

      <div className="border border-slate-300 rounded-lg p-8 bg-white print:border-0 print:p-0" id="report">
        {/* Report Header */}
        <div className="text-center border-b-2 border-slate-800 pb-4 mb-6">
          <h1 className="text-xl font-bold">割出し精度 成績書</h1>
          <p className="text-sm text-slate-500 mt-1">XR20 {axisLabel}評価 (CW/CCW)</p>
        </div>

        {/* Measurement Conditions */}
        <div className="mb-6">
          <h2 className="text-sm font-bold bg-slate-100 px-3 py-1.5 rounded mb-3">測定条件</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            <div className="flex">
              <span className="w-40 text-slate-500">測定日:</span>
              <span className="font-medium">{today}</span>
            </div>
            <div className="flex">
              <span className="w-40 text-slate-500">型式:</span>
              <span className="font-medium">{settings.machineModel || "-"}</span>
            </div>
            <div className="flex">
              <span className="w-40 text-slate-500">機番:</span>
              <span className="font-medium">{settings.machineSerial || "-"}</span>
            </div>
            <div className="flex">
              <span className="w-40 text-slate-500">NC装置:</span>
              <span className="font-medium">{settings.ncModel || "-"}</span>
            </div>
            <div className="flex">
              <span className="w-40 text-slate-500">軸タイプ:</span>
              <span className="font-medium">{axisLabel}</span>
            </div>
            <div className="flex">
              <span className="w-40 text-slate-500">測定範囲:</span>
              <span className="font-medium">{rangeInfo}</span>
            </div>
            <div className="flex">
              <span className="w-40 text-slate-500">等分数:</span>
              <span className="font-medium">{settings.divisions}</span>
            </div>
            <div className="flex">
              <span className="w-40 text-slate-500">オーバーラン角度:</span>
              <span className="font-medium">{settings.overrunAngle}°</span>
            </div>
            <div className="flex">
              <span className="w-40 text-slate-500">測定器:</span>
              <span className="font-medium">Renishaw XR20 + XL-80</span>
            </div>
          </div>
        </div>

        {/* CW/CCW Results */}
        {sections.map((sec) => sec.data.length > 0 && (
          <div key={sec.label} className="mb-6">
            <h2 className={`text-sm font-bold ${sec.bgClass} px-3 py-1.5 rounded mb-3 ${sec.textClass}`}>
              {sec.label}
            </h2>
            <div className="grid grid-cols-5 gap-2 text-sm mb-3">
              <ReportStat label="最大誤差" value={`${sec.stats.maxError.toFixed(2)} ″`} />
              <ReportStat label="最小誤差" value={`${sec.stats.minError.toFixed(2)} ″`} />
              <ReportStat label="平均誤差" value={`${sec.stats.meanError.toFixed(2)} ″`} />
              <ReportStat label="σ" value={`${sec.stats.sigma.toFixed(2)} ″`} />
              <ReportStat label="割出し精度" value={`${sec.stats.indexAccuracy.toFixed(2)} ″`} highlight />
            </div>
            <BarChartSVG data={sec.data} color={sec.chartColor} title={`${sec.label} (arc sec)`} />
          </div>
        ))}

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-slate-300 grid grid-cols-3 gap-4 text-sm text-slate-500">
          <div>
            <p className="text-xs mb-1">測定者</p>
            <div className="border-b border-slate-300 h-8" />
          </div>
          <div>
            <p className="text-xs mb-1">確認者</p>
            <div className="border-b border-slate-300 h-8" />
          </div>
          <div>
            <p className="text-xs mb-1">承認者</p>
            <div className="border-b border-slate-300 h-8" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`text-center p-2 rounded ${highlight ? "bg-red-50 border border-red-200" : "bg-slate-50"}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`font-bold ${highlight ? "text-red-700" : "text-slate-800"}`}>{value}</p>
    </div>
  );
}

/* =========================================================
   Shared Form Fields
   ========================================================= */
function InputField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        min={min}
        step={step}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
      />
    </div>
  );
}

/* =========================================================
   Python Script Generator
   ========================================================= */
function generatePythonScript(settings: XR20Settings): string {
  return `#!/usr/bin/env python3
"""
XR20 CARTO 自動トリガー監視スクリプト
- CARTOの画面上の角度カウンターを監視
- 数値が安定したらF9キーを自動送信
- UI Automation方式 → フォールバック: OCR方式

必要ライブラリ:
  pip install pywinauto pillow pytesseract
  ※ Tesseract-OCRのインストールも別途必要（OCRフォールバック時）
"""

import time
import sys
import ctypes
import ctypes.wintypes
import logging
from collections import deque
from datetime import datetime

# ===== 設定（Webアプリの設定タブと同期） =====
CARTO_WINDOW_TITLE = "${settings.cartoWindowTitle}"
MONITOR_INTERVAL_MS = ${settings.monitorIntervalMs}
STABILITY_COUNT = ${settings.stabilityCount}
STABILITY_THRESHOLD = ${settings.stabilityThreshold}  # degrees
POST_F9_WAIT_MS = ${settings.postF9WaitMs}
STABILITY_MIN_TIME_MS = ${settings.stabilityMinTimeMs}

# Windows API constants
WM_KEYDOWN = 0x0100
WM_KEYUP = 0x0101
VK_F9 = 0x78

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(f"carto_monitor_{datetime.now():%Y%m%d_%H%M%S}.log"),
    ],
)
log = logging.getLogger(__name__)

# Windows API
user32 = ctypes.windll.user32
FindWindowW = user32.FindWindowW
FindWindowW.argtypes = [ctypes.wintypes.LPCWSTR, ctypes.wintypes.LPCWSTR]
FindWindowW.restype = ctypes.wintypes.HWND

PostMessageW = user32.PostMessageW
PostMessageW.argtypes = [
    ctypes.wintypes.HWND,
    ctypes.wintypes.UINT,
    ctypes.wintypes.WPARAM,
    ctypes.wintypes.LPARAM,
]
PostMessageW.restype = ctypes.wintypes.BOOL

EnumWindows = user32.EnumWindows
GetWindowTextW = user32.GetWindowTextW
GetWindowTextLengthW = user32.GetWindowTextLengthW


def find_carto_window(title_part: str) -> int:
    """Find CARTO window by partial title match."""
    results = []

    def callback(hwnd, _):
        length = GetWindowTextLengthW(hwnd)
        if length > 0:
            buf = ctypes.create_unicode_buffer(length + 1)
            GetWindowTextW(hwnd, buf, length + 1)
            if title_part.lower() in buf.value.lower():
                results.append(hwnd)
        return True

    WNDENUMPROC = ctypes.WINFUNCTYPE(
        ctypes.wintypes.BOOL, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM
    )
    EnumWindows(WNDENUMPROC(callback), 0)
    return results[0] if results else 0


def send_f9(hwnd: int) -> bool:
    """Send F9 key to CARTO window via PostMessage."""
    try:
        PostMessageW(hwnd, WM_KEYDOWN, VK_F9, 0)
        time.sleep(0.05)
        PostMessageW(hwnd, WM_KEYUP, VK_F9, 0)
        log.info("F9 key sent successfully")
        return True
    except Exception as e:
        log.error(f"Failed to send F9: {e}")
        return False


class ValueReader:
    """Base class for reading angle value from CARTO."""

    def read(self) -> float | None:
        raise NotImplementedError


class UIAutomationReader(ValueReader):
    """Read value using Windows UI Automation API via pywinauto."""

    def __init__(self, window_title: str):
        self.window_title = window_title
        self._app = None
        self._element = None
        try:
            from pywinauto import Application

            self._app = Application(backend="uia").connect(
                title_re=f".*{window_title}.*", timeout=5
            )
            log.info("UI Automation: Connected to CARTO window")
            # Try to find the counter element - this needs tuning on real CARTO
            dlg = self._app.window(title_re=f".*{window_title}.*")
            # Attempt to find text elements that look like angle values
            self._dlg = dlg
        except Exception as e:
            log.warning(f"UI Automation not available: {e}")
            raise

    def read(self) -> float | None:
        try:
            # This logic needs adjustment based on actual CARTO UI structure
            # Try reading from static text or edit controls
            for ctrl in self._dlg.descendants():
                try:
                    text = ctrl.window_text()
                    if text and self._looks_like_angle(text):
                        return float(text.replace("°", "").strip())
                except Exception:
                    continue
            return None
        except Exception as e:
            log.debug(f"UI Automation read error: {e}")
            return None

    @staticmethod
    def _looks_like_angle(text: str) -> bool:
        text = text.replace("°", "").replace(" ", "").replace("+", "").replace("-", "")
        try:
            v = float(text)
            return -3600 < v < 3600
        except ValueError:
            return False


class OCRReader(ValueReader):
    """Read value using screen capture + OCR (Tesseract)."""

    def __init__(self, region: tuple[int, int, int, int] | None = None):
        self.region = region  # (x, y, width, height) - set via calibration
        try:
            import pytesseract
            from PIL import ImageGrab

            self._pytesseract = pytesseract
            self._ImageGrab = ImageGrab
            log.info("OCR Reader initialized")
        except ImportError as e:
            log.error(f"OCR dependencies not available: {e}")
            raise

    def read(self) -> float | None:
        try:
            if self.region:
                x, y, w, h = self.region
                img = self._ImageGrab.grab(bbox=(x, y, x + w, y + h))
            else:
                log.warning("OCR region not set. Use calibration to set the capture region.")
                return None

            text = self._pytesseract.image_to_string(
                img, config="--psm 7 -c tessedit_char_whitelist=0123456789.-+"
            )
            cleaned = text.strip().replace("°", "").replace(" ", "")
            if cleaned:
                return float(cleaned)
            return None
        except Exception as e:
            log.debug(f"OCR read error: {e}")
            return None


class StabilityDetector:
    """Detect when the angle value has stabilized."""

    def __init__(
        self,
        count: int = STABILITY_COUNT,
        threshold: float = STABILITY_THRESHOLD,
        min_time_ms: int = STABILITY_MIN_TIME_MS,
    ):
        self.count = count
        self.threshold = threshold
        self.min_time_ms = min_time_ms
        self.values: deque[tuple[float, float]] = deque(maxlen=count)
        self._movement_detected = False
        self._stable_since: float | None = None

    def update(self, value: float) -> str:
        """Returns state: 'idle', 'moving', 'stabilizing', 'stable'"""
        now = time.time()
        self.values.append((now, value))

        if len(self.values) < 2:
            return "idle"

        prev_val = self.values[-2][1]
        diff = abs(value - prev_val)

        if diff > self.threshold:
            self._movement_detected = True
            self._stable_since = None
            return "moving"

        if not self._movement_detected:
            return "idle"

        # Check stability
        if len(self.values) >= self.count:
            vals = [v for _, v in self.values]
            spread = max(vals) - min(vals)
            if spread <= self.threshold:
                if self._stable_since is None:
                    self._stable_since = now
                elapsed_ms = (now - self._stable_since) * 1000
                if elapsed_ms >= self.min_time_ms:
                    return "stable"
                return "stabilizing"
            else:
                self._stable_since = None
                return "moving"

        return "stabilizing"

    def reset(self):
        self.values.clear()
        self._movement_detected = False
        self._stable_since = None


def main():
    log.info("=" * 60)
    log.info("XR20 CARTO Auto-Trigger Monitor")
    log.info("=" * 60)
    log.info(f"Window title: {CARTO_WINDOW_TITLE}")
    log.info(f"Monitor interval: {MONITOR_INTERVAL_MS}ms")
    log.info(f"Stability: {STABILITY_COUNT} readings within {STABILITY_THRESHOLD}°")
    log.info(f"Post-F9 wait: {POST_F9_WAIT_MS}ms")
    log.info("")

    # Find CARTO window
    hwnd = find_carto_window(CARTO_WINDOW_TITLE)
    if not hwnd:
        log.error(f"CARTO window not found (title contains '{CARTO_WINDOW_TITLE}')")
        log.error("Please start CARTO and try again.")
        sys.exit(1)
    log.info(f"CARTO window found: hwnd=0x{hwnd:08X}")

    # Initialize reader (try UI Automation first, fallback to OCR)
    reader: ValueReader | None = None
    try:
        reader = UIAutomationReader(CARTO_WINDOW_TITLE)
        log.info("Using UI Automation reader")
    except Exception:
        log.info("UI Automation not available, trying OCR...")
        try:
            # For OCR, user needs to set the region via calibration
            reader = OCRReader()
            log.info("Using OCR reader (set capture region via --calibrate)")
        except Exception:
            log.error("No reader available. Install pywinauto or pytesseract+pillow.")
            sys.exit(1)

    detector = StabilityDetector()
    capture_count = 0
    interval_sec = MONITOR_INTERVAL_MS / 1000.0

    log.info("Monitoring started. Press Ctrl+C to stop.")
    log.info("")

    try:
        while True:
            value = reader.read()
            if value is None:
                time.sleep(interval_sec)
                continue

            state = detector.update(value)

            if state == "moving":
                log.info(f"  Moving... current: {value:.4f}°")
            elif state == "stable":
                capture_count += 1
                log.info(f"  STABLE at {value:.4f}° -> Sending F9 (capture #{capture_count})")

                if send_f9(hwnd):
                    log.info(f"  Capture #{capture_count} complete")
                else:
                    log.warning("  F9 send failed - retrying...")
                    time.sleep(0.5)
                    send_f9(hwnd)

                detector.reset()
                time.sleep(POST_F9_WAIT_MS / 1000.0)

            time.sleep(interval_sec)

    except KeyboardInterrupt:
        log.info("")
        log.info(f"Monitoring stopped. Total captures: {capture_count}")


if __name__ == "__main__":
    if "--calibrate" in sys.argv:
        print("Calibration mode:")
        print("Move your mouse to the top-left corner of the CARTO counter display")
        print("and note the coordinates, then to the bottom-right corner.")
        print("Update the OCRReader region parameter in this script.")
        print("Format: (x, y, width, height)")
    else:
        main()
`;
}
