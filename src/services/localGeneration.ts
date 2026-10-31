export type LocalJob = {
  id: string; kind: 'image' | 'video'; prompt: string; seed: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled'; message: string; error?: string;
  report?: {inferenceSeconds: number; cudaPeakAllocatedMiB: number; frames: number; width: number; height: number; encodingPSNRdB?: number};
};
export async function localRequest<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/local-ai${route}`, body === undefined ? {signal: AbortSignal.timeout(10000)} : {
    signal: AbortSignal.timeout(10000),
    method: 'POST', headers: {'Content-Type': 'application/json', 'X-Anchorshot-Local': '1'}, body: JSON.stringify(body),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Local generation service unavailable. Start the app with npm run dev.');
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Local request failed.');
  return value;
}
export const localAsset = (job: LocalJob, name: string) => `/api/local-ai/jobs/${job.id}/assets/${name}`;
export const isLocalImage = (url: string) => url.startsWith('/api/local-ai/jobs/');
/** Any model-drawn frame (local GPU or a connected image model): no sample masks apply. */
export const isGeneratedImage = (url: string) => isLocalImage(url) || url.startsWith('/api/muse/frames/');
