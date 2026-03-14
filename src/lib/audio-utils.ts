// Audio transcription utility using browser's Web Speech API
// Falls back gracefully if not supported

export interface TranscriptionResult {
  text: string;
  segments: Array<{
    text: string;
    timestamp: number;
  }>;
}

/**
 * Extract audio from video and transcribe using Web Speech API
 * Returns partial results as they become available via onProgress callback
 */
export async function transcribeVideoAudio(
  file: File,
  options: {
    language?: string;
    maxDuration?: number; // seconds to transcribe
    onProgress?: (text: string) => void;
  } = {}
): Promise<TranscriptionResult> {
  const { language = "ja-JP", maxDuration = 300, onProgress } = options;

  // Check if Speech Recognition is available
  const SpeechRecognition =
    (window as unknown as Record<string, unknown>).SpeechRecognition ||
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition;

  if (!SpeechRecognition) {
    return { text: "", segments: [] };
  }

  return new Promise((resolve) => {
    const videoUrl = URL.createObjectURL(file);
    const audio = document.createElement("video");
    audio.src = videoUrl;
    audio.muted = false;
    audio.volume = 1;

    // Use AudioContext to route audio to speech recognition
    const audioContext = new AudioContext();
    const source = audioContext.createMediaElementSource(audio);
    const destination = audioContext.createMediaStreamDestination();
    source.connect(destination);
    // Also connect to speakers so speech recognition can hear it
    source.connect(audioContext.destination);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new (SpeechRecognition as any)();
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    const segments: Array<{ text: string; timestamp: number }> = [];
    let fullText = "";
    let lastFinalText = "";

    recognition.onresult = (event: { resultIndex: number; results: { length: number; [index: number]: { isFinal: boolean; [index: number]: { transcript: string } } } }) => {
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          if (text && text !== lastFinalText) {
            segments.push({
              text,
              timestamp: audio.currentTime,
            });
            fullText += (fullText ? " " : "") + text;
            lastFinalText = text;
          }
        } else {
          interimText += result[0].transcript;
        }
      }

      if (onProgress) {
        onProgress(fullText + (interimText ? ` [${interimText}]` : ""));
      }
    };

    recognition.onerror = () => {
      // Silently handle errors - speech recognition is best-effort
    };

    const cleanup = () => {
      try {
        recognition.stop();
      } catch { /* ignore */ }
      audio.pause();
      audioContext.close();
      URL.revokeObjectURL(videoUrl);
      resolve({ text: fullText, segments });
    };

    // Set up timeout
    const timeout = setTimeout(cleanup, (maxDuration + 5) * 1000);

    audio.onended = () => {
      clearTimeout(timeout);
      // Wait a bit for final recognition results
      setTimeout(cleanup, 2000);
    };

    audio.onerror = () => {
      clearTimeout(timeout);
      cleanup();
    };

    // Start playback and recognition
    audio.playbackRate = 2.0; // Speed up playback for faster transcription
    audio.play().then(() => {
      recognition.start();

      // Limit duration
      if (audio.duration > maxDuration) {
        setTimeout(() => {
          audio.pause();
        }, (maxDuration / audio.playbackRate) * 1000);
      }
    }).catch(() => {
      cleanup();
    });
  });
}

/**
 * Check if speech recognition is available in the browser
 */
export function isSpeechRecognitionAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return !!(
    (window as unknown as Record<string, unknown>).SpeechRecognition ||
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition
  );
}
