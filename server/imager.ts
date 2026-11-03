import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import sharp from 'sharp';
import { checkInput, type CheckedInput } from './sam';

/**
 * Storyboard-frame role behind `/api/muse/image`. A provider only has to return
 * image bytes; every frame is normalised to PNG and must pass the same check
 * SAM input does, so whichever model drew it, the frame can be segmented and
 * traced to a source hash.
 */
export interface FrameRequest {
  prompt: string;
  targetObject: string;
  seed: number;
  /** Earlier frames (data URLs) showing the characters, for models that accept references. */
  references?: string[];
  requireReference?: boolean;
}
export interface GeneratedFrame extends CheckedInput {
  model: string;
  provenance: 'live-model';
  seed: number;
}
export interface Imager {
  model: string;
  generate(request: FrameRequest, signal?: AbortSignal, beforeRetry?: () => void): Promise<GeneratedFrame>;
}

export class ImagerOutputError extends Error {}

/** Re-encodes provider bytes as PNG and checks them as segmentation input. */
export async function acceptFrame(bytes: Buffer, targetObject: string): Promise<CheckedInput> {
  let png: Buffer;
  try {
    // Models may return more than SAM accepts; scale down rather than reject the frame.
    png = await sharp(bytes).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } catch {
    throw new ImagerOutputError('The model did not return a readable image.');
  }
  try {
    return await checkInput({
      image: `data:image/png;base64,${png.toString('base64')}`,
      concept: targetObject,
      sourceHash: createHash('sha256').update(png).digest('hex'),
    });
  } catch (error) {
    throw new ImagerOutputError(`The generated frame cannot be segmented: ${(error as Error).message}`);
  }
}

type Images = Pick<OpenAI['images'], 'generate'>;

/** Any endpoint that serves OpenAI-style `/images/generations` with base64 output. */
export function openAiImager(options: {
  model: string;
  images: Images;
  size?: string;
  /** Draws from reference images; failures fall back to plain generation. */
  edit?: (prompt: string, references: string[], signal?: AbortSignal) => Promise<string | undefined>;
}): Imager {
  return {
    model: options.model,
    async generate({ prompt, targetObject, seed, references, requireReference }, signal, beforeRetry) {
      if (references?.length && options.edit) {
        const edited = await options.edit(prompt, references, signal).catch(() => undefined);
        if (edited) {
          const frame = await acceptFrame(Buffer.from(edited, 'base64'), targetObject);
          return { ...frame, model: options.model, provenance: 'live-model', seed };
        }
      }
      if (requireReference) throw new ImagerOutputError('The image provider could not edit this reference. No plain-generation fallback was applied.');
      if (references?.length && options.edit) beforeRetry?.();
      const response = await options.images.generate(
        {
          model: options.model,
          prompt,
          n: 1,
          size: (options.size ?? '1024x576') as OpenAI.ImageGenerateParams['size'],
          response_format: 'b64_json',
        },
        { signal },
      );
      const b64 = response.data?.[0]?.b64_json;
      if (!b64) throw new ImagerOutputError(`${options.model} returned no image data.`);
      const frame = await acceptFrame(Buffer.from(b64, 'base64'), targetObject);
      return { ...frame, model: options.model, provenance: 'live-model', seed };
    },
  };
}

/**
 * IMAGE_PROVIDER=openai-compatible with IMAGE_BASE_URL, IMAGE_API_KEY,
 * IMAGE_MODEL and optional IMAGE_SIZE. Anything else means no live imager:
 * the browser keeps drawing its offline canvas frames.
 */
export function imagerFromSettings(values: Record<string, string | undefined>): Imager | undefined {
  const pick = (name: string) => (process.env[name] ?? values[name] ?? '').trim();
  if (pick('IMAGE_PROVIDER') !== 'openai-compatible') return undefined;
  const [baseURL, apiKey, model, size] = ['IMAGE_BASE_URL', 'IMAGE_API_KEY', 'IMAGE_MODEL', 'IMAGE_SIZE'].map(pick);
  if (!baseURL || !apiKey || !model) return undefined;
  const client = new OpenAI({ baseURL, apiKey, maxRetries: 0, timeout: 120_000 });
  return openAiImager({
    model,
    images: client.images,
    size: size || undefined,
    // Meta's edits route takes an images array; other providers fall back on its error.
    edit: async (prompt, references, signal) => {
      const res = await fetch(`${baseURL}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, n: 1, images: references.map((image_url) => ({ image_url })) }),
        signal,
      });
      if (!res.ok) return undefined;
      return ((await res.json()) as { data?: Array<{ b64_json?: string }> }).data?.[0]?.b64_json;
    },
  });
}
