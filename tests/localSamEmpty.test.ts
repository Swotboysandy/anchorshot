import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { segmentLocalSam } from '../server/sam';

const frame = async (background: string) => {
  const png = await sharp({ create: { width: 64, height: 64, channels: 4, background } }).png().toBuffer();
  return { image: `data:image/png;base64,${png.toString('base64')}`, concept: 'cup', sourceHash: 'h', width: 64, height: 64 };
};

describe('segmentLocalSam', () => {
  it('returns no objects instead of a central box when nothing matches', async () => {
    // Near-black frame: every pixel is rejected by the classifier.
    const result = await segmentLocalSam(await frame('#050505'), '', new AbortController().signal);
    expect(result.objects).toEqual([]);
    expect(result.ambiguityStatus).toBe('uncertain');
    expect(result.evidence).toContain('found 0 candidate masks');
  });

  it('rejects amber skin tone when searching for a cup', async () => {
    // Amber/skin-tone background (#c88a50): hue ~30° (amber)
    const result = await segmentLocalSam(await frame('#c88a50'), '', new AbortController().signal);
    expect(result.objects).toEqual([]);
    expect(result.ambiguityStatus).toBe('uncertain');
    expect(result.evidence).toContain('found 0 candidate masks');
  });
});
