import { H, W } from './render';
import type { SceneImage } from './timeline';

export async function importSceneImage(file: File): Promise<SceneImage> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Choose a JPEG, PNG or WebP image.');
  if (!file.size || file.size > 8 * 1024 * 1024)
    throw new Error('Choose an image smaller than 8 MB.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This image could not be opened. Try another JPEG, PNG or WebP.');
  }
  try {
    if (bitmap.width * bitmap.height > 24000000)
      throw new Error('Choose an image with at most 24 million pixels.');
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image rendering is unavailable.');
    ctx.fillStyle = '#151e1c';
    ctx.fillRect(0, 0, W, H);
    // Contain the full image; no hidden crop of a personal photograph.
    const scale = Math.min(W / bitmap.width, H / bitmap.height);
    const width = bitmap.width * scale,
      height = bitmap.height * scale;
    ctx.drawImage(bitmap, (W - width) / 2, (H - height) / 2, width, height);
    const data = canvas.toDataURL('image/jpeg', 0.85);
    if (data.length > 1500000)
      throw new Error('This image is too complex to save locally. Try a smaller image.');
    return { name: file.name.slice(0, 200), data };
  } finally {
    bitmap.close();
  }
}

export async function imageSurface(image: SceneImage): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.src = image.data;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image rendering is unavailable.');
  ctx.drawImage(img, 0, 0, W, H);
  return canvas;
}
