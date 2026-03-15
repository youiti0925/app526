"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/ui/Sidebar";
import Header from "@/components/ui/Header";
import { Settings, Key, Eye, EyeOff, CheckCircle2, AlertCircle, ExternalLink, BookOpen, Plus, Trash2, X, ToggleLeft, ToggleRight, GitBranch, Activity, ArrowLeftRight } from "lucide-react";
import { fetchSettings, saveSettings, fetchFeatureToggles, saveFeatureToggles } from "@/lib/settings";
import { fetchGlossary, addGlossaryEntry as addGlossaryEntryApi, deleteGlossaryEntry as deleteGlossaryEntryApi, type GlossaryEntry } from "@/lib/glossary";
import CompanyTemplateManager from "@/components/editor/CompanyTemplateManager";
import type { FeatureToggles } from "@/types";

const categoryLabels: Record<GlossaryEntry["category"], string> = {
  machine: "機械",
  tool: "工具",
  measurement: "測定",
  process: "工程",
  material: "材料",
  safety: "安全",
  other: "その他",
};

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [glossary, setGlossary] = useState<GlossaryEntry[]>([]);
  const [showAddTerm, setShowAddTerm] = useState(false);
  const [newTerm, setNewTerm] = useState({ term: "", definition: "", category: "other" as GlossaryEntry["category"], synonyms: "" });
  const [features, setFeatures] = useState<FeatureToggles>({
    conditionalBranching: true,
    sopDriftDetection: true,
    bidirectionalSync: true,
  });

  useEffect(() => {
    fetchSettings().then((s) => setApiKey(s.geminiApiKey));
    fetchGlossary().then(setGlossary);
    fetchFeatureToggles().then(setFeatures);
  }, []);

  const handleToggleFeature = (key: keyof FeatureToggles) => {
    const updated = { ...features, [key]: !features[key] };
    setFeatures(updated);
    saveFeatureToggles(updated);
  };

  const handleSave = () => {
    saveSettings({ geminiApiKey: apiKey.trim() });
    setSaved(true);
    setTestResult(null);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleTest = async () => {
    if (!apiKey.trim()) {
      setTestResult({ success: false, message: "APIキーを入力してください" });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const response = await fetch("/api/test-api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });

      const data = await response.json();

      if (response.ok) {
        setTestResult({ success: true, message: "APIキーは有効です！" });
      } else {
        setTestResult({ success: false, message: data.error || "APIキーの検証に失敗しました" });
      }
    } catch {
      setTestResult({ success: false, message: "接続エラー。ネットワークを確認してください。" });
    } finally {
      setTesting(false);
    }
  };

  const handleAddTerm = async () => {
    if (!newTerm.term.trim()) return;
    const entry = await addGlossaryEntryApi({
      term: newTerm.term.trim(),
      definition: newTerm.definition.trim(),
      category: newTerm.category,
      synonyms: newTerm.synonyms.split(",").map((s) => s.trim()).filter(Boolean),
    });
    setGlossary((prev) => [...prev, entry]);
    setNewTerm({ term: "", definition: "", category: "other", synonyms: "" });
    setShowAddTerm(false);
  };

  const handleDeleteTerm = async (id: string) => {
    setGlossary((prev) => prev.filter((e) => e.id !== id));
    await deleteGlossaryEntryApi(id);
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 bg-slate-50 p-6">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-3 mb-6">
              <Settings className="w-6 h-6 text-slate-700" />
              <h1 className="text-2xl font-bold text-slate-900">設定</h1>
            </div>

            {/* API Key Settings */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <Key className="w-5 h-5 text-blue-500" />
                <h2 className="text-lg font-bold text-slate-900">Google Gemini API キー</h2>
              </div>

              <p className="text-sm text-slate-500 mb-4">
                動画のAI分析に Google Gemini API を使用します。
                APIキーは <strong>サーバーのデータベース</strong> に保存されます。
              </p>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-bold text-blue-900 mb-2">APIキーの取得方法</h3>
                <ol className="text-sm text-blue-800 space-y-2 list-decimal list-inside">
                  <li>
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 underline font-medium"
                    >
                      Google AI Studio <ExternalLink className="w-3 h-3" />
                    </a>
                    {" "}を開く
                  </li>
                  <li>Googleアカウントでログインする</li>
                  <li>「APIキーを作成」ボタンをクリック</li>
                  <li>表示されたAPIキーをコピーして、下の入力欄に貼り付ける</li>
                </ol>
                <p className="text-xs text-blue-600 mt-2">
                  ※ 無料枠があり、個人利用であれば料金はかかりません
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">APIキー</label>
                  <div className="relative">
                    <input
                      type={showKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="AIza..."
                      className="w-full px-4 py-2 pr-10 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono text-sm"
                      style={{ borderColor: "var(--card-border)" }}
                    />
                    <button
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-100 rounded"
                    >
                      {showKey ? <EyeOff className="w-4 h-4 text-slate-400" /> : <Eye className="w-4 h-4 text-slate-400" />}
                    </button>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button onClick={handleSave} className="btn-primary px-6">保存</button>
                  <button onClick={handleTest} disabled={testing} className="btn-secondary px-6 disabled:opacity-50">
                    {testing ? "テスト中..." : "接続テスト"}
                  </button>
                </div>

                {saved && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle2 className="w-4 h-4" />保存しました
                  </div>
                )}
                {testResult && (
                  <div className={`flex items-center gap-2 text-sm ${testResult.success ? "text-green-600" : "text-red-600"}`}>
                    {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    {testResult.message}
                  </div>
                )}
              </div>
            </div>

            {/* Glossary / Terminology Dictionary */}
            <div className="card mt-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-purple-500" />
                  <h2 className="text-lg font-bold text-slate-900">専門用語辞書</h2>
                </div>
                <button
                  onClick={() => setShowAddTerm(!showAddTerm)}
                  className="btn-primary flex items-center gap-1 text-sm py-1.5 px-3"
                >
                  <Plus className="w-4 h-4" />用語追加
                </button>
              </div>

              <p className="text-sm text-slate-500 mb-4">
                業界固有の専門用語を登録すると、AI分析時のテキスト認識・手順生成の精度が向上します。
                機械名・部品名・略語などを登録してください。
              </p>

              {/* Add new term form */}
              {showAddTerm && (
                <div className="border rounded-lg p-4 mb-4 bg-purple-50" style={{ borderColor: "#c4b5fd" }}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-purple-900">新しい用語を追加</h3>
                    <button onClick={() => setShowAddTerm(false)} className="p-1 hover:bg-purple-100 rounded">
                      <X className="w-4 h-4 text-purple-500" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1 block">用語 *</label>
                      <input
                        type="text"
                        value={newTerm.term}
                        onChange={(e) => setNewTerm({ ...newTerm, term: e.target.value })}
                        placeholder="例: CRT-320"
                        className="w-full border rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-purple-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1 block">カテゴリ</label>
                      <select
                        value={newTerm.category}
                        onChange={(e) => setNewTerm({ ...newTerm, category: e.target.value as GlossaryEntry["category"] })}
                        className="w-full border rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-purple-400"
                      >
                        {Object.entries(categoryLabels).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs font-medium text-slate-600 mb-1 block">定義・説明</label>
                      <input
                        type="text"
                        value={newTerm.definition}
                        onChange={(e) => setNewTerm({ ...newTerm, definition: e.target.value })}
                        placeholder="例: CNC円テーブル 型式CRT-320"
                        className="w-full border rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-purple-400"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs font-medium text-slate-600 mb-1 block">別名・略語（カンマ区切り）</label>
                      <input
                        type="text"
                        value={newTerm.synonyms}
                        onChange={(e) => setNewTerm({ ...newTerm, synonyms: e.target.value })}
                        placeholder="例: 円テーブル, ロータリーテーブル"
                        className="w-full border rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-purple-400"
                      />
                    </div>
                  </div>
                  <button
                    onClick={handleAddTerm}
                    disabled={!newTerm.term.trim()}
                    className="mt-3 btn-primary text-sm py-1.5 px-4 disabled:opacity-50"
                  >
                    追加
                  </button>
                </div>
              )}

              {/* Glossary list */}
              {glossary.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm">
                  <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  まだ用語が登録されていません
                </div>
              ) : (
                <div className="space-y-2">
                  {glossary.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg group">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-slate-900">{entry.term}</span>
                          <span className="badge text-xs" style={{ background: "#ede9fe", color: "#7c3aed" }}>
                            {categoryLabels[entry.category]}
                          </span>
                        </div>
                        {entry.definition && (
                          <p className="text-xs text-slate-500 mt-0.5">{entry.definition}</p>
                        )}
                        {entry.synonyms.length > 0 && (
                          <p className="text-xs text-slate-400 mt-0.5">別名: {entry.synonyms.join(", ")}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleDeleteTerm(entry.id)}
                        className="p-1 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Company Templates */}
            <div className="card mt-6">
              <CompanyTemplateManager />
            </div>

            {/* Feature Toggles */}
            <div className="card mt-6">
              <div className="flex items-center gap-2 mb-4">
                <Settings className="w-5 h-5 text-indigo-500" />
                <h2 className="text-lg font-bold text-slate-900">機能のON/OFF</h2>
              </div>
              <p className="text-sm text-slate-500 mb-4">
                各機能の有効/無効を切り替えられます。無効にした機能はプロジェクト画面のタブに表示されなくなります。
              </p>
              <div className="space-y-3">
                {([
                  {
                    key: "conditionalBranching" as keyof FeatureToggles,
                    label: "条件分岐型作業指示書",
                    description: "製品バリエーションや条件に応じて、異なるステップを実行する分岐を設定できます",
                    icon: GitBranch,
                    color: "#8b5cf6",
                  },
                  {
                    key: "sopDriftDetection" as keyof FeatureToggles,
                    label: "SOP逸脱検出",
                    description: "録画された実際の作業とSOPを比較し、手順・時間・工具使用の逸脱を自動検出します",
                    icon: Activity,
                    color: "#f97316",
                  },
                  {
                    key: "bidirectionalSync" as keyof FeatureToggles,
                    label: "動画⇔文書の双方向同期",
                    description: "動画と文書の対応関係を追跡し、どちらかが更新された際にアラートを出します",
                    icon: ArrowLeftRight,
                    color: "#06b6d4",
                  },
                ]).map((feature) => {
                  const Icon = feature.icon;
                  const isEnabled = features[feature.key];
                  return (
                    <div
                      key={feature.key}
                      className="flex items-center gap-3 p-3 rounded-lg border"
                      style={{ borderColor: isEnabled ? feature.color + "40" : "var(--card-border)", background: isEnabled ? feature.color + "08" : "transparent" }}
                    >
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: isEnabled ? feature.color + "20" : "#f1f5f9" }}
                      >
                        <Icon className="w-4.5 h-4.5" style={{ color: isEnabled ? feature.color : "#94a3b8" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium text-slate-900">{feature.label}</h3>
                        <p className="text-xs text-slate-500 mt-0.5">{feature.description}</p>
                      </div>
                      <button
                        onClick={() => handleToggleFeature(feature.key)}
                        className="flex-shrink-0 transition-colors"
                      >
                        {isEnabled ? (
                          <ToggleRight className="w-8 h-8" style={{ color: feature.color }} />
                        ) : (
                          <ToggleLeft className="w-8 h-8 text-slate-300" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Data Management */}
            <div className="card mt-6">
              <h2 className="text-lg font-bold text-slate-900 mb-4">データ管理</h2>
              <p className="text-sm text-slate-500 mb-4">
                プロジェクトデータはサーバーのSQLiteデータベースに保存されています。
                動画ファイルはサーバーのファイルシステム（data/uploads/）に保存されます。
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
