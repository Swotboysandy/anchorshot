/**
 * Browser Speech Recognition (Web Speech API) & Local Audio Testing Gateway
 * Connects native speech-to-text to Anchorshot's Director Chair, Composer, and Voice Review Panel.
 *
 * Supported Modes:
 * 1. Native Web Speech API (`window.SpeechRecognition` / `window.webkitSpeechRecognition`)
 *    - Zero API key spend; utilizes browser-provided speech recognition (cloud ASR in Chrome/Edge, or OS dictation)
 *    - Reports network errors; simulation is an explicit user action
 * 2. Local Simulation Mode (`simulateLocalSpeech`)
 *    - Allows instant validation without requiring a physical microphone or browser permission grant
 * 3. Local Backend Gateway (`/api/muse/transcribe`)
 *    - Parakeet / Kokoro / Meta Model API format with word-level timestamps and offline fixtures
 */

import { speechService } from './speechService';

// Ambient interface definitions for Web Speech API
interface SpeechRecognitionEventLike extends Event {
  results: SpeechRecognitionResultListLike;
  resultIndex: number;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  item(index: number): SpeechRecognitionResultLike;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionResultLike {
  readonly length: number;
  item(index: number): SpeechRecognitionAlternativeLike;
  [index: number]: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

export interface SpeechRecognitionOptions {
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (errorMessage: string) => void;
  onStateChange?: (isListening: boolean) => void;
  continuous?: boolean;
  interimResults?: boolean;
  lang?: string;
}

export interface TranscriptionWordTimestamp {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

export interface TranscribeResponse {
  transcript: string;
  confidence: number;
  model: string;
  provenance: string;
  timestamps?: TranscriptionWordTimestamp[];
}

class SpeechRecognitionService {
  private recognition: SpeechRecognitionInstance | null = null;
  private isListeningState: boolean = false;
  private currentOptions: SpeechRecognitionOptions | null = null;
  private simulationTimer: ReturnType<typeof setTimeout> | null = null;
  private backendModel: string | null = null;
  private backendSession = '';
  private recorder: MediaRecorder | null = null;

  /**
   * Asks the local server whether a transcription model is connected. When one
   * is, dictation records audio and sends it there instead of the browser engine.
   */
  public async connectBackend(): Promise<string | null> {
    try {
      const health = await (await fetch('/api/health')).json();
      this.backendModel = typeof health?.transcribeModel === 'string' ? health.transcribeModel : null;
      this.backendSession = typeof health?.sessionToken === 'string' ? health.sessionToken : '';
    } catch {
      this.backendModel = null;
    }
    return this.backendModel;
  }

  private canRecordForBackend(): boolean {
    return Boolean(this.backendModel) && typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  }

  /** Records until stopListening(), then transcribes the clip with the server's model. */
  private startBackendRecording(options: SpeechRecognitionOptions): boolean {
    const model = this.backendModel!;
    this.isListeningState = true;
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      if (!this.isListeningState) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream);
      this.recorder = recorder;
      recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const clip = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        try {
          const audio = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error('The recording could not be read.'));
            reader.readAsDataURL(clip);
          });
          const res = await fetch('/api/muse/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Anchorshot-Session': this.backendSession },
            body: JSON.stringify({ audio }),
          });
          const result = await res.json().catch(() => ({}));
          if (!res.ok || typeof result.transcript !== 'string')
            throw new Error(result.error || `${model} could not transcribe the recording.`);
          options.onResult?.(result.transcript, true);
        } catch (error) {
          options.onError?.((error as Error).message);
        }
      };
      recorder.start();
      speechService.playEarcon('recordStart');
      options.onStateChange?.(true);
    }).catch(() => {
      this.isListeningState = false;
      options.onError?.('Microphone access was blocked. Allow the microphone or type the direction instead.');
      options.onStateChange?.(false);
    });
    return true;
  }

  /**
   * Check if native browser Speech Recognition is supported in the current environment.
   */
  public isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    if (this.canRecordForBackend()) return true;
    const win = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    return Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
  }

  public isListening(): boolean {
    return this.isListeningState;
  }

  /**
   * Start listening for voice dictation via Web Speech API.
   */
  public startListening(options: SpeechRecognitionOptions = {}): boolean {
    if (this.isListeningState) {
      this.stopListening();
    }

    this.currentOptions = options;

    if (this.canRecordForBackend()) return this.startBackendRecording(options);

    if (!this.isSupported()) {
      const errorMsg = 'Browser Speech Recognition is not supported in this browser. Use local voice simulation or typed input.';
      options.onError?.(errorMsg);
      options.onStateChange?.(false);
      return false;
    }

    const win = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };

    const RecognitionCtor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!RecognitionCtor) return false;

    try {
      this.recognition = new RecognitionCtor();
      this.recognition.continuous = options.continuous ?? true;
      this.recognition.interimResults = options.interimResults ?? true;
      this.recognition.lang = options.lang || 'en-US';
      this.recognition.maxAlternatives = 1;

      this.recognition.onstart = () => {
        this.isListeningState = true;
        speechService.playEarcon('recordStart');
        this.currentOptions?.onStateChange?.(true);
      };

      this.recognition.onresult = (event: SpeechRecognitionEventLike) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          if (item.isFinal) {
            finalTranscript += item[0].transcript;
          } else {
            interimTranscript += item[0].transcript;
          }
        }

        const activeText = (finalTranscript || interimTranscript).trim();
        const isFinal = Boolean(finalTranscript);

        if (activeText) {
          this.currentOptions?.onResult?.(activeText, isFinal);
        }
      };

      this.recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
        let userMessage = `Voice recognition error: ${event.error}`;
        if (event.error === 'not-allowed') {
          userMessage = 'Microphone permission was denied. Enable mic access or use local voice simulation.';
        } else if (event.error === 'no-speech') {
          userMessage = 'No speech detected. Please speak closer to your microphone.';
        } else if (event.error === 'network') {
          userMessage = 'Browser cloud voice recognition unreachable (network).';
        }
        if (event.error !== 'no-speech') {
          this.isListeningState = false;
          this.currentOptions?.onStateChange?.(false);
        }
        this.currentOptions?.onError?.(userMessage);
      };

      this.recognition.onend = () => {
        this.isListeningState = false;
        speechService.playEarcon('recordStop');
        this.currentOptions?.onStateChange?.(false);
      };

      this.recognition.start();
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to start speech recognition.';
      this.isListeningState = false;
      this.currentOptions?.onError?.(errorMsg);
      this.currentOptions?.onStateChange?.(false);
      return false;
    }
  }

  /**
   * Stop voice dictation and play the stop earcon.
   */
  public stopListening(): void {
    if (this.simulationTimer) {
      clearTimeout(this.simulationTimer);
      this.simulationTimer = null;
    }

    if (this.recorder) {
      if (this.recorder.state !== 'inactive') this.recorder.stop();
      this.recorder = null;
    }

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Safe to ignore if already stopped
      }
      this.recognition = null;
    }

    if (this.isListeningState) {
      this.isListeningState = false;
      speechService.playEarcon('recordStop');
      this.currentOptions?.onStateChange?.(false);
    }
  }

  /**
   * Toggle speech recognition state.
   */
  public toggleListening(options: SpeechRecognitionOptions = {}): boolean {
    if (this.isListeningState) {
      this.stopListening();
      return false;
    }
    return this.startListening(options);
  }

  /**
   * Local Voice Simulation Mode:
   * Simulates real-time voice streaming with word chunks and earcons.
   * Enables 100% reliable local testing and automated verification without a physical mic.
   */
  public simulateLocalSpeech(
    text: string,
    options: {
      onResult?: (transcript: string, isFinal: boolean) => void;
      onStateChange?: (isListening: boolean) => void;
      speedMs?: number;
    } = {}
  ): Promise<string> {
    if (this.isListeningState) {
      this.stopListening();
    }

    this.isListeningState = true;
    speechService.playEarcon('recordStart');
    options.onStateChange?.(true);

    const words = text.trim().split(/\s+/);
    let currentIdx = 0;
    const intervalMs = options.speedMs ?? 80;

    return new Promise((resolve) => {
      const streamNextWord = () => {
        currentIdx++;
        const currentText = words.slice(0, currentIdx).join(' ');
        const isFinal = currentIdx >= words.length;

        options.onResult?.(currentText, isFinal);

        if (isFinal) {
          this.simulationTimer = setTimeout(() => {
            this.isListeningState = false;
            speechService.playEarcon('recordStop');
            options.onStateChange?.(false);
            this.simulationTimer = null;
            resolve(text);
          }, 200);
        } else {
          this.simulationTimer = setTimeout(streamNextWord, intervalMs);
        }
      };

      this.simulationTimer = setTimeout(streamNextWord, 100);
    });
  }

  /**
   * Transcribe via Anchorshot's local backend gateway (`POST /api/muse/transcribe`).
   * Supports Parakeet / Kokoro format with word timestamps and session validation.
   */
  public async transcribeViaBackend(
    textOrAudio?: string | Blob,
    sessionToken?: string
  ): Promise<TranscribeResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (sessionToken) {
      headers['X-Anchorshot-Session'] = sessionToken;
      headers['X-Framelock-Session'] = sessionToken;
    }

    const payload = typeof textOrAudio === 'string' ? { text: textOrAudio } : {};

    const res = await fetch('/api/muse/transcribe', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`Server transcription failed with status ${res.status}`);
    }

    return (await res.json()) as TranscribeResponse;
  }
}

export const speechRecognitionService = new SpeechRecognitionService();
