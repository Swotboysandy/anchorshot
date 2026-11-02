import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import OpenAI, { toFile } from 'openai';

/**
 * Voice role behind `/api/muse/transcribe`. A provider receives recorded audio
 * and returns text; every reply passes the same check before it can become a
 * director transcript.
 */
export interface AudioClip {
  bytes: Buffer;
  mimeType: string;
}
export interface WordTiming {
  word: string;
  start: number;
  end: number;
}
export interface Transcription {
  transcript: string;
  model: string;
  provenance: 'live-model';
  timestamps: WordTiming[];
}
export interface Transcriber {
  model: string;
  transcribe(clip: AudioClip, signal?: AbortSignal): Promise<Transcription>;
}

export class TranscriberOutputError extends Error {}

export const AUDIO_TYPES: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_TRANSCRIPT = 5000;

/** Reads `data:audio/...;base64,` from the browser, or explains what is wrong. */
export function readAudioDataUrl(value: unknown): AudioClip | string {
  const match =
    typeof value === 'string' ? /^data:(audio\/[a-z0-9]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value) : null;
  if (!match || !AUDIO_TYPES[match[1]]) return 'Record WebM, Ogg, MP4, MP3 or WAV audio.';
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length) return 'The recording is empty. Try again.';
  if (bytes.length > MAX_AUDIO_BYTES) return 'The recording is too long. Keep it under 10 MB.';
  return { bytes, mimeType: match[1] };
}

function accept(model: string, text: unknown, timestamps: WordTiming[]): Transcription {
  const transcript = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (!transcript) throw new TranscriberOutputError(`${model} heard no speech. Try recording again.`);
  if (transcript.length > MAX_TRANSCRIPT)
    throw new TranscriberOutputError(`${model} returned more than ${MAX_TRANSCRIPT} characters.`);
  return { transcript, model, provenance: 'live-model', timestamps };
}

type Transcriptions = Pick<OpenAI['audio']['transcriptions'], 'create'>;

/** Any endpoint serving OpenAI-style `/audio/transcriptions` (Whisper-compatible servers). */
export function openAiTranscriber(options: { model: string; transcriptions: Transcriptions }): Transcriber {
  return {
    model: options.model,
    async transcribe({ bytes, mimeType }, signal) {
      const file = await toFile(bytes, `director.${AUDIO_TYPES[mimeType]}`, { type: mimeType });
      const reply = await options.transcriptions.create({ file, model: options.model }, { signal });
      return accept(options.model, (reply as { text?: unknown }).text, []);
    },
  };
}

/** ElevenLabs Scribe over its REST API, so no extra SDK is needed. */
export function elevenLabsTranscriber(options: {
  model: string;
  apiKey: string;
  fetch?: typeof fetch;
}): Transcriber {
  const send = options.fetch ?? fetch;
  return {
    model: options.model,
    async transcribe({ bytes, mimeType }, signal) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), `director.${AUDIO_TYPES[mimeType]}`);
      form.append('model_id', options.model);
      const res = await send('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': options.apiKey },
        body: form,
        signal,
      });
      if (!res.ok) throw new Error(`ElevenLabs transcription failed with status ${res.status}.`);
      const data = (await res.json()) as { text?: unknown; words?: Array<Record<string, unknown>> };
      const timestamps = (data.words ?? [])
        .filter((w) => w.type === 'word' && typeof w.text === 'string')
        .map((w) => ({ word: String(w.text), start: Number(w.start) || 0, end: Number(w.end) || 0 }));
      return accept(options.model, data.text, timestamps);
    },
  };
}

/** Meta's batch route only takes WAV, while browsers record WebM or Ogg. */
async function toWav(clip: AudioClip): Promise<Buffer> {
  const folder = mkdtempSync(path.join(tmpdir(), 'anchorshot-voice-'));
  try {
    const input = path.join(folder, `in.${AUDIO_TYPES[clip.mimeType]}`);
    const output = path.join(folder, 'out.wav');
    writeFileSync(input, clip.bytes);
    await new Promise<void>((resolve, reject) =>
      execFile('ffmpeg', ['-v', 'error', '-y', '-i', input, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', output], (error) =>
        error ? reject(new TranscriberOutputError('The recording could not be converted for transcription.')) : resolve(),
      ),
    );
    return readFileSync(output);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Meta muse-voice through `POST /asr/transcribe` (multipart request JSON plus WAV audio). */
export function metaTranscriber(options: {
  apiKey: string;
  baseURL: string;
  model: string;
  fetch?: typeof fetch;
  convert?: (clip: AudioClip) => Promise<Buffer>;
}): Transcriber {
  const send = options.fetch ?? fetch;
  return {
    model: options.model,
    async transcribe(clip, signal) {
      const wav = await (options.convert ?? toWav)(clip);
      const form = new FormData();
      form.append('request', new Blob([JSON.stringify({ model: options.model, audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' })], { type: 'application/json' }));
      form.append('audio', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'director.wav');
      const res = await send(`${options.baseURL}/asr/transcribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}`, Accept: 'application/json' },
        body: form,
        signal,
      });
      if (!res.ok) throw new Error(`Meta transcription failed with status ${res.status}.`);
      return accept(options.model, ((await res.json()) as { transcript?: unknown }).transcript, []);
    },
  };
}

/**
 * TRANSCRIBE_PROVIDER=meta (META_API_KEY, optional TRANSCRIBE_MODEL), or
 * TRANSCRIBE_PROVIDER=openai-compatible (TRANSCRIBE_BASE_URL, TRANSCRIBE_API_KEY,
 * TRANSCRIBE_MODEL) or elevenlabs (ELEVENLABS_API_KEY, TRANSCRIBE_MODEL, default
 * scribe_v2). Anything else keeps the browser's own speech recognition.
 */
export function transcriberFromSettings(values: Record<string, string | undefined>): Transcriber | undefined {
  const pick = (name: string) => (process.env[name] ?? values[name] ?? '').trim();
  const provider = pick('TRANSCRIBE_PROVIDER');
  if (provider === 'meta') {
    const apiKey = pick('META_API_KEY');
    const baseURL = pick('META_API_BASE_URL') || 'https://api.meta.ai/v1';
    return apiKey ? metaTranscriber({ apiKey, baseURL, model: pick('TRANSCRIBE_MODEL') || 'muse-voice-transcribe-1.0' }) : undefined;
  }
  if (provider === 'elevenlabs') {
    const apiKey = pick('ELEVENLABS_API_KEY');
    return apiKey ? elevenLabsTranscriber({ apiKey, model: pick('TRANSCRIBE_MODEL') || 'scribe_v2' }) : undefined;
  }
  if (provider !== 'openai-compatible') return undefined;
  const [baseURL, apiKey, model] = ['TRANSCRIBE_BASE_URL', 'TRANSCRIBE_API_KEY', 'TRANSCRIBE_MODEL'].map(pick);
  if (!baseURL || !apiKey || !model) return undefined;
  const client = new OpenAI({ baseURL, apiKey, maxRetries: 0, timeout: 120_000 });
  return openAiTranscriber({ model, transcriptions: client.audio.transcriptions });
}
