/**
 * Dictation through an explicitly configured server transcription provider.
 * Unconfigured/offline mode never starts browser cloud speech recognition.
 * The separate voice orb can meter microphone input locally without recording.
 */
import { speechService } from './speechService';

export interface SpeechRecognitionOptions {
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (errorMessage: string) => void;
  onStateChange?: (isListening: boolean) => void;
  continuous?: boolean;
  interimResults?: boolean;
  lang?: string;
  /** Automatically stop and transcribe after the user speaks and pauses. */
  autoStopOnSilence?: boolean;
  /** Shorter silence window when listening for a quick "yes" / "repeat" confirmation. */
  quickConfirmation?: boolean;
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
  private isListeningState: boolean = false;
  private currentOptions: SpeechRecognitionOptions | null = null;
  private simulationTimer: ReturnType<typeof setTimeout> | null = null;
  private backendModel: string | null = null;
  private backendSession = '';
  private recorder: MediaRecorder | null = null;
  private recordingStream: MediaStream | null = null;
  private generation = 0;
  private transcription: AbortController | null = null;
  private finishSimulation: (() => void) | null = null;

  /**
   * Asks the local server whether a transcription model is connected. When one
   * is, dictation records audio and sends it there instead of the browser engine.
   */
  public async connectBackend(): Promise<string | null> {
    try {
      const response = await fetch('/api/health');
      if (!response.ok) throw new Error('Voice provider status unavailable.');
      const health = await response.json();
      this.backendModel = typeof health?.transcribeModel === 'string' ? health.transcribeModel : null;
      this.backendSession = typeof health?.sessionToken === 'string' ? health.sessionToken : '';
    } catch {
      this.backendModel = null;
      this.backendSession = '';
    }
    return this.backendModel;
  }

  private canRecordForBackend(): boolean {
    return Boolean(this.backendModel) && typeof MediaRecorder !== 'undefined' && typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  }

