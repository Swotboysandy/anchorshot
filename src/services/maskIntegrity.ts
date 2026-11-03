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
  before: Uint8ClampedArray, mask: Uint8Array, rgb: readonly number[], options: {allowUnchanged?: boolean} = {},
): { pixels: Uint8ClampedArray; verification: MaskVerificationReport } {
  validate(before, before, mask);
  if (rgb.length !== 3 || rgb.some(value => !Number.isInteger(value) || value < 0 || value > 255))
    throw new Error('Invalid target colour.');
  const pixels = before.slice();
  const neutralTarget = Math.max(...rgb) - Math.min(...rgb) < 40;
  for (let pixel = 0; pixel < mask.length; pixel++) {
    if (!mask[pixel]) continue;
    const i = pixel * 4;
    if (!before[i + 3]) continue;
    const r = before[i], g = before[i + 1], b = before[i + 2];
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    // A reviewed selection includes white and neutral material too. Retain alpha,
    // black detail and relative shading; saturation is not an editability test.
    if (luminance <= 0.04) continue;
    const factor = neutralTarget ? 0.7 + luminance * 0.3 : 0.35 + luminance;
    for (let channel = 0; channel < 3; channel++)
      pixels[i + channel] = Math.min(255, Math.round(rgb[channel] * factor));
  }

  const verification = verifyMaskedPixelDiff(before, pixels, mask);
  if (!verification.passed) throw new Error('Mask verification failed. No correction was applied.');
  if (!verification.changedInside && !options.allowUnchanged) throw new Error('No editable pixels changed inside the mask. The shot was not marked corrected.');
  return { pixels, verification };
}

// Masked colour detection ported from BZcreativ's feat/claude-sam-meta (detectMaskedColor).
// Adapted: pixels vote by hue instead of matching average RGB, which misread dark blue as
// green under film lighting; an empty mask reports no colour; confidence is the winning share.

export interface DetectedMaskColor {
  colorName: string | null;
  rgb: [number, number, number] | null;
  pixelCount: number;
  confidence: number;
}

/** Hue ranges in degrees; hue survives low film lighting where RGB distance does not. Teal film grades push dark greens towards 180. */
const hueColour = (hue: number): string =>
  hue < 15 || hue >= 340 ? 'red' : hue < 70 ? 'amber' : hue < 182 ? 'emerald' : hue < 200 ? 'cyan' : hue < 255 ? 'blue' : 'purple';

/**
 * Averages the pixels inside a binary mask, ignoring glare and deep shadow, and
 * names the closest rule colour.
 */
export function detectMaskedColor(pixels: Uint8ClampedArray, mask: Uint8Array): DetectedMaskColor {
  validate(pixels, pixels, mask);
  const votes = new Map<string, number>();
  let totalR = 0, totalG = 0, totalB = 0, count = 0;
  for (let pixel = 0; pixel < mask.length; pixel++) {
    if (!mask[pixel]) continue;
    const i = pixel * 4;
    if (pixels[i + 3] < 30) continue;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (lum <= 0.04 || lum >= 0.94) continue;
    const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
    const saturation = max ? delta / max : 0;
    let colour: string | null;
    if (saturation < 0.2) colour = lum > 0.6 ? 'white' : null;
    else {
      const sector = max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
      colour = hueColour(sector * 60);
    }
    if (!colour) continue;
    votes.set(colour, (votes.get(colour) ?? 0) + 1);
    totalR += r;
    totalG += g;
    totalB += b;
    count++;
  }
  if (!count) return { colorName: null, rgb: null, pixelCount: 0, confidence: 0 };
  const [colorName, best] = [...votes.entries()].sort((x, y) => y[1] - x[1])[0];
  return {
    colorName,
    rgb: [Math.round(totalR / count), Math.round(totalG / count), Math.round(totalB / count)],
    pixelCount: count,
    confidence: Math.min(0.99, Number((best / count).toFixed(3))),
  };
}


/** Rule synonyms collapse to the colour categories actually measured by this checker. */
export function normalizeContinuityColor(value: string): string | null {
  const aliases: Record<string,string> = {blue:'blue',navy:'blue',cobalt:'blue',azure:'blue',cyan:'cyan',teal:'cyan',
    red:'red',crimson:'red',scarlet:'red',ruby:'red',amber:'amber',gold:'amber',yellow:'amber',orange:'amber',
    emerald:'emerald',green:'emerald',lime:'emerald',purple:'purple',violet:'purple',magenta:'purple',white:'white',ivory:'white'};
  return aliases[value.trim().toLowerCase()] ?? null;
}
