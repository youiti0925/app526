"use client";

import { useState } from "react";
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Languages,
  FileText,
  Captions,
  Waves,
  AlertCircle,
  CheckCircle2,
  Settings,
} from "lucide-react";

interface TranscriptSegment {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  confidence: number;
  speaker?: string;
  language: string;
}

interface SpeechToTextProps {
  hasAudio: boolean;
  onTranscriptionComplete?: (segments: TranscriptSegment[]) => void;
}

const demoTranscripts: TranscriptSegment[] = [
  {
    id: "t-1",
    startTime: 0,
    endTime: 8,
    text: "まず最初に、室温が規定範囲内であることを確認します。温度計を見てください。",
    confidence: 0.95,
    speaker: "検査員A",
    language: "ja",
  },
  {
    id: "t-2",
    startTime: 10,
    endTime: 22,
    text: "20.3度です。規定の20±2度の範囲内ですので、測定を開始できます。",
    confidence: 0.92,
    speaker: "検査員A",
    language: "ja",
  },
  {
    id: "t-3",
    startTime: 45,
    endTime: 60,
    text: "次にダイヤルゲージをテーブル面にセットします。測定子はテーブル中心に対して直角に当ててください。",
    confidence: 0.89,
    speaker: "検査員A",
    language: "ja",
  },
  {
    id: "t-4",
    startTime: 65,
    endTime: 78,
    text: "予圧は0.3から0.5ミリ確保します。ゲージのゼロセットを行います。",
    confidence: 0.91,
    speaker: "検査員A",
    language: "ja",
  },
  {
    id: "t-5",
    startTime: 120,
    endTime: 140,
    text: "テーブルをゆっくり360度回転させます。回転速度は約10秒で1回転程度にしてください。",
    confidence: 0.94,
    speaker: "検査員A",
    language: "ja",
  },
  {
    id: "t-6",
    startTime: 180,
    endTime: 195,
    text: "1回目の測定結果、最大値0.003ミリ、最小値マイナス0.001ミリ。振れ幅0.004ミリです。",
    confidence: 0.88,
    speaker: "検査員A",
    language: "ja",
  },
];

export default function SpeechToText({ hasAudio, onTranscriptionComplete }: SpeechToTextProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState("ja");
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [silentVideoMode, setSilentVideoMode] = useState(!hasAudio);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleStartTranscription = () => {
    setIsProcessing(true);
    // Simulate transcription
    setTimeout(() => {
      setTranscripts(demoTranscripts);
      setIsProcessing(false);
      onTranscriptionComplete?.(demoTranscripts);
    }, 3000);
  };

  const languageOptions = [
    { value: "ja", label: "日本語" },
    { value: "en", label: "English" },
    { value: "zh", label: "中文" },
    { value: "ko", label: "한국어" },
    { value: "vi", label: "Tiếng Việt" },
    { value: "th", label: "ภาษาไทย" },
    { value: "pt", label: "Português" },
    { value: "es", label: "Español" },
  ];

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-900 flex items-center gap-2">
          {hasAudio ? (
            <Volume2 className="w-5 h-5 text-blue-500" />
          ) : (
            <VolumeX className="w-5 h-5 text-amber-500" />
          )}
          音声・字幕処理
        </h3>

        {silentVideoMode && (
          <span className="badge badge-warning flex items-center gap-1">
            <VolumeX className="w-3 h-3" />
            音声なしモード
          </span>
        )}
      </div>

      {/* Silent Video Notice */}
      {!hasAudio && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg mb-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800">音声が検出されませんでした</p>
              <p className="text-xs text-amber-700 mt-1">
                音声なし動画モードで処理します。AI映像分析（シーン検出・動作認識・OCR）のみで
                作業ステップを自動構成します。工場現場の動画に最適化されています。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <label className="text-xs text-slate-500 block mb-1">音声言語</label>
          <select
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm"
          >
            {languageOptions.map((lang) => (
              <option key={lang.value} value={lang.value}>{lang.label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 mt-5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showSubtitles}
              onChange={(e) => setShowSubtitles(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm text-slate-600">字幕表示</span>
          </label>
        </div>

        {hasAudio && (
          <button
            onClick={handleStartTranscription}
            disabled={isProcessing}
            className="btn-primary flex items-center gap-2 text-sm mt-5 disabled:opacity-50"
          >
            {isProcessing ? (
              <>
                <Waves className="w-4 h-4 animate-pulse" />
                音声認識中...
              </>
            ) : (
              <>
                <Mic className="w-4 h-4" />
                音声テキスト変換を実行
              </>
            )}
          </button>
        )}
      </div>

      {/* Transcript Results */}
      {transcripts.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Captions className="w-4 h-4 text-green-500" />
            <span className="text-sm font-medium text-slate-700">
              書き起こし結果（{transcripts.length}セグメント）
            </span>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {transcripts.map((segment) => (
              <div
                key={segment.id}
                className="flex items-start gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors text-sm"
              >
                <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap mt-0.5">
                  {formatTime(segment.startTime)}
                </span>
                {segment.speaker && (
                  <span className="badge badge-info text-xs flex-shrink-0">{segment.speaker}</span>
                )}
                <p className="text-slate-700 flex-1">{segment.text}</p>
                <span className="text-xs text-slate-400 flex-shrink-0">
                  {Math.round(segment.confidence * 100)}%
                </span>
              </div>
            ))}
          </div>

          {/* Auto-translate option */}
          <div className="mt-4 p-3 bg-blue-50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Languages className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-800">自動翻訳</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {languageOptions
                .filter((l) => l.value !== selectedLanguage)
                .map((lang) => (
                  <button
                    key={lang.value}
                    className="px-3 py-1 text-xs rounded-full bg-white border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors"
                  >
                    {lang.label}に翻訳
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Integration with SOP Generation */}
      {transcripts.length > 0 && (
        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
          <p className="text-sm text-green-700">
            音声テキストは作業ステップの説明文に自動統合されます。
          </p>
        </div>
      )}
    </div>
  );
}