  /** Records until stopListening() or silence after speech, then transcribes the clip with the server's model. */
  private startBackendRecording(options: SpeechRecognitionOptions): boolean {
    const model = this.backendModel!;
    const generation = this.generation;
    const controller = new AbortController();
    this.transcription = controller;
    const current = () => generation === this.generation && !controller.signal.aborted;
    this.isListeningState = true;
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      if (!this.isListeningState || !current()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.recordingStream = stream;
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream);
      this.recorder = recorder;

      let vadInterval: ReturnType<typeof setInterval> | null = null;
      let audioCtx: AudioContext | null = null;
      const cleanupVad = () => {
        if (vadInterval) {
          clearInterval(vadInterval);
          vadInterval = null;
        }
        if (audioCtx) {
          void audioCtx.close().catch(() => {});
          audioCtx = null;
        }
      };

      if (options.autoStopOnSilence !== false && typeof AudioContext !== 'undefined') {
        try {
          audioCtx = new AudioContext();
          void audioCtx.resume().catch(() => {});
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 1024;
          audioCtx.createMediaStreamSource(stream).connect(analyser);
          const samples = new Float32Array(analyser.fftSize);
          const startedAt = Date.now();
          const calibrateMs = 150;
          const silenceWindowMs = options.quickConfirmation ? 950 : 1400;
          const requiredTicks = options.quickConfirmation ? 1 : 2;
          const maxTurnMs = options.quickConfirmation ? 10000 : 25000;
          let noise = 0;
          let loudTicks = 0;
          let heardSpeech = false;
          let quietSince = 0;

          vadInterval = setInterval(() => {
            if (!this.isListeningState || !current()) {
              cleanupVad();
              return;
            }
            analyser.getFloatTimeDomainData(samples);
            const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
            const elapsed = Date.now() - startedAt;
            if (elapsed < calibrateMs) {
              noise = Math.min(0.025, Math.max(noise, rms));
              return;
            }
            if (elapsed > maxTurnMs) {
              cleanupVad();
              if (this.isListeningState) this.stopListening();
              return;
            }
            if (rms > Math.max(0.022, noise * 1.8)) {
              if (++loudTicks >= requiredTicks) {
                heardSpeech = true;
              }
              quietSince = 0;
            } else if (!heardSpeech) {
              loudTicks = 0;
            } else {
              quietSince ||= Date.now();
              if (Date.now() - quietSince >= silenceWindowMs) {
                cleanupVad();
                if (this.isListeningState) this.stopListening();
              }
            }
          }, 90);
        } catch {
          cleanupVad();
        }
      }

      recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      recorder.onstop = async () => {
        cleanupVad();
        stream.getTracks().forEach((track) => track.stop());
        if (this.recordingStream === stream) this.recordingStream = null;
        if (!current()) return;
        const clip = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        try {
          const audio = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error('The recording could not be read.'));
            reader.readAsDataURL(clip);
          });
          if (!current()) return;
          const sendTranscribe = (token: string) =>
            fetch('/api/muse/transcribe', {
              method: 'POST', signal: controller.signal,
              headers: { 'Content-Type': 'application/json', 'X-Anchorshot-Session': token },
              body: JSON.stringify({ audio }),
            });
          let res = await sendTranscribe(this.backendSession);
          if (res.status === 403) {
            await this.connectBackend();
            if (!current()) return;
            res = await sendTranscribe(this.backendSession);
          }
          const result = await res.json().catch(() => ({}));
          if (!res.ok || typeof result.transcript !== 'string')
            throw new Error(result.error || `${model} could not transcribe the recording.`);
          if (current()) options.onResult?.(result.transcript, true);
        } catch (error) {
          if (current()) options.onError?.((error as Error).message);
        }
      };
      recorder.start();
      speechService.playEarcon('recordStart');
      options.onStateChange?.(true);
    }).catch(() => {
      if (!current()) return;
      this.recordingStream?.getTracks().forEach(track => track.stop());
      this.recordingStream = null;
      this.isListeningState = false;
      options.onError?.('Microphone access was blocked. Allow the microphone or type the direction instead.');
      options.onStateChange?.(false);
    });
    return true;
  }

  /** Browser recognition availability does not authorize a remote fallback. */
  public isSupported(): boolean {
    return this.canRecordForBackend();
  }

  public isListening(): boolean {
    return this.isListeningState;
  }

  public startListening(options: SpeechRecognitionOptions = {}): boolean {
    this.cancelListening();
    this.currentOptions = options;
    if (this.canRecordForBackend()) return this.startBackendRecording(options);
    options.onError?.('Transcription is not connected. Type your direction; the voice orb only visualizes sound locally.');
    options.onStateChange?.(false);
    return false;
  }

  /**
   * Stop voice dictation and play the stop earcon.
   */
  public stopListening(): void {
    if (this.simulationTimer) {
      clearTimeout(this.simulationTimer);
      this.simulationTimer = null;
      this.finishSimulation?.();
      this.finishSimulation = null;
    }

    if (this.recorder) {
      if (this.recorder.state !== 'inactive') this.recorder.stop();
      this.recorder = null;
    }

    if (this.isListeningState) {
      this.isListeningState = false;
      speechService.playEarcon('recordStop');
      this.currentOptions?.onStateChange?.(false);
    }
  }

  /** Discard pending audio/results when changing project or leaving voice chat. */
  public cancelListening(): void {
    this.generation++;
    this.transcription?.abort();
    this.transcription = null;
    this.currentOptions = null;
    this.stopListening();
    this.recordingStream?.getTracks().forEach(track => track.stop());
    this.recordingStream = null;
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
    this.cancelListening();
    this.currentOptions = options;
    this.isListeningState = true;
    speechService.playEarcon('recordStart');
    options.onStateChange?.(true);

    const words = text.trim().split(/\s+/);
    let currentIdx = 0;
    const intervalMs = options.speedMs ?? 80;

    return new Promise((resolve) => {
      this.finishSimulation = () => resolve('');
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
            this.finishSimulation = null;
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
export { SpeechRecognitionService };
