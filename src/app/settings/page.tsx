"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/ui/Sidebar";
import Header from "@/components/ui/Header";
import { Settings, Key, Eye, EyeOff, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import { getSettings, saveSettings } from "@/lib/settings";

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    const settings = getSettings();
    setApiKey(settings.geminiApiKey);
  }, []);

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
                APIキーは <strong>ブラウザのローカルストレージ</strong> に保存され、サーバーには保存されません。
              </p>

              {/* How to get API key */}
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

              {/* API Key Input */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    APIキー
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
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
                        {showKey ? (
                          <EyeOff className="w-4 h-4 text-slate-400" />
                        ) : (
                          <Eye className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    className="btn-primary px-6"
                  >
                    保存
                  </button>
                  <button
                    onClick={handleTest}
                    disabled={testing}
                    className="btn-secondary px-6 disabled:opacity-50"
                  >
                    {testing ? "テスト中..." : "接続テスト"}
                  </button>
                </div>

                {/* Status messages */}
                {saved && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle2 className="w-4 h-4" />
                    保存しました
                  </div>
                )}

                {testResult && (
                  <div className={`flex items-center gap-2 text-sm ${testResult.success ? "text-green-600" : "text-red-600"}`}>
                    {testResult.success ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <AlertCircle className="w-4 h-4" />
                    )}
                    {testResult.message}
                  </div>
                )}
              </div>
            </div>

            {/* Data Management */}
            <div className="card mt-6">
              <h2 className="text-lg font-bold text-slate-900 mb-4">データ管理</h2>
              <p className="text-sm text-slate-500 mb-4">
                プロジェクトデータはブラウザのローカルストレージに保存されています。
              </p>
              <div className="text-xs text-slate-400">
                <p>ストレージ使用量: {typeof window !== "undefined" ? `約${Math.round(JSON.stringify(localStorage).length / 1024)}KB` : "-"}</p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
