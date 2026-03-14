"use client";

import { useState } from "react";
import {
  Smartphone,
  QrCode,
  Wifi,
  WifiOff,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Wrench,
  Eye,
  Maximize2,
  Hand,
  Volume2,
} from "lucide-react";

interface MobileViewerProps {
  sopTitle: string;
  currentStep: number;
  totalSteps: number;
}

export default function MobileViewer({ sopTitle, currentStep: initialStep, totalSteps }: MobileViewerProps) {
  const [step, setStep] = useState(initialStep);
  const [isOffline, setIsOffline] = useState(false);
  const [showQR, setShowQR] = useState(false);

  const demoSteps = [
    { title: "検査準備", time: "5分", icon: "🔧" },
    { title: "ゲージセッティング", time: "3分", icon: "📐" },
    { title: "面振れ測定", time: "10分", icon: "🔄" },
    { title: "外周振れ測定", time: "10分", icon: "🔄" },
    { title: "割出し精度測定", time: "15分", icon: "📊" },
    { title: "結果記録", time: "5分", icon: "📝" },
    { title: "後片付け", time: "5分", icon: "🧹" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Smartphone className="w-6 h-6 text-blue-500" />
          モバイル・現場対応ビューア
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowQR(!showQR)}
            className="btn-secondary flex items-center gap-1.5 text-sm"
          >
            <QrCode className="w-4 h-4" />
            QRコード
          </button>
          <button
            onClick={() => setIsOffline(!isOffline)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${
              isOffline
                ? "bg-amber-100 text-amber-700 border border-amber-300"
                : "bg-green-100 text-green-700 border border-green-300"
            }`}
          >
            {isOffline ? (
              <>
                <WifiOff className="w-4 h-4" />
                オフラインモード
              </>
            ) : (
              <>
                <Wifi className="w-4 h-4" />
                オンライン
              </>
            )}
          </button>
        </div>
      </div>

      {/* QR Code Display */}
      {showQR && (
        <div className="card text-center">
          <h3 className="font-bold text-slate-900 mb-3">現場アクセス用QRコード</h3>
          <div className="w-48 h-48 mx-auto bg-slate-100 border-2 border-slate-300 rounded-xl flex items-center justify-center mb-3">
            <div className="text-center">
              <QrCode className="w-16 h-16 text-slate-400 mx-auto mb-2" />
              <p className="text-xs text-slate-500">QR Code</p>
            </div>
          </div>
          <p className="text-sm text-slate-500">
            このQRコードをスキャンして、スマートフォンからSOPにアクセスできます
          </p>
          <p className="text-xs text-slate-400 mt-2">
            NFC対応端末では、工作機械のNFCタグにタッチしてもアクセスできます
          </p>
        </div>
      )}

      {/* Mobile Preview */}
      <div className="flex justify-center">
        <div className="w-80 bg-slate-900 rounded-3xl p-3 shadow-2xl">
          {/* Phone Frame */}
          <div className="bg-white rounded-2xl overflow-hidden" style={{ height: "600px" }}>
            {/* Status Bar */}
            <div className="bg-blue-600 text-white px-4 py-2 flex items-center justify-between text-xs">
              <span>9:41</span>
              <span className="font-medium">{sopTitle}</span>
              <div className="flex items-center gap-1">
                {isOffline ? (
                  <WifiOff className="w-3 h-3" />
                ) : (
                  <Wifi className="w-3 h-3" />
                )}
              </div>
            </div>

            {/* Progress Bar */}
            <div className="px-4 pt-3 pb-2">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span>ステップ {step + 1} / {demoSteps.length}</span>
                <span>{Math.round(((step + 1) / demoSteps.length) * 100)}%</span>
              </div>
              <div className="progress-bar" style={{ height: "4px" }}>
                <div
                  className="progress-bar-fill"
                  style={{ width: `${((step + 1) / demoSteps.length) * 100}%` }}
                />
              </div>
            </div>

            {/* Step Content */}
            <div className="px-4 py-3">
              {/* Step Image Area */}
              <div className="h-36 bg-gradient-to-br from-slate-100 to-slate-200 rounded-xl mb-3 flex items-center justify-center relative">
                <span className="text-3xl">{demoSteps[step]?.icon}</span>
                <button className="absolute top-2 right-2 p-1.5 bg-white/80 rounded-lg">
                  <Maximize2 className="w-4 h-4 text-slate-600" />
                </button>
                <button className="absolute bottom-2 right-2 p-1.5 bg-white/80 rounded-lg">
                  <Volume2 className="w-4 h-4 text-slate-600" />
                </button>
              </div>

              {/* Step Info */}
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                    {step + 1}
                  </span>
                  <h3 className="font-bold text-slate-900 text-base">
                    {demoSteps[step]?.title}
                  </h3>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 ml-9">
                  <Clock className="w-3 h-3" />
                  <span>所要時間: {demoSteps[step]?.time}</span>
                </div>
              </div>

              {/* Key Points - Large Touch Targets */}
              <div className="space-y-2 mb-3">
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800 font-medium">
                      測定子はテーブル中心に対して直角に当てる
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-green-50 border border-green-200 rounded-xl">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-green-800 font-medium">
                      合格基準: ≦0.005mm
                    </p>
                  </div>
                </div>
              </div>

              {/* Tools */}
              <div className="flex items-center gap-2 mb-3 text-xs">
                <Wrench className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-slate-500">ダイヤルゲージ、マグネットスタンド</span>
              </div>
            </div>

            {/* Large Navigation Buttons (Glove-friendly) */}
            <div className="px-4 pb-4 mt-auto">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setStep(Math.max(0, step - 1))}
                  disabled={step === 0}
                  className="flex-1 py-4 rounded-xl bg-slate-100 text-slate-700 font-bold text-base flex items-center justify-center gap-2 disabled:opacity-30 active:bg-slate-200"
                >
                  <ChevronLeft className="w-5 h-5" />
                  前へ
                </button>

                {step < demoSteps.length - 1 ? (
                  <button
                    onClick={() => setStep(step + 1)}
                    className="flex-1 py-4 rounded-xl bg-blue-600 text-white font-bold text-base flex items-center justify-center gap-2 active:bg-blue-700"
                  >
                    次へ
                    <ChevronRight className="w-5 h-5" />
                  </button>
                ) : (
                  <button className="flex-1 py-4 rounded-xl bg-green-600 text-white font-bold text-base flex items-center justify-center gap-2 active:bg-green-700">
                    <CheckCircle2 className="w-5 h-5" />
                    完了
                  </button>
                )}
              </div>

              {/* Step Dots */}
              <div className="flex items-center justify-center gap-1.5 mt-3">
                {demoSteps.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setStep(i)}
                    className={`w-2.5 h-2.5 rounded-full transition-all ${
                      i === step
                        ? "bg-blue-600 w-6"
                        : i < step
                        ? "bg-green-500"
                        : "bg-slate-300"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Glove Mode Indicator */}
            <div className="bg-slate-50 px-4 py-2 flex items-center justify-center gap-1.5 text-xs text-slate-500 border-t" style={{ borderColor: "var(--card-border)" }}>
              <Hand className="w-3 h-3" />
              手袋対応モード（大きなタッチターゲット）
            </div>
          </div>
        </div>
      </div>

      {/* Features Description */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card text-center">
          <WifiOff className="w-8 h-8 text-amber-500 mx-auto mb-2" />
          <h3 className="font-bold text-sm text-slate-900 mb-1">オフライン対応</h3>
          <p className="text-xs text-slate-500">
            インターネット接続なしでもSOPを閲覧可能。工場内のWi-Fiが不安定な環境でも安心。
          </p>
        </div>
        <div className="card text-center">
          <Hand className="w-8 h-8 text-blue-500 mx-auto mb-2" />
          <h3 className="font-bold text-sm text-slate-900 mb-1">手袋対応UI</h3>
          <p className="text-xs text-slate-500">
            大きなボタンとタッチターゲットで、作業手袋を着用したままでも操作可能。
          </p>
        </div>
        <div className="card text-center">
          <QrCode className="w-8 h-8 text-green-500 mx-auto mb-2" />
          <h3 className="font-bold text-sm text-slate-900 mb-1">QR/NFCアクセス</h3>
          <p className="text-xs text-slate-500">
            工作機械に貼付したQRコードまたはNFCタグから即座にSOPにアクセス。
          </p>
        </div>
      </div>
    </div>
  );
}
