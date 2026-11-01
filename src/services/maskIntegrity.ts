export interface MaskVerificationReport {
  selectedPixels: number;
  changedInside: number;
  changedOutside: number;
  passed: boolean;
}

function validate(before: Uint8ClampedArray, after: Uint8ClampedArray, mask: Uint8Array) {
  if (!mask.length || before.length !== after.length || before.length !== mask.length * 4)
    throw new Error('Frame and mask dimensions must match.');
  if (mask.some(value => value !== 0 && value !== 1))
    throw new Error('The correction mask must be binary.');
}

export function verifyMaskedPixelDiff(
  before: Uint8ClampedArray, after: Uint8ClampedArray, mask: Uint8Array,
): MaskVerificationReport {
  validate(before, after, mask);
  let selectedPixels = 0, changedInside = 0, changedOutside = 0;
  for (let pixel = 0; pixel < mask.length; pixel++) {
    if (mask[pixel]) selectedPixels++;
    const index = pixel * 4;
    const changed = before[index] !== after[index] || before[index + 1] !== after[index + 1]
      || before[index + 2] !== after[index + 2] || before[index + 3] !== after[index + 3];
    if (changed) {
      if (mask[pixel]) changedInside++;
      else changedOutside++;
    }
  }
  return { selectedPixels, changedInside, changedOutside, passed: selectedPixels > 0 && changedOutside === 0 };
}

export function recolorMaskedPixels(
  before: Uint8ClampedArray, mask: Uint8Array, rgb: readonly number[],
): { pixels: Uint8ClampedArray; verification: MaskVerificationReport } {
  validate(before, before, mask);
  if (rgb.length !== 3 || rgb.some(value => !Number.isInteger(value) || value < 0 || value > 255))
    throw new Error('Invalid target colour.');
  const pixels = before.slice();
  for (let pixel = 0; pixel < mask.length; pixel++) {
    if (!mask[pixel]) continue;
    const i = pixel * 4;
    if (!before[i + 3]) continue;
    const r = before[i], g = before[i + 1], b = before[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (saturation > 0.22 && luminance > 0.12 && luminance < 0.92) {
      const factor = Math.min(1.35, Math.max(0.45, luminance * 1.45));
      for (let channel = 0; channel < 3; channel++)
        pixels[i + channel] = Math.min(255, Math.round(rgb[channel] * factor));
    }
  }
  const verification = verifyMaskedPixelDiff(before, pixels, mask);
  if (!verification.passed) throw new Error('Mask verification failed. No correction was applied.');
  if (!verification.changedInside) throw new Error('No editable pixels changed inside the mask. The shot was not marked corrected.');
  return { pixels, verification };
}

// Masked colour detection ported from BZcreativ's feat/claude-sam-meta (detectMaskedColor).
// Adapted: cyan stays its own rule colour, an empty mask reports no colour instead of a
// default, and confidence is not floored, so a weak match is never presented as certain.

export interface DetectedMaskColor {
  colorName: string | null;
  rgb: [number, number, number] | null;
  pixelCount: number;
  confidence: number;
}

const COLOR_REFERENCES: Array<{ name: string; rgb: [number, number, number] }> = [
  { name: 'blue', rgb: [37, 99, 235] },
  { name: 'cobalt', rgb: [29, 78, 216] },
  { name: 'cyan', rgb: [8, 145, 178] },
  { name: 'red', rgb: [220, 38, 38] },
  { name: 'crimson', rgb: [225, 29, 72] },
  { name: 'amber', rgb: [217, 119, 6] },
  { name: 'yellow', rgb: [234, 179, 8] },
  { name: 'gold', rgb: [202, 138, 4] },
  { name: 'emerald', rgb: [16, 185, 129] },
  { name: 'green', rgb: [5, 150, 105] },
  { name: 'white', rgb: [226, 232, 240] },
  { name: 'purple', rgb: [124, 58, 237] },
];

/** Same colour families the planner's continuity rules use. */
const RULE_COLOUR: Record<string, string> = { cobalt: 'blue', crimson: 'red', yellow: 'amber', gold: 'amber', green: 'emerald' };

/**
 * Averages the pixels inside a binary mask, ignoring glare and deep shadow, and
 * names the closest rule colour.
 */
export function detectMaskedColor(pixels: Uint8ClampedArray, mask: Uint8Array): DetectedMaskColor {
  validate(pixels, pixels, mask);
  let totalR = 0, totalG = 0, totalB = 0, count = 0;
  for (let pixel = 0; pixel < mask.length; pixel++) {
    if (!mask[pixel]) continue;
    const i = pixel * 4;
    if (pixels[i + 3] < 30) continue;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (lum > 0.08 && lum < 0.94) {
      totalR += r;
      totalG += g;
      totalB += b;
      count++;
    }
  }
  if (!count) return { colorName: null, rgb: null, pixelCount: 0, confidence: 0 };

  const rgb: [number, number, number] = [Math.round(totalR / count), Math.round(totalG / count), Math.round(totalB / count)];
  let best = COLOR_REFERENCES[0];
  let minDistance = Infinity;
  for (const ref of COLOR_REFERENCES) {
    const dr = rgb[0] - ref.rgb[0], dg = rgb[1] - ref.rgb[1], db = rgb[2] - ref.rgb[2];
    const distance = Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
    if (distance < minDistance) {
      minDistance = distance;
      best = ref;
    }
  }
  return {
    colorName: RULE_COLOUR[best.name] ?? best.name,
    rgb,
    pixelCount: count,
    confidence: Math.max(0, Math.min(0.99, Number((1 - minDistance / 440).toFixed(3)))),
  };
}
