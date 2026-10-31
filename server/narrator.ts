import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Narration role behind `/api/muse/speak`: text in, MP3 out. Spoken sentences
 * repeat constantly (shot descriptions, alerts), so every clip is cached on disk
 * by model, voice and text, and only new text spends credits.
 */
export interface Narrator {
  model: string;
  voice: string;
  speak(text: string, signal?: AbortSignal): Promise<Buffer>;
}

export class NarratorOutputError extends Error {}

export const MAX_NARRATION_TEXT = 1000;

/** ElevenLabs text-to-speech over REST with a premade voice. */
export function elevenLabsNarrator(options: {
  apiKey: string;
  voice: string;
  model: string;
  fetch?: typeof fetch;
}): Narrator {
  const send = options.fetch ?? fetch;
  return {
    model: options.model,
    voice: options.voice,
    async speak(text, signal) {
      const res = await send(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(options.voice)}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: { 'xi-api-key': options.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
          body: JSON.stringify({ text, model_id: options.model }),
          signal,
        },
      );
      if (!res.ok) throw new Error(`ElevenLabs narration failed with status ${res.status}.`);
      const audio = Buffer.from(await res.arrayBuffer());
      if (!res.headers.get('content-type')?.startsWith('audio/') || !audio.length)
        throw new NarratorOutputError(`${options.model} returned no audio.`);
      return audio;
    },
  };
}

/** Wraps a narrator so identical text is read from disk instead of the provider. */
export function cachedNarrator(narrator: Narrator, folder: string) {
  mkdirSync(folder, { recursive: true });
  const fileFor = (text: string) =>
    path.join(
      folder,
      `${createHash('sha256').update(`${narrator.model}\n${narrator.voice}\n${text}`).digest('hex')}.mp3`,
    );
  return {
    model: narrator.model,
    voice: narrator.voice,
    cached: (text: string) => existsSync(fileFor(text)),
    async speak(text: string, signal?: AbortSignal) {
      const file = fileFor(text);
      if (existsSync(file)) return readFileSync(file);
      const audio = await narrator.speak(text, signal);
      writeFileSync(file, audio);
      return audio;
    },
  };
}
export type CachedNarrator = ReturnType<typeof cachedNarrator>;

/**
 * NARRATION_PROVIDER=elevenlabs with ELEVENLABS_API_KEY; NARRATION_VOICE_ID and
 * NARRATION_MODEL default to a premade voice and the low-cost Flash model.
 * Anything else keeps the browser's own voice.
 */
export function narratorFromSettings(
  values: Record<string, string | undefined>,
  cacheFolder: string,
): CachedNarrator | undefined {
  const pick = (name: string) => (process.env[name] ?? values[name] ?? '').trim();
  const apiKey = pick('ELEVENLABS_API_KEY');
  if (pick('NARRATION_PROVIDER') !== 'elevenlabs' || !apiKey) return undefined;
  return cachedNarrator(
    elevenLabsNarrator({
      apiKey,
      voice: pick('NARRATION_VOICE_ID') || 'JBFqnCBsd6RMkjVDRZzb',
      model: pick('NARRATION_MODEL') || 'eleven_flash_v2_5',
    }),
    cacheFolder,
  );
}
