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
} from "lucide-react";

interface VideoUploaderProps {
  onUploadComplete: (file: File, previewUrl: string) => void;
}

export default function VideoUploader({ onUploadComplete }: VideoUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
          onUploadComplete(file, url);
        }
        setUploadProgress(Math.min(progress, 100));
      }, 200);
    },
    [onUploadComplete]
  );

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
              className="w-full max-h-96 object-contain"
            />
          </div>
        )}

        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
          <FileVideo className="w-8 h-8 text-blue-500" />
          <div className="flex-1">
            <p className="font-medium text-sm text-slate-900">{uploadedFile.name}</p>
            <p className="text-xs text-slate-500">{formatFileSize(uploadedFile.size)}</p>
          </div>
        </div>
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
