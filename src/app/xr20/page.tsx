"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import Sidebar from "@/components/ui/Sidebar";
import Header from "@/components/ui/Header";
import {
  Settings,
  List,
  Database,
  BarChart3,
  FileText,
  Download,
  RefreshCw,
  Crosshair,
  Repeat,
  HelpCircle,
  Play,
  CheckCircle2,
  Circle,
  Upload,
  Zap,
  Save,
} from "lucide-react";
import {
  XR20Settings,
  DEFAULT_SETTINGS,
  TargetPoint,
  MeasurementRow,
  EvaluationStats,
  XR20Tab,
  RepeatabilityResult,
} from "@/lib/xr20/types";
import {
  generateWheelTargets,
  generateCombinedTargets,
  generateNCProgram,
  calculateStats,
  parseCSVData,
  calcRepeatability,
  generateCartoTargetCSV,
} from "@/lib/xr20/calculations";

export default function XR20Page() {
  const [activeTab, setActiveTab] = useState<XR20Tab>("auto");
  const [settings, setSettings] = useState<XR20Settings>(DEFAULT_SETTINGS);
  const [targets, setTargets] = useState<TargetPoint[]>([]);
  const [csvInput, setCsvInput] = useState("");
  const [measurements, setMeasurements] = useState<MeasurementRow[]>([]);
  const [autoStep, setAutoStep] = useState<"idle" | "prepared" | "waiting" | "done">("idle");
  const [savedResults, setSavedResults] = useState<{ timestamp: string; filename: string }[]>([]);

  // ホイール割出しデータ
  const wheelCwData = useMemo(
    () => measurements.filter((m) => m.phase === "wheel" && m.direction === "cw"),
    [measurements]
  );
  const wheelCcwData = useMemo(
    () => measurements.filter((m) => m.phase === "wheel" && m.direction === "ccw"),
    [measurements]
  );
  const wheelCwStats = useMemo(() => calculateStats(wheelCwData), [wheelCwData]);
  const wheelCcwStats = useMemo(() => calculateStats(wheelCcwData), [wheelCcwData]);

  // ウォーム割出しデータ
  const wormCwData = useMemo(
    () => measurements.filter((m) => m.phase === "worm" && m.direction === "cw"),
    [measurements]
  );
  const wormCcwData = useMemo(
    () => measurements.filter((m) => m.phase === "worm" && m.direction === "ccw"),
    [measurements]
  );
  const wormCwStats = useMemo(() => calculateStats(wormCwData), [wormCwData]);
  const wormCcwStats = useMemo(() => calculateStats(wormCcwData), [wormCcwData]);

  // 再現性データ
  const repeatMeasurements = useMemo(
    () => measurements.filter((m) => m.phase === "repeat"),
    [measurements]
  );
  const repeatResult = useMemo(
    () => repeatMeasurements.length > 0 ? calcRepeatability(repeatMeasurements, settings) : null,
    [repeatMeasurements, settings]
  );

  const tabs: { id: XR20Tab; label: string; icon: React.ElementType }[] = [
    { id: "auto", label: "自動測定", icon: Zap },
    { id: "settings", label: "設定", icon: Settings },
    { id: "targets", label: "ターゲットリスト", icon: List },
    { id: "data", label: "測定データ", icon: Database },
    { id: "results", label: "評価結果", icon: BarChart3 },
    { id: "report", label: "成績書", icon: FileText },
    { id: "repeatability", label: "再現性測定", icon: Repeat },
    { id: "help", label: "ヘルプ", icon: HelpCircle },
  ];

  // === 個別操作 ===
  const handleGenerateWheelTargets = useCallback(() => {
    const list = generateWheelTargets(settings);
    setTargets(list);
    setActiveTab("targets");
  }, [settings]);

  const handleGenerateCombinedTargets = useCallback(() => {
    const list = generateCombinedTargets(settings);
    setTargets(list);
    setActiveTab("targets");
  }, [settings]);

  const handleDownloadNC = useCallback(() => {
    if (targets.length === 0) return;
    const program = generateNCProgram(targets, settings);
    downloadFile(program, "O1000_XR20_EVAL.nc", "text/plain");
  }, [targets, settings]);

  const handleDownloadCartoCSV = useCallback(() => {
    if (targets.length === 0) return;
    const csv = generateCartoTargetCSV(targets);
    downloadFile(csv, "XR20_CARTO_TARGETS.csv", "text/csv");
  }, [targets]);

  const handleParseData = useCallback(() => {
    if (targets.length === 0) {
      alert("先にターゲットリストを生成してください。");
      return;
    }
    const rows = parseCSVData(csvInput, targets);
    setMeasurements(rows);
    if (rows.length > 0) setActiveTab("results");
  }, [csvInput, targets]);

  // === ワンクリック自動化 ===

  // STEP 1: 準備（ターゲット生成 → NC保存 → CARTOターゲットCSV保存 を一括）
  const handleAutoPrep = useCallback(() => {
    const list = generateCombinedTargets(settings);
    setTargets(list);

    const program = generateNCProgram(list, settings);
    downloadFile(program, "O1000_XR20_EVAL.nc", "text/plain");

    const csv = generateCartoTargetCSV(list);
    downloadFile(csv, "XR20_CARTO_TARGETS.csv", "text/csv");

    setAutoStep("prepared");
  }, [settings]);

  // STEP 2 → 3: CSVファイルドロップで自動解析 → 自動保存
  const handleAutoCSVDrop = useCallback((csvText: string, filename: string) => {
    if (targets.length === 0) return;
    const rows = parseCSVData(csvText, targets);
    if (rows.length === 0) {
      alert("有効なデータが見つかりませんでした。CSVの形式を確認してください。");
      return;
    }
    setMeasurements(rows);
    setCsvInput(csvText);

    // 自動保存（JSON）
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const saveData = {
      timestamp,
      settings,
      targets: targets.length,
      measurements: rows,
      source: filename,
    };
    downloadFile(JSON.stringify(saveData, null, 2), `XR20_RESULT_${timestamp}.json`, "application/json");
    setSavedResults(prev => [...prev, { timestamp, filename }]);
    setAutoStep("done");
  }, [targets, settings]);

  // 次の測定へリセット
  const handleAutoNext = useCallback(() => {
    setMeasurements([]);
    setCsvInput("");
    setAutoStep("prepared");
  }, []);

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
                XR20 軸精度評価ツール
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                Renishaw XR20 回転分割測定器 - 割出し精度・再現性評価
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
              {activeTab === "auto" && (
                <AutoTab
                  settings={settings}
                  autoStep={autoStep}
                  targets={targets}
                  measurements={measurements}
                  wheelCwStats={wheelCwStats}
                  wheelCcwStats={wheelCcwStats}
                  wormCwStats={wormCwStats}
                  wormCcwStats={wormCcwStats}
                  repeatResult={repeatResult}
                  savedResults={savedResults}
                  onPrep={handleAutoPrep}
                  onCSVDrop={handleAutoCSVDrop}
                  onNext={handleAutoNext}
                  onViewResults={() => setActiveTab("results")}
                  onViewReport={() => setActiveTab("report")}
                />
              )}
              {activeTab === "settings" && (
                <SettingsTab
                  settings={settings}
                  updateSetting={updateSetting}
                  onGenerateWheelTargets={handleGenerateWheelTargets}
                  onGenerateCombinedTargets={handleGenerateCombinedTargets}
                  onDownloadNC={handleDownloadNC}
                  onDownloadCartoCSV={handleDownloadCartoCSV}
                />
              )}
              {activeTab === "targets" && (
                <TargetsTab targets={targets} />
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
                  wheelCwData={wheelCwData}
                  wheelCcwData={wheelCcwData}
                  wheelCwStats={wheelCwStats}
                  wheelCcwStats={wheelCcwStats}
                  wormCwData={wormCwData}
                  wormCcwData={wormCcwData}
                  wormCwStats={wormCwStats}
                  wormCcwStats={wormCcwStats}
                  repeatResult={repeatResult}
                />
              )}
              {activeTab === "report" && (
                <ReportTab
                  settings={settings}
                  wheelCwData={wheelCwData}
                  wheelCcwData={wheelCcwData}
                  wheelCwStats={wheelCwStats}
                  wheelCcwStats={wheelCcwStats}
                  wormCwData={wormCwData}
                  wormCcwData={wormCcwData}
                  wormCwStats={wormCwStats}
                  wormCcwStats={wormCcwStats}
                  repeatResult={repeatResult}
                />
              )}
              {activeTab === "repeatability" && (
                <RepeatabilityTab
                  repeatResult={repeatResult}
                />
              )}
              {activeTab === "help" && <HelpTab />}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

/* =========================================================
   Utility
   ========================================================= */
function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* =========================================================
   Auto Tab — ワンクリック自動測定フロー
   ========================================================= */
function AutoTab({
  settings,
  autoStep,
  targets,
  measurements,
  wheelCwStats,
  wheelCcwStats,
  wormCwStats,
  wormCcwStats,
  repeatResult,
  savedResults,
  onPrep,
  onCSVDrop,
  onNext,
  onViewResults,
  onViewReport,
}: {
  settings: XR20Settings;
  autoStep: "idle" | "prepared" | "waiting" | "done";
  targets: TargetPoint[];
  measurements: MeasurementRow[];
  wheelCwStats: EvaluationStats;
  wheelCcwStats: EvaluationStats;
  wormCwStats: EvaluationStats;
  wormCcwStats: EvaluationStats;
  repeatResult: RepeatabilityResult | null;
  savedResults: { timestamp: string; filename: string }[];
  onPrep: () => void;
  onCSVDrop: (csv: string, filename: string) => void;
  onNext: () => void;
  onViewResults: () => void;
  onViewReport: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) onCSVDrop(text, file.name);
    };
    reader.readAsText(file);
  };

  const steps = [
    { id: "prep", label: "準備", desc: "ターゲット生成 → NCプログラム＆CARTOリスト 自動ダウンロード" },
    { id: "run", label: "測定実行", desc: "NCプログラムを機械で実行 → CARTOが自動キャプチャ" },
    { id: "import", label: "結果取込", desc: "CARTOのCSVをここにドロップ → 自動解析＆自動保存" },
  ];

  const currentStepIdx = autoStep === "idle" ? 0 : autoStep === "prepared" ? 1 : autoStep === "waiting" ? 2 : 3;

  return (
    <div className="space-y-8">
      {/* フロー説明 */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl p-6 text-white">
        <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
          <Zap className="w-6 h-6" />
          自動測定フロー
        </h2>
        <p className="text-blue-100 text-sm">
          ボタン1つで準備完了。測定後はCSVをドロップするだけで解析・保存まで自動。
        </p>
      </div>

      {/* ステップ表示 */}
      <div className="flex items-center gap-2">
        {steps.map((step, i) => {
          const done = i < currentStepIdx;
          const active = i === currentStepIdx && autoStep !== "done";
          return (
            <div key={step.id} className="flex items-center gap-2 flex-1">
              <div className={`flex items-center gap-3 flex-1 p-4 rounded-lg border-2 transition-all ${
                done ? "border-green-400 bg-green-50" :
                active ? "border-blue-500 bg-blue-50 shadow-md" :
                "border-slate-200 bg-slate-50"
              }`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  done ? "bg-green-500 text-white" :
                  active ? "bg-blue-600 text-white" :
                  "bg-slate-300 text-white"
                }`}>
                  {done ? <CheckCircle2 className="w-5 h-5" /> : <span className="text-sm font-bold">{i + 1}</span>}
                </div>
                <div>
                  <p className={`text-sm font-bold ${done ? "text-green-700" : active ? "text-blue-800" : "text-slate-400"}`}>
                    {step.label}
                  </p>
                  <p className={`text-xs ${done ? "text-green-600" : active ? "text-blue-600" : "text-slate-400"}`}>
                    {step.desc}
                  </p>
                </div>
              </div>
              {i < steps.length - 1 && (
                <div className={`w-6 h-0.5 flex-shrink-0 ${done ? "bg-green-400" : "bg-slate-200"}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* STEP 1: 準備ボタン */}
      {autoStep === "idle" && (
        <div className="text-center py-8">
          <p className="text-slate-500 mb-4 text-sm">
            ホイール {settings.divisions}等分 + ウォーム {settings.wormDivisions}等分 + 再現性 {settings.repeatPositions.split(",").length}箇所×{settings.repeatCount}回
          </p>
          <button
            onClick={onPrep}
            className="px-8 py-4 bg-blue-600 text-white rounded-xl text-lg font-bold hover:bg-blue-700 transition-all shadow-lg hover:shadow-xl flex items-center gap-3 mx-auto"
          >
            <Play className="w-6 h-6" />
            測定準備（ターゲット生成＋NC＋CSVを一括ダウンロード）
          </button>
          <p className="text-xs text-slate-400 mt-3">設定を変更したい場合は「設定」タブで調整してください</p>
        </div>
      )}

      {/* STEP 2: 測定中（NCを実行してくださいのガイド） */}
      {autoStep === "prepared" && (
        <div className="space-y-4">
          <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-6">
            <h3 className="font-bold text-amber-800 mb-3 flex items-center gap-2">
              <Circle className="w-5 h-5 animate-pulse" />
              NCプログラムとCARTOリストがダウンロードされました
            </h3>
            <ol className="list-decimal list-inside space-y-2 text-sm text-amber-700">
              <li><strong>O1000_XR20_EVAL.nc</strong> を機械に転送して実行</li>
              <li>CARTOで「Rotary」テスト → ポジショントリガー設定（またはF9手動キャプチャ）</li>
              <li>測定完了後、CARTOから <strong>CSV エクスポート</strong></li>
              <li>下のエリアにCSVファイルをドロップ</li>
            </ol>
          </div>

          {/* CSVドロップエリア */}
          <div
            className={`border-3 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer ${
              isDragging
                ? "border-blue-500 bg-blue-50 scale-[1.02]"
                : "border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/50"
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className={`w-12 h-12 mx-auto mb-3 ${isDragging ? "text-blue-500" : "text-slate-400"}`} />
            <p className={`text-lg font-bold ${isDragging ? "text-blue-600" : "text-slate-500"}`}>
              {isDragging ? "ここにドロップ！" : "CARTOのCSVファイルをドロップ"}
            </p>
            <p className="text-sm text-slate-400 mt-1">またはクリックしてファイルを選択</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </div>

          {/* 生成済みターゲット情報 */}
          <div className="bg-slate-50 rounded-lg p-4 text-sm text-slate-600">
            <p>生成済みターゲット: <strong>{targets.length}点</strong></p>
          </div>
        </div>
      )}

      {/* STEP 3: 完了 */}
      {autoStep === "done" && (
        <div className="space-y-6">
          <div className="bg-green-50 border-2 border-green-400 rounded-xl p-6 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <h3 className="text-xl font-bold text-green-800 mb-2">解析完了・自動保存済み</h3>
            <p className="text-sm text-green-600">
              {measurements.length}点のデータを解析し、結果をJSONファイルとして保存しました。
            </p>
          </div>

          {/* サマリー */}
          <div className="grid grid-cols-2 gap-4">
            {wheelCwStats.count > 0 && (
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-xs text-blue-500 font-bold">ホイール CW 割出し精度</p>
                <p className="text-2xl font-bold text-blue-800">{wheelCwStats.indexAccuracy.toFixed(2)} ″</p>
              </div>
            )}
            {wheelCcwStats.count > 0 && (
              <div className="bg-purple-50 rounded-lg p-4">
                <p className="text-xs text-purple-500 font-bold">ホイール CCW 割出し精度</p>
                <p className="text-2xl font-bold text-purple-800">{wheelCcwStats.indexAccuracy.toFixed(2)} ″</p>
              </div>
            )}
            {wormCwStats.count > 0 && (
              <div className="bg-emerald-50 rounded-lg p-4">
                <p className="text-xs text-emerald-500 font-bold">ウォーム CW 割出し精度</p>
                <p className="text-2xl font-bold text-emerald-800">{wormCwStats.indexAccuracy.toFixed(2)} ″</p>
              </div>
            )}
            {wormCcwStats.count > 0 && (
              <div className="bg-teal-50 rounded-lg p-4">
                <p className="text-xs text-teal-500 font-bold">ウォーム CCW 割出し精度</p>
                <p className="text-2xl font-bold text-teal-800">{wormCcwStats.indexAccuracy.toFixed(2)} ″</p>
              </div>
            )}
            {repeatResult && (
              <div className="bg-amber-50 rounded-lg p-4 col-span-2">
                <p className="text-xs text-amber-500 font-bold">再現性</p>
                <p className="text-2xl font-bold text-amber-800">{repeatResult.repeatability.toFixed(2)} ″</p>
              </div>
            )}
          </div>

          {/* アクション */}
          <div className="flex gap-3 justify-center">
            <button onClick={onViewResults} className="btn-primary flex items-center gap-2">
              <BarChart3 className="w-4 h-4" /> 詳細結果を見る
            </button>
            <button onClick={onViewReport} className="btn-secondary flex items-center gap-2">
              <FileText className="w-4 h-4" /> 成績書を見る
            </button>
            <button onClick={onNext} className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 flex items-center gap-2">
              <RefreshCw className="w-4 h-4" /> 次の測定へ
            </button>
          </div>
        </div>
      )}

      {/* 保存履歴 */}
      {savedResults.length > 0 && (
        <div className="border-t pt-4">
          <h3 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-1">
            <Save className="w-4 h-4" /> 保存履歴
          </h3>
          <div className="space-y-1">
            {savedResults.map((r, i) => (
              <div key={i} className="flex items-center gap-3 text-xs text-slate-500 bg-slate-50 rounded px-3 py-2">
                <CheckCircle2 className="w-3 h-3 text-green-500" />
                <span className="font-mono">{r.timestamp}</span>
                <span>← {r.filename}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   Settings Tab
   ========================================================= */
function SettingsTab({
  settings,
  updateSetting,
  onGenerateWheelTargets,
  onGenerateCombinedTargets,
  onDownloadNC,
  onDownloadCartoCSV,
}: {
  settings: XR20Settings;
  updateSetting: <K extends keyof XR20Settings>(key: K, value: XR20Settings[K]) => void;
  onGenerateWheelTargets: () => void;
  onGenerateCombinedTargets: () => void;
  onDownloadNC: () => void;
  onDownloadCartoCSV: () => void;
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

      {/* Gear Parameters */}
      <section>
        <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">
          ウォームギヤパラメータ
        </h2>
        <div className="grid grid-cols-3 gap-4">
          <NumberField
            label="ホイール歯数"
            value={settings.wheelTeeth}
            onChange={(v) => updateSetting("wheelTeeth", v)}
            min={1}
          />
          <NumberField
            label="ウォーム条数"
            value={settings.wormStarts}
            onChange={(v) => updateSetting("wormStarts", v)}
            min={1}
          />
          <NumberField
            label="ウォーム等分数 (1ピッチ内)"
            value={settings.wormDivisions}
            onChange={(v) => updateSetting("wormDivisions", v)}
            min={2}
          />
        </div>
        <p className="text-xs text-slate-500 mt-2">
          1ピッチ = {((360 / settings.wheelTeeth) * settings.wormStarts).toFixed(4)}°　→　ウォーム等分ステップ = {((360 / settings.wheelTeeth) * settings.wormStarts / settings.wormDivisions).toFixed(4)}°
        </p>
      </section>

      {/* Evaluation Parameters */}
      <section>
        <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">
          ホイール割出しパラメータ
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

      {/* Repeatability Parameters */}
      <section>
        <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">
          再現性測定パラメータ
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="測定位置 (カンマ区切り °)"
            value={settings.repeatPositions}
            onChange={(v) => updateSetting("repeatPositions", v)}
            placeholder="例: 0,90,180,270"
          />
          <NumberField
            label="繰り返し回数"
            value={settings.repeatCount}
            onChange={(v) => updateSetting("repeatCount", v)}
            min={2}
          />
        </div>
      </section>


      {/* NC Program Settings */}
      <section>
        <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">
          NCプログラム設定
        </h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <InputField
            label="制御軸"
            value={settings.controlAxis}
            onChange={(v) => updateSetting("controlAxis", v.toUpperCase())}
            placeholder="例: A, B, C"
          />
          <NumberField
            label="ドゥエル時間 (ms)"
            value={settings.dwellTimeMs}
            onChange={(v) => updateSetting("dwellTimeMs", v)}
            min={1000}
            step={500}
          />
        </div>
        {/* 動作タイプ */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-2">動作タイプ</label>
          <div className="flex gap-4">
            <label className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer ${settings.feedMode === "rapid" ? "bg-blue-50 border-blue-400 text-blue-700" : "border-slate-300 text-slate-600"}`}>
              <input type="radio" name="feedMode" value="rapid" checked={settings.feedMode === "rapid"} onChange={() => updateSetting("feedMode", "rapid")} className="sr-only" />
              G00 早送り
            </label>
            <label className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer ${settings.feedMode === "feed" ? "bg-blue-50 border-blue-400 text-blue-700" : "border-slate-300 text-slate-600"}`}>
              <input type="radio" name="feedMode" value="feed" checked={settings.feedMode === "feed"} onChange={() => updateSetting("feedMode", "feed")} className="sr-only" />
              G01 送り速度
            </label>
          </div>
        </div>
        {/* 送り速度（G01選択時のみ表示） */}
        {settings.feedMode === "feed" && (
          <div className="mb-4">
            <NumberField
              label="送り速度 F (mm/min or deg/min)"
              value={settings.feedRate}
              onChange={(v) => updateSetting("feedRate", v)}
              min={1}
              step={100}
            />
          </div>
        )}
        {/* クランプ */}
        <div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.useClamp}
              onChange={(e) => updateSetting("useClamp", e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-slate-700">クランプあり (M10/M11)</span>
          </label>
          {settings.useClamp && (
            <p className="text-xs text-slate-500 mt-1 ml-7">M11(アンクランプ) → 移動 → M10(クランプ) → ドゥエル の順で出力されます</p>
          )}
        </div>
      </section>

      {/* Action Buttons */}
      <div className="space-y-3 pt-4 border-t">
        {/* ホイールのみ */}
        <div>
          <p className="text-xs font-bold text-slate-500 mb-1">ホイール割出しのみ</p>
          <div className="flex gap-3">
            <button onClick={onGenerateWheelTargets} className="btn-primary flex items-center gap-2">
              <List className="w-4 h-4" />
              ホイールターゲット生成
            </button>
            <button onClick={onDownloadNC} className="btn-secondary flex items-center gap-2">
              <Download className="w-4 h-4" />
              NCプログラム保存
            </button>
          </div>
        </div>
        {/* 連続測定（ホイール+ウォーム+再現性） */}
        <div>
          <p className="text-xs font-bold text-slate-500 mb-1">連続測定（ホイール + ウォーム + 再現性）</p>
          <div className="flex gap-3">
            <button onClick={onGenerateCombinedTargets} className="btn-primary flex items-center gap-2">
              <List className="w-4 h-4" />
              連続ターゲット生成
            </button>
            <button onClick={onDownloadNC} className="btn-secondary flex items-center gap-2">
              <Download className="w-4 h-4" />
              NCプログラム保存
            </button>
          </div>
        </div>
        {/* CARTO用 */}
        <div>
          <p className="text-xs font-bold text-slate-500 mb-1">CARTOターゲット入力用</p>
          <div className="flex gap-3">
            <button onClick={onDownloadCartoCSV} className="btn-secondary flex items-center gap-2">
              <Download className="w-4 h-4" />
              ターゲットリストCSV
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-1">CARTOのターゲット欄に手動入力する際の参考リストです</p>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Targets Tab
   ========================================================= */
function TargetsTab({ targets }: { targets: TargetPoint[] }) {
  const wheelCount = targets.filter((t) => t.phase === "wheel").length;
  const wormCount = targets.filter((t) => t.phase === "worm").length;
  const repeatCount = targets.filter((t) => t.phase === "repeat").length;

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
          {wheelCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />
              ホイール: {wheelCount}点
            </span>
          )}
          {wormCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
              ウォーム: {wormCount}点
            </span>
          )}
          {repeatCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-amber-500 inline-block" />
              再現性: {repeatCount}点
            </span>
          )}
        </div>
      </div>

      <div className="overflow-auto max-h-[600px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              <th className="text-left px-4 py-2 font-semibold text-slate-600">No.</th>
              <th className="text-left px-4 py-2 font-semibold text-slate-600">ターゲット角度 (°)</th>
              <th className="text-left px-4 py-2 font-semibold text-slate-600">方向</th>
              <th className="text-left px-4 py-2 font-semibold text-slate-600">区分</th>
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
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    t.phase === "repeat" ? "bg-amber-100 text-amber-700" :
                    t.phase === "worm" ? "bg-emerald-100 text-emerald-700" :
                    "bg-blue-100 text-blue-700"
                  }`}>
                    {t.phase === "repeat" ? `再現性 #${t.trial}` : t.phase === "worm" ? "ウォーム" : "ホイール"}
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
  wheelCwData, wheelCcwData, wheelCwStats, wheelCcwStats,
  wormCwData, wormCcwData, wormCwStats, wormCcwStats,
  repeatResult,
}: {
  wheelCwData: MeasurementRow[];
  wheelCcwData: MeasurementRow[];
  wheelCwStats: EvaluationStats;
  wheelCcwStats: EvaluationStats;
  wormCwData: MeasurementRow[];
  wormCcwData: MeasurementRow[];
  wormCwStats: EvaluationStats;
  wormCcwStats: EvaluationStats;
  repeatResult: RepeatabilityResult | null;
}) {
  const hasWheel = wheelCwData.length > 0 || wheelCcwData.length > 0;
  const hasWorm = wormCwData.length > 0 || wormCcwData.length > 0;

  if (!hasWheel && !hasWorm && !repeatResult) {
    return (
      <div className="text-center py-16 text-slate-400">
        <BarChart3 className="w-12 h-12 mx-auto mb-3" />
        <p>測定データがありません。データタブからデータを入力してください。</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ホイール評価 */}
      {hasWheel && (
        <section>
          <h2 className="text-base font-bold text-slate-800 mb-3 flex items-center gap-2 border-b pb-2">
            <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />
            ホイール割出し精度
          </h2>
          <WaveformChart cwData={wheelCwData} ccwData={wheelCcwData} />
          {wheelCwData.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-slate-700 mb-2">CW</p>
              <StatsCards stats={wheelCwStats} />
              <LineChartSVG data={wheelCwData} color="#3b82f6" title="ホイール CW 誤差波形 (arc sec)" />
              <DataTable data={wheelCwData} />
            </div>
          )}
          {wheelCcwData.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-slate-700 mb-2">CCW</p>
              <StatsCards stats={wheelCcwStats} />
              <LineChartSVG data={wheelCcwData} color="#8b5cf6" title="ホイール CCW 誤差波形 (arc sec)" />
              <DataTable data={wheelCcwData} />
            </div>
          )}
        </section>
      )}

      {/* ウォーム評価 */}
      {hasWorm && (
        <section>
          <h2 className="text-base font-bold text-slate-800 mb-3 flex items-center gap-2 border-b pb-2">
            <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
            ウォーム割出し精度（1ピッチ内）
          </h2>
          <WaveformChart cwData={wormCwData} ccwData={wormCcwData} />
          {wormCwData.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-slate-700 mb-2">CW</p>
              <StatsCards stats={wormCwStats} />
              <LineChartSVG data={wormCwData} color="#10b981" title="ウォーム CW 誤差波形 (arc sec)" />
              <DataTable data={wormCwData} />
            </div>
          )}
          {wormCcwData.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-slate-700 mb-2">CCW</p>
              <StatsCards stats={wormCcwStats} />
              <LineChartSVG data={wormCcwData} color="#6366f1" title="ウォーム CCW 誤差波形 (arc sec)" />
              <DataTable data={wormCcwData} />
            </div>
          )}
        </section>
      )}

      {/* 再現性 */}
      {repeatResult && (
        <section>
          <h2 className="text-base font-bold text-slate-800 mb-3 flex items-center gap-2 border-b pb-2">
            <span className="w-3 h-3 rounded-full bg-amber-500 inline-block" />
            再現性評価結果
          </h2>
          <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl p-6 text-white text-center mb-4">
            <p className="text-sm opacity-80">再現性</p>
            <p className="text-4xl font-bold mt-1">{repeatResult.repeatability.toFixed(2)} ″</p>
          </div>
          <div className="overflow-auto border border-slate-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold text-slate-600">位置 (°)</th>
                  <th className="text-left px-4 py-2 font-semibold text-slate-600">CW Range (″)</th>
                  <th className="text-left px-4 py-2 font-semibold text-slate-600">CCW Range (″)</th>
                  <th className="text-left px-4 py-2 font-semibold text-slate-600">CW 回数</th>
                  <th className="text-left px-4 py-2 font-semibold text-slate-600">CCW 回数</th>
                </tr>
              </thead>
              <tbody>
                {repeatResult.positions.map((pr) => (
                  <tr key={pr.angle} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono">{pr.angle.toFixed(4)}</td>
                    <td className="px-4 py-2 font-mono font-bold text-blue-600">{pr.cwRange.toFixed(2)}</td>
                    <td className="px-4 py-2 font-mono font-bold text-purple-600">{pr.ccwRange.toFixed(2)}</td>
                    <td className="px-4 py-2">{pr.cwErrors.length}</td>
                    <td className="px-4 py-2">{pr.ccwErrors.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4">
            <RepeatabilityChart result={repeatResult} />
          </div>
        </section>
      )}
    </div>
  );
}

/* =========================================================
   Repeatability Tab
   ========================================================= */
function RepeatabilityTab({ repeatResult }: { repeatResult: RepeatabilityResult | null }) {
  if (!repeatResult) {
    return (
      <div className="text-center py-16 text-slate-400">
        <Repeat className="w-12 h-12 mx-auto mb-3" />
        <p className="font-medium mb-2">再現性データがありません</p>
        <p className="text-sm">
          設定タブで「連続ターゲット生成」→ NCプログラム実行 → CARTOからCSV取得 →<br />
          「測定データ」タブで解析すると、ここに再現性評価結果が表示されます。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl p-6 text-white text-center">
        <p className="text-sm opacity-80">再現性</p>
        <p className="text-4xl font-bold mt-1">{repeatResult.repeatability.toFixed(2)} ″</p>
        <p className="text-xs opacity-70 mt-1">全位置 CW/CCW の最大 Range</p>
      </div>
      <div className="overflow-auto border border-slate-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left px-4 py-2 font-semibold text-slate-600">位置 (°)</th>
              <th className="text-left px-4 py-2 font-semibold text-slate-600">CW Range (″)</th>
              <th className="text-left px-4 py-2 font-semibold text-slate-600">CCW Range (″)</th>
              <th className="text-left px-4 py-2 font-semibold text-slate-600">CW 回数</th>
              <th className="text-left px-4 py-2 font-semibold text-slate-600">CCW 回数</th>
            </tr>
          </thead>
          <tbody>
            {repeatResult.positions.map((pr) => (
              <tr key={pr.angle} className="border-t border-slate-100">
                <td className="px-4 py-2 font-mono">{pr.angle.toFixed(4)}</td>
                <td className="px-4 py-2 font-mono font-bold text-blue-600">{pr.cwRange.toFixed(2)}</td>
                <td className="px-4 py-2 font-mono font-bold text-purple-600">{pr.ccwRange.toFixed(2)}</td>
                <td className="px-4 py-2">{pr.cwErrors.length}</td>
                <td className="px-4 py-2">{pr.ccwErrors.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <RepeatabilityChart result={repeatResult} />
    </div>
  );
}

function RepeatabilityChart({ result }: { result: RepeatabilityResult }) {
  const width = 600;
  const height = 200;
  const padding = { top: 30, right: 20, bottom: 40, left: 50 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const allRanges = result.positions.flatMap((p) => [p.cwRange, p.ccwRange]);
  const maxRange = Math.max(...allRanges, 0.1);

  const barGroupWidth = chartW / result.positions.length;
  const barWidth = barGroupWidth * 0.3;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <h3 className="text-sm font-bold text-slate-700 mb-2">再現性 (各位置のRange)</h3>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        {/* 再現性ライン */}
        <line
          x1={padding.left}
          y1={padding.top + chartH * (1 - result.repeatability / maxRange)}
          x2={width - padding.right}
          y2={padding.top + chartH * (1 - result.repeatability / maxRange)}
          stroke="red"
          strokeDasharray="4,4"
          strokeWidth={1}
        />
        <text
          x={width - padding.right - 2}
          y={padding.top + chartH * (1 - result.repeatability / maxRange) - 4}
          textAnchor="end"
          fontSize={9}
          fill="red"
        >
          再現性 = {result.repeatability.toFixed(2)}″
        </text>

        {/* バー */}
        {result.positions.map((pos, i) => {
          const cx = padding.left + barGroupWidth * i + barGroupWidth / 2;
          const cwH = (pos.cwRange / maxRange) * chartH;
          const ccwH = (pos.ccwRange / maxRange) * chartH;
          return (
            <g key={i}>
              <rect
                x={cx - barWidth - 1}
                y={padding.top + chartH - cwH}
                width={barWidth}
                height={cwH}
                fill="#3b82f6"
                rx={2}
              />
              <rect
                x={cx + 1}
                y={padding.top + chartH - ccwH}
                width={barWidth}
                height={ccwH}
                fill="#8b5cf6"
                rx={2}
              />
              <text
                x={cx}
                y={height - padding.bottom + 15}
                textAnchor="middle"
                fontSize={10}
                fill="#64748b"
              >
                {pos.angle}°
              </text>
            </g>
          );
        })}

        {/* Y軸 */}
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + chartH} stroke="#cbd5e1" />
        <text x={padding.left - 5} y={padding.top + 4} textAnchor="end" fontSize={9} fill="#64748b">
          {maxRange.toFixed(1)}″
        </text>
        <text x={padding.left - 5} y={padding.top + chartH + 4} textAnchor="end" fontSize={9} fill="#64748b">
          0
        </text>

        {/* 凡例 */}
        <rect x={padding.left} y={5} width={10} height={10} fill="#3b82f6" rx={2} />
        <text x={padding.left + 14} y={14} fontSize={10} fill="#64748b">CW</text>
        <rect x={padding.left + 40} y={5} width={10} height={10} fill="#8b5cf6" rx={2} />
        <text x={padding.left + 54} y={14} fontSize={10} fill="#64748b">CCW</text>
      </svg>
    </div>
  );
}

/* =========================================================
   Help Tab
   ========================================================= */
function HelpTab() {
  const [activeHelp, setActiveHelp] = useState<"app" | "carto">("app");

  return (
    <div className="space-y-6">
      {/* タブ切替 */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveHelp("app")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${
            activeHelp === "app" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          アプリの使い方
        </button>
        <button
          onClick={() => setActiveHelp("carto")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${
            activeHelp === "carto" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          CARTOの使い方
        </button>
      </div>

      {activeHelp === "app" ? <AppHelpContent /> : <CartoHelpContent />}
    </div>
  );
}

function AppHelpContent() {
  return (
    <div className="prose prose-sm max-w-none">
      <h2 className="text-lg font-bold text-slate-800 border-b pb-2">XR20 軸精度評価ツール 操作ガイド</h2>

      <div className="space-y-6 mt-4">
        <section>
          <h3 className="text-md font-bold text-slate-700">概要</h3>
          <p className="text-slate-600">
            Renishaw XR20回転分割測定器（CARTO）を使用して、
            回転軸・傾斜軸の「割出し精度」と「再現性」を評価するツールです。
          </p>
        </section>

        <section>
          <h3 className="text-md font-bold text-slate-700">割出し精度測定の流れ</h3>
          <ol className="list-decimal list-inside space-y-1 text-slate-600">
            <li><strong>[設定]</strong> タブで機械情報・評価パラメータを入力</li>
            <li>「ターゲットリスト生成」でCW/CCW測定点を生成</li>
            <li>「NCプログラム生成」でFANUC Gコードを出力</li>
            <li>NCプログラムを機械で実行、CARTOで測定</li>
            <li><strong>[測定データ]</strong> タブでCARTOの結果CSVを貼り付け</li>
            <li>「データ解析」で評価結果・成績書を自動生成</li>
          </ol>
        </section>

        <section>
          <h3 className="text-md font-bold text-slate-700">再現性測定の流れ</h3>
          <ol className="list-decimal list-inside space-y-1 text-slate-600">
            <li><strong>[設定]</strong> タブで再現性パラメータを入力（測定位置・繰り返し回数）</li>
            <li><strong>[再現性測定]</strong> タブで「ターゲット生成」</li>
            <li>「NCプログラム保存」でGコードを出力</li>
            <li>測定後、データを貼り付けて「再現性評価」</li>
          </ol>
        </section>

        <section>
          <h3 className="text-md font-bold text-slate-700">軸タイプ</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-blue-50 rounded-lg p-3">
              <p className="font-bold text-blue-800">回転軸 (360°)</p>
              <p className="text-sm text-blue-600">C軸など1周回転可能な軸。0°～360°を等分してCW/CCW測定。</p>
            </div>
            <div className="bg-purple-50 rounded-lg p-3">
              <p className="font-bold text-purple-800">傾斜軸 (任意範囲)</p>
              <p className="text-sm text-purple-600">A/B軸など1周回転できない軸。例: -30°～+110°の範囲を等分。</p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-md font-bold text-slate-700">NCプログラムについて</h3>
          <ul className="list-disc list-inside space-y-1 text-slate-600">
            <li><strong>オーバーラン</strong>: バックラッシュ除去のため、反対方向に移動してから測定位置に到達</li>
            <li><strong>ドウェル</strong>: 各位置でG04停止し、CARTOの測定を待つ</li>
            <li>割出し精度用: O1000番台 / 再現性用: O2000番台</li>
          </ul>
        </section>

        <section>
          <h3 className="text-md font-bold text-slate-700">各タブ説明</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[
              ["設定", "機械情報・評価パラメータ・監視パラメータ"],
              ["ターゲットリスト", "生成された測定点の一覧"],
              ["測定制御", "CARTO監視・自動F9送信（Windows版のみ）"],
              ["測定データ", "CSVデータ入力・解析"],
              ["評価結果", "CW/CCW統計・グラフ"],
              ["成績書", "印刷用成績書"],
              ["再現性測定", "再現性専用タブ"],
              ["ヘルプ", "この画面"],
            ].map(([name, desc]) => (
              <div key={name} className="flex gap-2 bg-slate-50 rounded p-2">
                <span className="font-bold text-slate-700 shrink-0">[{name}]</span>
                <span className="text-slate-600">{desc}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function CartoHelpContent() {
  return (
    <div className="prose prose-sm max-w-none">
      <h2 className="text-lg font-bold text-slate-800 border-b pb-2">CARTO（Renishaw）操作ガイド</h2>

      <div className="space-y-6 mt-4">
        <section>
          <h3 className="text-md font-bold text-slate-700">CARTOとは</h3>
          <p className="text-slate-600">
            Renishaw社が提供するレーザー測定ソフトウェアです。
            XR20回転分割測定器と組み合わせて回転軸の精度測定を行います。
          </p>
        </section>

        <section>
          <h3 className="text-md font-bold text-slate-700">XR20測定のセットアップ</h3>
          <ol className="list-decimal list-inside space-y-2 text-slate-600">
            <li>
              <strong>ハードウェア接続</strong>
              <ul className="list-disc list-inside ml-4 mt-1">
                <li>XL-80レーザーユニットを機械テーブル上に設置</li>
                <li>XR20回転分割測定器を測定対象の回転軸に取り付け</li>
                <li>USBケーブルでPCに接続</li>
              </ul>
            </li>
            <li>
              <strong>CARTOの起動と設定</strong>
              <ul className="list-disc list-inside ml-4 mt-1">
                <li>「Rotary」テストタイプを選択</li>
                <li>XR20デバイスが認識されていることを確認</li>
              </ul>
            </li>
            <li>
              <strong>環境補正</strong>
              <ul className="list-disc list-inside ml-4 mt-1">
                <li>温度・気圧・湿度センサーの値を確認</li>
              </ul>
            </li>
          </ol>
        </section>

        <section>
          <h3 className="text-md font-bold text-slate-700">測定手順</h3>
          <ol className="list-decimal list-inside space-y-2 text-slate-600">
            <li><strong>アライメント</strong> - レーザービームがXR20リフレクターに正しく戻ることを確認</li>
            <li><strong>ターゲット設定</strong> - 本ツールで生成したリストをCARTOに入力</li>
            <li><strong>測定開始</strong> - CARTOで「Start」→ NCプログラム実行 → 各位置でF9キャプチャ</li>
            <li><strong>データ確認</strong> - 全点測定後、CSVエクスポート</li>
          </ol>
        </section>

        <section>
          <h3 className="text-md font-bold text-slate-700">F9キーの役割</h3>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800">
            CARTOでF9キーは「キャプチャ」（現在の測定値を記録）です。
            NCプログラムで測定位置に到達しドウェル停止中にF9を押すと角度誤差が記録されます。
          </div>
        </section>

        <section>
          <h3 className="text-md font-bold text-slate-700">CSVエクスポート手順</h3>
          <ol className="list-decimal list-inside space-y-1 text-slate-600">
            <li>測定完了後、CARTOメニューから「Export」選択</li>
            <li>「CSV」形式を選択</li>
            <li>ファイルを保存</li>
            <li>本ツールの「測定データ」タブで読み込み</li>
          </ol>
        </section>

        <section>
          <h3 className="text-md font-bold text-slate-700">トラブルシューティング</h3>
          <div className="space-y-2">
            {[
              ["信号が弱い / 赤色表示", "レーザーとリフレクターのアライメント再調整、光路上の障害物除去、リフレクター面の汚れ確認"],
              ["F9が反応しない", "CARTOウィンドウがアクティブか確認、ウィンドウタイトル設定確認、測定待機状態か確認"],
              ["測定値がずれる", "環境補正値を確認、XR20の取り付け確認、アライメントやり直し"],
            ].map(([problem, solution]) => (
              <div key={problem} className="bg-red-50 border border-red-100 rounded-lg p-3">
                <p className="font-bold text-red-800 text-sm">{problem}</p>
                <p className="text-red-600 text-sm mt-1">{solution}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-md font-bold text-slate-700">注意事項</h3>
          <ul className="list-disc list-inside space-y-1 text-slate-600">
            <li>測定中はレーザー光路を遮らないこと</li>
            <li>温度変化が大きい場合は環境補正を更新</li>
            <li>XR20のバッテリー残量に注意</li>
            <li>精密な測定には十分なウォームアップ時間が必要</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

/* =========================================================
   Utility Components
   ========================================================= */
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

function WaveformChart({
  cwData,
  ccwData,
}: {
  cwData: MeasurementRow[];
  ccwData: MeasurementRow[];
}) {
  const width = 900;
  const height = 320;
  const padding = { top: 40, right: 120, bottom: 50, left: 65 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const allData = [...cwData, ...ccwData];
  if (allData.length === 0) return null;

  const allErrors = allData.map((d) => d.errorArcSec);
  const maxAbs = Math.max(Math.abs(Math.max(...allErrors)), Math.abs(Math.min(...allErrors)), 1);
  const yMin = -maxAbs * 1.3;
  const yMax = maxAbs * 1.3;

  // X軸は両データを角度でソート
  const allAngles = [...new Set(allData.map((d) => d.targetAngle))].sort((a, b) => a - b);
  const scaleX = (angle: number) => padding.left + ((angle - allAngles[0]) / Math.max(allAngles[allAngles.length - 1] - allAngles[0], 1)) * chartW;
  const scaleY = (v: number) => padding.top + chartH - ((v - yMin) / (yMax - yMin)) * chartH;
  const zeroY = scaleY(0);

  const cwSorted = [...cwData].sort((a, b) => a.targetAngle - b.targetAngle);
  const ccwSorted = [...ccwData].sort((a, b) => a.targetAngle - b.targetAngle);
  const cwPath = cwSorted.map((d, i) => `${i === 0 ? "M" : "L"} ${scaleX(d.targetAngle)} ${scaleY(d.errorArcSec)}`).join(" ");
  const ccwPath = ccwSorted.map((d, i) => `${i === 0 ? "M" : "L"} ${scaleX(d.targetAngle)} ${scaleY(d.errorArcSec)}`).join(" ");

  const gridValues = [-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs];
  const labelCount = Math.min(12, allAngles.length);
  const labelStep = Math.max(1, Math.floor(allAngles.length / labelCount));

  return (
    <div className="bg-slate-50 rounded-lg p-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        {/* グリッド線 */}
        {gridValues.map((v) => (
          <g key={v}>
            <line x1={padding.left} y1={scaleY(v)} x2={width - padding.right} y2={scaleY(v)}
              stroke={v === 0 ? "#94a3b8" : "#e2e8f0"} strokeWidth={v === 0 ? 1 : 0.5} strokeDasharray={v === 0 ? "0" : "4,4"} />
            <text x={padding.left - 8} y={scaleY(v) + 4} textAnchor="end" fontSize={10} fill="#64748b">
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        {/* 軸ラベル (Y) */}
        <text x={18} y={height / 2} textAnchor="middle" fontSize={10} fill="#64748b"
          transform={`rotate(-90, 18, ${height / 2})`}>arc sec</text>
        {/* CW波形 */}
        {cwSorted.length > 1 && <path d={cwPath} fill="none" stroke="#3b82f6" strokeWidth={2} />}
        {cwSorted.map((d, i) => (
          <circle key={`cw${i}`} cx={scaleX(d.targetAngle)} cy={scaleY(d.errorArcSec)} r={3} fill="#3b82f6">
            <title>{`CW ${d.targetAngle.toFixed(2)}°: ${d.errorArcSec.toFixed(2)} ″`}</title>
          </circle>
        ))}
        {/* CCW波形 */}
        {ccwSorted.length > 1 && <path d={ccwPath} fill="none" stroke="#8b5cf6" strokeWidth={2} />}
        {ccwSorted.map((d, i) => (
          <circle key={`ccw${i}`} cx={scaleX(d.targetAngle)} cy={scaleY(d.errorArcSec)} r={3} fill="#8b5cf6">
            <title>{`CCW ${d.targetAngle.toFixed(2)}°: ${d.errorArcSec.toFixed(2)} ″`}</title>
          </circle>
        ))}
        {/* X軸ラベル */}
        {allAngles.filter((_, i) => i % labelStep === 0).map((angle) => (
          <text key={angle} x={scaleX(angle)} y={height - 10} textAnchor="middle" fontSize={9} fill="#64748b">
            {angle.toFixed(1)}°
          </text>
        ))}
        {/* 凡例 */}
        <rect x={width - padding.right + 10} y={padding.top} width={12} height={12} fill="#3b82f6" rx={2} />
        <text x={width - padding.right + 26} y={padding.top + 10} fontSize={11} fill="#64748b">CW</text>
        <rect x={width - padding.right + 10} y={padding.top + 20} width={12} height={12} fill="#8b5cf6" rx={2} />
        <text x={width - padding.right + 26} y={padding.top + 30} fontSize={11} fill="#64748b">CCW</text>
        {/* タイトル */}
        <text x={padding.left + chartW / 2} y={15} textAnchor="middle" fontSize={12} fontWeight="bold" fill="#334155">
          CW / CCW 誤差波形 (arc sec)
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
  wheelCwData, wheelCcwData, wheelCwStats, wheelCcwStats,
  wormCwData, wormCcwData, wormCwStats, wormCcwStats,
  repeatResult,
}: {
  settings: XR20Settings;
  wheelCwData: MeasurementRow[];
  wheelCcwData: MeasurementRow[];
  wheelCwStats: EvaluationStats;
  wheelCcwStats: EvaluationStats;
  wormCwData: MeasurementRow[];
  wormCcwData: MeasurementRow[];
  wormCwStats: EvaluationStats;
  wormCcwStats: EvaluationStats;
  repeatResult: RepeatabilityResult | null;
}) {
  const hasData = wheelCwData.length > 0 || wheelCcwData.length > 0 || wormCwData.length > 0 || wormCcwData.length > 0 || repeatResult !== null;
  if (!hasData) {
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
  const pitchAngle = (360 / settings.wheelTeeth) * settings.wormStarts;

  type Section = { label: string; data: MeasurementRow[]; stats: EvaluationStats; bgClass: string; textClass: string; chartColor: string };
  const wheelSections: Section[] = [
    { label: `ホイール CW (${settings.divisions}等分)`, data: wheelCwData, stats: wheelCwStats, bgClass: "bg-blue-50", textClass: "text-blue-800", chartColor: "#3b82f6" },
    { label: `ホイール CCW (${settings.divisions}等分)`, data: wheelCcwData, stats: wheelCcwStats, bgClass: "bg-purple-50", textClass: "text-purple-800", chartColor: "#8b5cf6" },
  ];
  const wormSections: Section[] = [
    { label: `ウォーム CW (1ピッチ ${pitchAngle.toFixed(4)}° / ${settings.wormDivisions}等分)`, data: wormCwData, stats: wormCwStats, bgClass: "bg-emerald-50", textClass: "text-emerald-800", chartColor: "#10b981" },
    { label: `ウォーム CCW (1ピッチ ${pitchAngle.toFixed(4)}° / ${settings.wormDivisions}等分)`, data: wormCcwData, stats: wormCcwStats, bgClass: "bg-teal-50", textClass: "text-teal-800", chartColor: "#6366f1" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => window.print()} className="btn-primary flex items-center gap-2">
          <FileText className="w-4 h-4" /> 印刷
        </button>
      </div>
      <div className="border border-slate-300 rounded-lg p-8 bg-white print:border-0 print:p-0" id="report">
        <div className="text-center border-b-2 border-slate-800 pb-4 mb-6">
          <h1 className="text-xl font-bold">ウォームホイール軸精度評価 成績書</h1>
          <p className="text-sm text-slate-500 mt-1">XR20 {axisLabel} ホイール割出し / ウォーム割出し / 再現性</p>
        </div>
        {/* 測定条件 */}
        <div className="mb-6">
          <h2 className="text-sm font-bold bg-slate-100 px-3 py-1.5 rounded mb-3">測定条件</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            {[
              ["測定日", today],
              ["型式", settings.machineModel || "-"],
              ["機番", settings.machineSerial || "-"],
              ["NC装置", settings.ncModel || "-"],
              ["軸タイプ", axisLabel],
              ["測定範囲", rangeInfo],
              ["ホイール歯数", `${settings.wheelTeeth} 枚`],
              ["ウォーム条数", `${settings.wormStarts} 条`],
              ["ホイール等分数", `${settings.divisions} 等分`],
              ["ウォーム等分数", `${settings.wormDivisions} 等分 / ピッチ`],
              ["オーバーラン角度", `${settings.overrunAngle}°`],
              ["測定器", "Renishaw XR20 + XL-80"],
            ].map(([label, val]) => (
              <div key={label} className="flex">
                <span className="w-40 text-slate-500">{label}:</span>
                <span className="font-medium">{val}</span>
              </div>
            ))}
          </div>
        </div>
        {/* ホイール結果 */}
        {wheelSections.map((sec) => sec.data.length > 0 && (
          <div key={sec.label} className="mb-6">
            <h2 className={`text-sm font-bold ${sec.bgClass} px-3 py-1.5 rounded mb-3 ${sec.textClass}`}>{sec.label}</h2>
            <div className="grid grid-cols-5 gap-2 text-sm mb-3">
              <ReportStat label="最大誤差" value={`${sec.stats.maxError.toFixed(2)} ″`} />
              <ReportStat label="最小誤差" value={`${sec.stats.minError.toFixed(2)} ″`} />
              <ReportStat label="平均誤差" value={`${sec.stats.meanError.toFixed(2)} ″`} />
              <ReportStat label="σ" value={`${sec.stats.sigma.toFixed(2)} ″`} />
              <ReportStat label="割出し精度" value={`${sec.stats.indexAccuracy.toFixed(2)} ″`} highlight />
            </div>
            <LineChartSVG data={sec.data} color={sec.chartColor} title={`${sec.label} (arc sec)`} />
          </div>
        ))}
        {/* ウォーム結果 */}
        {wormSections.map((sec) => sec.data.length > 0 && (
          <div key={sec.label} className="mb-6">
            <h2 className={`text-sm font-bold ${sec.bgClass} px-3 py-1.5 rounded mb-3 ${sec.textClass}`}>{sec.label}</h2>
            <div className="grid grid-cols-5 gap-2 text-sm mb-3">
              <ReportStat label="最大誤差" value={`${sec.stats.maxError.toFixed(2)} ″`} />
              <ReportStat label="最小誤差" value={`${sec.stats.minError.toFixed(2)} ″`} />
              <ReportStat label="平均誤差" value={`${sec.stats.meanError.toFixed(2)} ″`} />
              <ReportStat label="σ" value={`${sec.stats.sigma.toFixed(2)} ″`} />
              <ReportStat label="割出し精度" value={`${sec.stats.indexAccuracy.toFixed(2)} ″`} highlight />
            </div>
            <LineChartSVG data={sec.data} color={sec.chartColor} title={`${sec.label} (arc sec)`} />
          </div>
        ))}
        {/* 再現性 */}
        {repeatResult && (
          <div className="mb-6">
            <h2 className="text-sm font-bold bg-amber-50 px-3 py-1.5 rounded mb-3 text-amber-800">
              再現性 (測定位置: {repeatResult.positions.map(p => `${p.angle}°`).join(", ")})
            </h2>
            <div className="overflow-x-auto mb-3">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-amber-50">
                    <th className="border border-slate-300 px-3 py-1.5 text-left">位置 (°)</th>
                    <th className="border border-slate-300 px-3 py-1.5 text-right">CW Range (″)</th>
                    <th className="border border-slate-300 px-3 py-1.5 text-right">CCW Range (″)</th>
                  </tr>
                </thead>
                <tbody>
                  {repeatResult.positions.map((ps) => (
                    <tr key={ps.angle}>
                      <td className="border border-slate-300 px-3 py-1 font-medium">{ps.angle}</td>
                      <td className="border border-slate-300 px-3 py-1 text-right font-mono">{ps.cwRange.toFixed(2)}</td>
                      <td className="border border-slate-300 px-3 py-1 text-right font-mono">{ps.ccwRange.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <ReportStat label="再現性" value={`${repeatResult.repeatability.toFixed(2)} ″`} highlight />
              <ReportStat label="最大範囲 R" value={`${Math.max(...repeatResult.positions.map(p => Math.max(p.cwRange, p.ccwRange))).toFixed(2)} ″`} />
            </div>
          </div>
        )}
        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-slate-300 grid grid-cols-3 gap-4 text-sm text-slate-500">
          {["測定者", "確認者", "承認者"].map((role) => (
            <div key={role}>
              <p className="text-xs mb-1">{role}</p>
              <div className="border-b border-slate-300 h-8" />
            </div>
          ))}
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
