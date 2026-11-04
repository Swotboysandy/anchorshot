/**
 * Canonical Meta hackathon model identifiers and OpenRouter upstream routing.
 * Keeps `VITE_MUSE_VOICE_MODEL`, `VITE_MUSE_SPARK_MODEL`, `VITE_MUSE_IMAGE_MODEL`,
 * and `VITE_SAM3_MODEL` consistent across server routes, OpenRouter adapters, and UI logs.
 */

export interface CanonicalMetaModels {
  voice: string;
  spark: string;
  image: string;
  sam: string;
}

export const DEFAULT_META_MODELS: CanonicalMetaModels = {
  voice: 'muse-voice-transcribe-1.0',
  spark: 'muse-spark-1.3',
  image: 'muse-image-1.0',
  sam: 'sam-3.1',
};

export function getCanonicalMetaModels(
  values: Record<string, string | undefined> = process.env,
): CanonicalMetaModels {
  const pick = (name: string, fallback: string) =>
    (process.env[name] ?? values[name] ?? fallback).trim() || fallback;
  return {
    voice: pick('VITE_MUSE_VOICE_MODEL', DEFAULT_META_MODELS.voice),
    spark: pick('VITE_MUSE_SPARK_MODEL', DEFAULT_META_MODELS.spark),
    image: pick('VITE_MUSE_IMAGE_MODEL', DEFAULT_META_MODELS.image),
    sam: pick('VITE_SAM3_MODEL', DEFAULT_META_MODELS.sam),
  };
}

/**
 * When an OpenAI-compatible provider points at OpenRouter (`openrouter.ai`) and is
 * configured with a canonical Meta model alias (such as `muse-spark-1.3`), map the
 * upstream OpenRouter API request to a valid OpenRouter Meta Llama model slug while
 * preserving the configured canonical model identifier in application responses.
 */
export function resolveUpstreamChatModel(
  baseURL: string,
  configuredModel: string,
  values: Record<string, string | undefined> = process.env,
): string {
  const canonical = getCanonicalMetaModels(values);
  if (
    /openrouter\.ai/i.test(baseURL) &&
    (configuredModel === canonical.spark || configuredModel === DEFAULT_META_MODELS.spark)
  ) {
    const override = (
      process.env.OPENROUTER_SPARK_MODEL ??
      values.OPENROUTER_SPARK_MODEL ??
      ''
    ).trim();
    return override || 'meta-llama/llama-3.3-70b-instruct';
  }
  return configuredModel;
}
