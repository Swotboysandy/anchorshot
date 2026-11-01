import { MAX_PIXELS, type ObjectMask, type PixelReport } from '../types';

export function expandMask(mask: ObjectMask): Uint8Array {
  const { width, height, bounds: b, rasterWidth: rw, rasterHeight: rh } = mask;
  const dimensions = [width, height, rw, rh, b.left, b.top, b.right, b.bottom];
  if (
    !dimensions.every(Number.isSafeInteger) ||
    width < 1 ||
    height < 1 ||
    width * height > MAX_PIXELS ||
    rw < 1 ||
    rh < 1 ||
    rw * rh > MAX_PIXELS ||
    b.left < 0 ||
    b.top < 0 ||
    b.right > width ||
    b.bottom > height ||
    b.right <= b.left ||
    b.bottom <= b.top
  ) {
    throw new Error('The selection does not fit this frame. Select the object again.');
  }
  const raster = Uint8Array.from(atob(mask.rasterBase64), (c) => c.charCodeAt(0));
  if (raster.length !== rw * rh || raster.some((value) => value !== 0 && value !== 1)) {
    throw new Error('The selection mask is invalid. No correction was applied.');
  }
  const full = new Uint8Array(width * height);
  for (let y = b.top; y < b.bottom; y++) {
    for (let x = b.left; x < b.right; x++) {
      const mx = Math.floor(((x - b.left) * rw) / (b.right - b.left));
      const my = Math.floor(((y - b.top) * rh) / (b.bottom - b.top));
      full[y * width + x] = raster[my * rw + mx];
    }
  }
  return full;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  const light = (max + min) / 2;
  if (delta === 0) return [0, 0, light];
  const saturation = delta / (1 - Math.abs(2 * light - 1));
  const hue =
    max === r
      ? (g - b) / delta + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return [hue / 6, saturation, light];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [channel(0), channel(8), channel(4)];
}

export function comparePixels(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  mask: Uint8Array,
): PixelReport {
  if (before.length !== after.length || before.length !== mask.length * 4)
    throw new Error('Frame sizes differ.');
  const report: PixelReport = { selected: 0, changedInside: 0, changedOutside: 0 };
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4;
    if (mask[p]) report.selected++;
    if (
      before[i] !== after[i] ||
      before[i + 1] !== after[i + 1] ||
      before[i + 2] !== after[i + 2] ||
      before[i + 3] !== after[i + 3]
    ) {
      if (mask[p]) report.changedInside++;
      else report.changedOutside++;
    }
  }
  return report;
}

export function recolor(source: Uint8ClampedArray, mask: Uint8Array, color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color))
    throw new Error('Choose a six-digit hex colour, such as #4169d8.');
  if (source.length !== mask.length * 4)
    throw new Error('The selection belongs to a different frame.');
  if (!mask.some(Boolean)) throw new Error('The selection is empty. Choose a visible object.');
  const rgb = [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
  const [h, s] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const output = source.slice();
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    const [, , lightness] = rgbToHsl(source[i], source[i + 1], source[i + 2]);
    const corrected = hslToRgb(h, s, lightness);
    output[i] = corrected[0];
    output[i + 1] = corrected[1];
    output[i + 2] = corrected[2];
  }
  return { pixels: output, report: comparePixels(source, output, mask) };
}
