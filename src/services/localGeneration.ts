import type {VideoCorrectionReport} from '../types/videoTracks';
import type { StoryboardShot } from '../types/framelock';
export type LocalJob = {
  id: string; kind: 'image' | 'video'; prompt: string; seed: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled'; message: string; error?: string;
  report?: ({operation?: undefined; inferenceSeconds?: number; cudaPeakAllocatedMiB?: number; frames: number; width?: number; height?: number; encodingPSNRdB?: number} | (VideoCorrectionReport & {operation: 'reviewed-mask-correction'}));
};
export async function localRequest<T>(route: string, body?: unknown, timeoutMs = 10000, signal?: AbortSignal): Promise<T> {
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const response = await fetch(`/api/local-ai${route}`, body === undefined ? {signal: requestSignal} : {
    signal: requestSignal,
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

/** Recoloured data URLs still belong to generated media; never apply sample masks to them. */
export const isGeneratedShot = (shot: StoryboardShot) => shot.mediaSource === 'generated' || Boolean(shot.generatedJobId) || isGeneratedImage(shot.currentImageUrl) || isGeneratedImage(shot.originalImageUrl) || shot.revisions.some(revision => isGeneratedImage(revision.imageUrl));

export const localMeasurementsAsset = (job: LocalJob) => localAsset(job, job.report?.operation === 'reviewed-mask-correction' ? 'modification-report.json' : 'inference-report.json');
