export type LocalJob = {
  id: string; kind: 'image' | 'video'; prompt: string; seed: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled'; message: string; error?: string;
  report?: {inferenceSeconds: number; cudaPeakAllocatedMiB: number; frames: number; width: number; height: number; encodingPSNRdB?: number};
};
export async function localRequest<T>(route: string, body?: unknown, timeoutMs = 10000): Promise<T> {
  const response = await fetch(`/api/local-ai${route}`, body === undefined ? {signal: AbortSignal.timeout(timeoutMs)} : {
    signal: AbortSignal.timeout(timeoutMs),
    method: 'POST', headers: {'Content-Type': 'application/json', 'X-Anchorshot-Local': '1'}, body: JSON.stringify(body),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Local generation service unavailable. Start the app with npm run dev.');
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Local request failed.');
  return value;
}
export const localAsset = (job: LocalJob | {id: string}, name: string) => `/api/local-ai/jobs/${job.id}/assets/${name}`;
export const isLocalImage = (url: string) => url.startsWith('/api/local-ai/jobs/');
export const isLocalVideo = (url: string) => url.startsWith('/api/local-ai/jobs/') && url.endsWith('.mp4');

/** Any model-drawn frame (local GPU or a connected image model): no sample masks apply. */
export const isGeneratedImage = (url: string) => isLocalImage(url) || url.startsWith('/api/muse/frames/');

export async function detectLocalObjects(jobId: string) {
  return localRequest<any[]>(`/jobs/${jobId}/detect-objects`, {}, 30000);
}

export async function modifyLocalVideo(jobId: string, objectId: string, color: string) {
  return localRequest<{action: string; targetObjectId: string; color: string; framesModified: number; totalPixelsRecolored: number; outsideDrift: number; verified: boolean}>(
    `/jobs/${jobId}/modify`,
    {objectId, color},
    60000
  );
}
