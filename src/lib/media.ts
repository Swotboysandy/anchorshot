import { MAX_EDGE, type FrameAsset, type ObjectMask } from '../types';
import { SAMPLE_MASK_SVG, SAMPLE_SVG } from './sample';

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot edit images. Try a current browser.');
  return { canvas, ctx };
}
export async function imageElement(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}
export function bytesToBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
async function assetFromUrl(
  url: string,
  name: string,
  kind: FrameAsset['kind'],
): Promise<FrameAsset> {
  const image = await imageElement(url);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale)),
    height = Math.max(1, Math.round(image.naturalHeight * scale));
  const { canvas, ctx } = makeCanvas(width, height);
  ctx.drawImage(image, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/png');
  const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return {
    id: crypto.randomUUID(),
    hash,
    name,
    kind,
    width,
    height,
    dataUrl,
    pixels: ctx.getImageData(0, 0, width, height).data,
  };
}
export function loadSample() {
  return assetFromUrl(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SAMPLE_SVG)}`,
    'Rain at the window',
    'sample',
  );
}
export async function loadUpload(file: File) {
  if (!['image/png', 'image/jpeg'].includes(file.type))
    throw new Error('Choose a PNG or JPEG image.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Choose an image smaller than 8 MB.');
  const url = URL.createObjectURL(file);
  try {
    return await assetFromUrl(url, file.name, 'upload');
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function sampleMask(asset: FrameAsset): Promise<ObjectMask> {
  if (asset.kind !== 'sample')
    throw new Error('The offline mask works only with the supplied sample illustration.');
  const { ctx } = makeCanvas(asset.width, asset.height);
  ctx.drawImage(
    await imageElement(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(SAMPLE_MASK_SVG)}`),
    0,
    0,
  );
  const bounds = { left: 450, top: 310, right: 750, bottom: 540 };
  const rasterWidth = bounds.right - bounds.left,
    rasterHeight = bounds.bottom - bounds.top;
  const pixels = ctx.getImageData(bounds.left, bounds.top, rasterWidth, rasterHeight).data;
  const binary = new Uint8Array(rasterWidth * rasterHeight);
  for (let i = 0; i < binary.length; i++) binary[i] = pixels[i * 4] >= 128 ? 1 : 0;
  return {
    id: crypto.randomUUID(),
    objectId: 'sample-cup',
    label: 'Cup',
    source: 'sample',
    sourceHash: asset.hash,
    width: asset.width,
    height: asset.height,
    bounds,
    rasterWidth,
    rasterHeight,
    rasterBase64: bytesToBase64(binary),
  };
}
export function pixelsToUrl(pixels: Uint8ClampedArray, width: number, height: number) {
  const { canvas, ctx } = makeCanvas(width, height);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  return canvas.toDataURL('image/png');
}
export function maskToUrl(mask: Uint8Array, width: number, height: number) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  mask.forEach((value, index) => {
    if (value) pixels.set([202, 250, 116, 140], index * 4);
  });
  return pixelsToUrl(pixels, width, height);
}
export function download(url: string, name: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
}
export function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  download(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
