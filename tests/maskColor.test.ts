import { describe, expect, it } from 'vitest';
import { detectMaskedColor } from '../src/services/maskIntegrity';

// Cases adapted from BZcreativ's tests/samFrameAudit.test.ts on feat/claude-sam-meta.
const width = 20;
const mask = new Uint8Array(width * width);
for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) mask[y * width + x] = 1;

const frame = (inside: [number, number, number], outside: [number, number, number] = [10, 10, 10]) => {
  const pixels = new Uint8ClampedArray(mask.length * 4);
  mask.forEach((m, p) => pixels.set([...(m ? inside : outside), 255], p * 4));
  return pixels;
};

describe('colour inside a SAM mask', () => {
  it('names blue, red and amber objects from their pixels only', () => {
    const blue = detectMaskedColor(frame([30, 80, 220], [220, 35, 35]), mask);
    expect(blue).toMatchObject({ colorName: 'blue', pixelCount: 100 });
    expect(blue.confidence).toBeGreaterThan(0.7);
    expect(detectMaskedColor(frame([220, 35, 35]), mask).colorName).toBe('red');
    expect(detectMaskedColor(frame([225, 125, 10]), mask).colorName).toBe('amber');
  });

  it('keeps cyan distinct and maps shades to rule colours', () => {
    expect(detectMaskedColor(frame([8, 145, 178]), mask).colorName).toBe('cyan');
    expect(detectMaskedColor(frame([5, 150, 105]), mask).colorName).toBe('emerald');
  });

  it('reads dark film-lit colours by hue', () => {
    expect(detectMaskedColor(frame([22, 34, 70]), mask).colorName).toBe('blue');
    expect(detectMaskedColor(frame([60, 18, 20]), mask).colorName).toBe('red');
  });

  it('reports no colour when the mask only covers glare or shadow', () => {
    expect(detectMaskedColor(frame([255, 255, 255]), mask)).toEqual({ colorName: null, rgb: null, pixelCount: 0, confidence: 0 });
    expect(detectMaskedColor(frame([5, 5, 5]), mask).colorName).toBeNull();
  });
});
