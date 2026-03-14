"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Maximize2,
  Volume2,
  VolumeX,
  Camera,
  Scissors,
  ZoomIn,
} from "lucide-react";

interface VideoPlayerProps {
  videoUrl?: string;
  videoFile?: File;
  currentTime?: number;
  onTimeUpdate?: (time: number) => void;
  onCapture?: (imageDataUrl: string, timestamp: number) => void;
  markers?: { time: number; label: string; color: string }[];
}

export default function VideoPlayer({
  videoUrl: videoUrlProp,
  videoFile,
  currentTime: externalTime,
  onTimeUpdate,
  onCapture,
  markers = [],
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [fileUrl, setFileUrl] = useState<string | undefined>();

  // Create object URL from File if provided
  useEffect(() => {
    if (videoFile) {
      const url = URL.createObjectURL(videoFile);
      setFileUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [videoFile]);

  const videoUrl = videoUrlProp || fileUrl;

  useEffect(() => {
    if (externalTime !== undefined && videoRef.current) {
      videoRef.current.currentTime = externalTime;
    }
  }, [externalTime]);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      onTimeUpdate?.(videoRef.current.currentTime);
    }
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const seek = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, Math.min(time, duration));
    }
  };

  const skipForward = () => seek(currentTime + 5);
  const skipBackward = () => seek(currentTime - 5);

  const captureFrame = useCallback(() => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
        onCapture?.(dataUrl, currentTime);
      }
    }
  }, [currentTime, onCapture]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleSeekBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    seek(ratio * duration);
  };

  // Demo mode when no video URL
  const isDemoMode = !videoUrl;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="relative bg-slate-900 aspect-video">
        {isDemoMode ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
            <div className="w-24 h-24 rounded-full bg-slate-800 flex items-center justify-center mb-4">
              <Play className="w-10 h-10 text-slate-400 ml-1" />
            </div>
            <p className="text-slate-400 text-sm">動画プレビュー</p>
            <p className="text-slate-500 text-xs mt-1">円テーブル回転精度検査</p>
          </div>
        ) : (
          <video
            ref={videoRef}
            src={videoUrl}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={() => {
              if (videoRef.current) setDuration(videoRef.current.duration);
            }}
            onEnded={() => setIsPlaying(false)}
            className="w-full h-full object-contain"
          />
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Timeline with markers */}
      <div className="relative px-4 pt-3">
        <div
          className="relative h-2 bg-slate-200 rounded-full cursor-pointer group"
          onClick={handleSeekBarClick}
        >
          <div
            className="absolute h-full bg-blue-500 rounded-full"
            style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
          />
          {markers.map((marker, i) => (
            <div
              key={i}
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white cursor-pointer hover:scale-125 transition-transform"
              style={{
                left: `${duration ? (marker.time / duration) * 100 : 0}%`,
                background: marker.color,
              }}
              title={marker.label}
            />
          ))}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow border-2 border-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: `${duration ? (currentTime / duration) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={skipBackward}
            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <SkipBack className="w-4 h-4 text-slate-600" />
          </button>
          <button
            onClick={togglePlay}
            className="p-2 bg-blue-600 hover:bg-blue-700 rounded-full transition-colors"
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 text-white" />
            ) : (
              <Play className="w-5 h-5 text-white ml-0.5" />
            )}
          </button>
          <button
            onClick={skipForward}
            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <SkipForward className="w-4 h-4 text-slate-600" />
          </button>

          <span className="text-xs text-slate-500 ml-2 tabular-nums">
            {formatTime(currentTime)} / {formatTime(duration || 920)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={captureFrame}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            title="フレームキャプチャ"
          >
            <Camera className="w-4 h-4" />
            キャプチャ
          </button>

          <select
            value={playbackRate}
            onChange={(e) => {
              const rate = Number(e.target.value);
              setPlaybackRate(rate);
              if (videoRef.current) videoRef.current.playbackRate = rate;
            }}
            className="text-xs border rounded px-2 py-1 text-slate-600"
          >
            <option value={0.25}>0.25x</option>
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2x</option>
          </select>

          <button
            onClick={() => {
              setIsMuted(!isMuted);
              if (videoRef.current) videoRef.current.muted = !isMuted;
            }}
            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
          >
            {isMuted ? (
              <VolumeX className="w-4 h-4 text-slate-600" />
            ) : (
              <Volume2 className="w-4 h-4 text-slate-600" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
