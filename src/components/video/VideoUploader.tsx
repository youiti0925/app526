"use client";

import { useState, useCallback, useRef } from "react";
import {
  Upload,
  Video,
  X,
  CheckCircle2,
  AlertCircle,
  FileVideo,
  Loader2,
  MessageSquarePlus,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface VideoUploaderProps {
  onUploadComplete: (file: File, previewUrl: string, context?: VideoContext) => void;
}

export interface VideoContext {
  workDescription: string;
  workerNotes: string;
  knowledgeTips: string;
  safetyPoints: string;
}

export default function VideoUploader({ onUploadComplete }: VideoUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [context, setContext] = useState<VideoContext>({
    workDescription: "",
    workerNotes: "",
    knowledgeTips: "",
    safetyPoints: "",
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const acceptedFormats = ["video/mp4", "video/mpeg", "video/quicktime", "video/x-msvideo", "video/webm"];
  const maxFileSize = 2 * 1024 * 1024 * 1024; // 2GB

  const validateFile = (file: File): string | null => {
    if (!acceptedFormats.includes(file.type)) {
      return "対応していないファイル形式です。MP4, MOV, AVI, WebM形式をアップロードしてください。";
    }
    if (file.size > maxFileSize) {
      return "ファイルサイズが上限（2GB）を超えています。";
    }
    return null;
  };

  const handleFile = useCallback(
    (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      setError(null);
      setIsUploading(true);
      setUploadedFile(file);

      const url = URL.createObjectURL(file);
      setPreviewUrl(url);

      // Simulate upload progress
      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 15 + 5;
        if (progress >= 100) {
          progress = 100;
          clearInterval(interval);
          setIsUploading(false);
        }
        setUploadProgress(Math.min(progress, 100));
      }, 200);
    },
    []
  );

  const handleConfirm = () => {
    if (uploadedFile && previewUrl) {
      onUploadComplete(uploadedFile, previewUrl, context);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const resetUpload = () => {
    setUploadedFile(null);
    setPreviewUrl(null);
    setUploadProgress(0);
    setIsUploading(false);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const formatFileSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  // Post-upload: show preview + context input + confirm
  if (uploadedFile && !isUploading) {
    return (
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            <h3 className="font-bold text-slate-900">動画アップロード完了</h3>
          </div>
          <button onClick={resetUpload} className="p-1 hover:bg-slate-100 rounded">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {previewUrl && (
          <div className="relative rounded-lg overflow-hidden bg-black mb-4">
            <video
              ref={videoRef}
              src={previewUrl}
              controls
              className="w-full max-h-72 object-contain"
            />
          </div>
        )}

        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg mb-4">
          <FileVideo className="w-8 h-8 text-blue-500" />
          <div className="flex-1">
            <p className="font-medium text-sm text-slate-900">{uploadedFile.name}</p>
            <p className="text-xs text-slate-500">{formatFileSize(uploadedFile.size)}</p>
          </div>
        </div>

        {/* Context Input Section */}
        <div className="border rounded-lg mb-4" style={{ borderColor: "var(--card-border)" }}>
          <button
            onClick={() => setShowContext(!showContext)}
            className="w-full flex items-center justify-between p-3 hover:bg-slate-50 transition-colors rounded-lg"
          >
            <div className="flex items-center gap-2">
              <MessageSquarePlus className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-medium text-slate-700">
                作業の補足情報を追加（AI分析の精度が向上します）
              </span>
            </div>
            {showContext ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {showContext && (
            <div className="p-4 pt-0 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  作業の概要・目的
                </label>
                <textarea
                  value={context.workDescription}
                  onChange={(e) => setContext({ ...context, workDescription: e.target.value })}
                  placeholder="例：CNC円テーブルの回転精度検査。月次定期検査として実施。"
                  className="w-full px-3 py-2 border rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  style={{ borderColor: "var(--card-border)" }}
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  作業者のコツ・暗黙知
                </label>
                <textarea
                  value={context.knowledgeTips}
                  onChange={(e) => setContext({ ...context, knowledgeTips: e.target.value })}
                  placeholder="例：ダイヤルゲージはマグネットベースを鉄板に置く前に必ずゼロリセット。指で軽く叩いて針が戻るか確認する。"
                  className="w-full px-3 py-2 border rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  style={{ borderColor: "var(--card-border)" }}
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  安全上の注意点
                </label>
                <textarea
                  value={context.safetyPoints}
                  onChange={(e) => setContext({ ...context, safetyPoints: e.target.value })}
                  placeholder="例：回転中は絶対に手を近づけない。保護メガネ必須。"
                  className="w-full px-3 py-2 border rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  style={{ borderColor: "var(--card-border)" }}
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  その他メモ
                </label>
                <textarea
                  value={context.workerNotes}
                  onChange={(e) => setContext({ ...context, workerNotes: e.target.value })}
                  placeholder="例：この動画は途中でカメラアングルが変わります。後半は別の検査員が作業しています。"
                  className="w-full px-3 py-2 border rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  style={{ borderColor: "var(--card-border)" }}
                  rows={2}
                />
              </div>
            </div>
          )}
        </div>

        <button
          onClick={handleConfirm}
          className="w-full btn-primary py-3 text-center font-medium"
        >
          この動画で進む
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
        <Video className="w-5 h-5 text-blue-500" />
        動画ファイルをアップロード
      </h3>

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer ${
          isDragging ? "drag-over border-blue-400 bg-blue-50" : "border-slate-300 hover:border-blue-400 hover:bg-slate-50"
        }`}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={handleFileSelect}
          className="hidden"
        />

        {isUploading ? (
          <div className="space-y-4">
            <Loader2 className="w-12 h-12 text-blue-500 mx-auto animate-spin" />
            <p className="text-sm font-medium text-slate-700">アップロード中...</p>
            <div className="w-64 mx-auto">
              <div className="progress-bar">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">{Math.round(uploadProgress)}%</p>
            </div>
            {uploadedFile && (
              <p className="text-xs text-slate-400">
                {uploadedFile.name} ({formatFileSize(uploadedFile.size)})
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <Upload className="w-12 h-12 text-slate-400 mx-auto" />
            <div>
              <p className="text-lg font-medium text-slate-700">
                動画ファイルをドラッグ＆ドロップ
              </p>
              <p className="text-sm text-slate-500 mt-1">
                または<span className="text-blue-600 font-medium">クリックして選択</span>
              </p>
            </div>
            <div className="flex items-center justify-center gap-4 text-xs text-slate-400">
              <span>MP4, MOV, AVI, WebM</span>
              <span>|</span>
              <span>最大2GB</span>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="mt-4 p-3 bg-blue-50 rounded-lg">
        <p className="text-xs text-blue-700">
          <strong>ヒント:</strong> 作業の全工程が含まれる動画をアップロードしてください。
          高画質・安定した撮影の動画ほど、AIによる自動分析の精度が向上します。
        </p>
      </div>
    </div>
  );
}
