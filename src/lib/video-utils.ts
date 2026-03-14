// Video frame extraction utility
// Extracts frames from a video file using HTML5 Canvas

export interface ExtractedFrame {
  timestamp: number;
  dataUrl: string; // base64 JPEG
}

/**
 * Extract frames from a video file at regular intervals
 */
export async function extractFramesFromVideo(
  file: File,
  options: {
    maxFrames?: number;
    frameInterval?: number; // seconds between frames
    maxWidth?: number;
    quality?: number; // JPEG quality 0-1
  } = {}
): Promise<ExtractedFrame[]> {
  const {
    maxFrames = 10,
    frameInterval,
    maxWidth = 1024,
    quality = 0.7,
  } = options;

  const videoUrl = URL.createObjectURL(file);

  try {
    const video = document.createElement("video");
    video.src = videoUrl;
    video.muted = true;
    video.preload = "auto";

    // Wait for video metadata
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("動画の読み込みに失敗しました"));
    });

    const duration = video.duration;
    if (!duration || !isFinite(duration)) {
      throw new Error("動画の長さを取得できませんでした");
    }

    // Calculate frame timestamps
    const interval = frameInterval || duration / (maxFrames + 1);
    const timestamps: number[] = [];
    for (let t = interval; t < duration && timestamps.length < maxFrames; t += interval) {
      timestamps.push(t);
    }

    // Ensure we have at least the first frame
    if (timestamps.length === 0) {
      timestamps.push(Math.min(1, duration / 2));
    }

    // Create canvas for frame capture
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    const frames: ExtractedFrame[] = [];

    for (const timestamp of timestamps) {
      const frame = await captureFrame(video, canvas, ctx, timestamp, maxWidth, quality);
      frames.push(frame);
    }

    return frames;
  } finally {
    URL.revokeObjectURL(videoUrl);
  }
}

function captureFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  timestamp: number,
  maxWidth: number,
  quality: number
): Promise<ExtractedFrame> {
  return new Promise((resolve, reject) => {
    video.currentTime = timestamp;

    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);

      // Calculate dimensions maintaining aspect ratio
      let width = video.videoWidth;
      let height = video.videoHeight;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(video, 0, 0, width, height);

      const dataUrl = canvas.toDataURL("image/jpeg", quality);

      resolve({
        timestamp,
        dataUrl,
      });
    };

    video.addEventListener("seeked", onSeeked);
    setTimeout(() => {
      video.removeEventListener("seeked", onSeeked);
      reject(new Error(`フレーム取得タイムアウト: ${timestamp}秒`));
    }, 10000);
  });
}

/**
 * Get video metadata
 */
export async function getVideoMetadata(
  file: File
): Promise<{ duration: number; width: number; height: number }> {
  const videoUrl = URL.createObjectURL(file);

  try {
    const video = document.createElement("video");
    video.src = videoUrl;
    video.preload = "auto";

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("動画の読み込みに失敗しました"));
    });

    return {
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } finally {
    URL.revokeObjectURL(videoUrl);
  }
}
