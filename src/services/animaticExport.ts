import type { StoryboardShot } from '../types/framelock';

export const toDataUrl = async (url: string): Promise<string> => {
  // Canvas frames are already data URLs; the page CSP does not allow fetching data: URLs.
  if (url.startsWith('data:')) return url;
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('A frame could not be read.'));
    reader.readAsDataURL(blob);
  });
};

/**
 * Asks the local server to encode the storyboard as an MP4. Returns null when the server cannot export,
 * so the caller can fall back to the browser's silent WebM recorder.
 */
export async function exportAnimaticMp4(
  shots: StoryboardShot[],
  options?: { burnInTimecode?: boolean },
): Promise<{ video: Blob } | null> {
  try {
    const health = await (await fetch('/api/health')).json();
    const res = await fetch('/api/export/animatic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Anchorshot-Session': String(health?.sessionToken ?? '') },
      body: JSON.stringify({
        burnInTimecode: Boolean(options?.burnInTimecode),
        shots: await Promise.all(
          shots.map(async (shot) => ({
            image: await toDataUrl(shot.currentImageUrl),
            seconds: shot.durationSeconds,
            movement: shot.movement,
          })),
        ),
      }),
    });
    if (!res.ok || !res.headers.get('content-type')?.startsWith('video/mp4')) return null;
    return { video: await res.blob() };
  } catch {
    return null;
  }
}
