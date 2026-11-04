import type {VideoCorrectionReport} from '../types/videoTracks';
import type { StoryboardShot } from '../types/framelock';
export type LocalJob = {
  id: string; kind: 'image' | 'video'; prompt: string; seed: number;
  createdAt?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled'; message: string; error?: string;
  report?: ({operation?: undefined; inferenceSeconds?: number; cudaPeakAllocatedMiB?: number; frames: number; seconds?: number; fps?: number; model?: string; provider?: string; width?: number; height?: number; encodingPSNRdB?: number} | (VideoCorrectionReport & {operation: 'reviewed-mask-correction'}));
};

export interface GenerationDescriptor {
  title: string;
  subject: string;
  framing?: string;
  setting?: string;
  cast: string[];
  identityKey: string;
}

const capitalizeFirst = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};

const truncateClean = (text: string, maxLen = 68): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  const sliced = clean.slice(0, maxLen - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  return `${(lastSpace > 24 ? sliced.slice(0, lastSpace) : sliced).replace(/[,;:.!\-]+$/, '')}…`;
};

/**
 * Extracts a human-readable descriptive title, scene subject, camera framing,
 * setting, and cast from either a structured SHOT/IDENTITY LOCK prompt or a freeform prompt.
 */
export function describeGenerationPrompt(rawPrompt: string, kind: 'image' | 'video' = 'video'): GenerationDescriptor {
  const prompt = (rawPrompt ?? '').trim();
  if (!prompt) {
    return {
      title: kind === 'video' ? 'Generated video scene' : 'Generated scene frame',
      subject: kind === 'video' ? 'Generated video scene' : 'Generated scene frame',
      cast: [],
      identityKey: '',
    };
  }

  // Extract cast names from IDENTITY LOCK block if present
  const identityMatch = /IDENTITY LOCK\s*\n([\s\S]*?)(?:\n\s*\n|\nSHOT\b|$)/i.exec(prompt);
  const identityBlock = identityMatch?.[1]?.trim() ?? '';
  const cast = identityBlock
    ? identityBlock
        .split('\n')
        .map((line) => /^([A-Z][A-Z0-9 _'-]{1,30}):/.exec(line.trim())?.[1]?.trim())
        .filter((name): name is string => Boolean(name))
        .map((name) =>
          name
            .toLowerCase()
            .replace(/\b\w/g, (ch) => ch.toUpperCase())
        )
    : [];

  // Extract SHOT block if present
  const shotMatch = /\bSHOT\s*\n([^\n]+)/i.exec(prompt);
  if (shotMatch) {
    const shotLine = shotMatch[1].trim();
    // Format from buildShotPrompt: "<Framing>, <movement> camera, <angle> angle. <Subject>. Set in <setting>. <Lighting>."
    const cameraPrefixMatch = /^([^.,]+),\s*[^.]+?\s+angle\.\s*(.+)$/i.exec(shotLine);
    const framingRaw = cameraPrefixMatch ? cameraPrefixMatch[1].trim() : undefined;
    const remainder = cameraPrefixMatch ? cameraPrefixMatch[2].trim() : shotLine;

    const setInSplit = remainder.split(/\.\s+Set in\s+/i);
    const beforeSetIn = setInSplit[0]?.trim() ?? remainder;
    const settingPart = setInSplit[1]?.split(/\.\s+/)[0]?.replace(/\.$/, '').trim();

    let subject = beforeSetIn.split(/\.\s+/)[0]?.replace(/\.$/, '').trim() || beforeSetIn;
    // Strip redundant framing words from the start of subject if repeated (e.g. "Medium shot of the courier..." -> "The courier...")
    const strippedSubject = subject.replace(
      /^(?:establishing\s+shot|wide\s+shot|medium\s+shot|close-up\s+shot|close-up|extreme\s+close-up)\s+(?:of\s+|showing\s+|—\s*|-+\s*)?/i,
      ''
    );
    if (strippedSubject.trim().length >= 4) {
      subject = strippedSubject.trim();
    }

    const cleanSubject = truncateClean(capitalizeFirst(subject), 58);
    const cleanFraming = framingRaw ? capitalizeFirst(framingRaw) : undefined;
    const title = cleanFraming ? `${cleanSubject} — ${cleanFraming}` : cleanSubject;

    return {
      title,
      subject: cleanSubject,
      framing: cleanFraming,
      setting: settingPart ? capitalizeFirst(settingPart) : undefined,
      cast,
      identityKey: identityBlock || cleanSubject.toLowerCase(),
    };
  }

  // Freeform prompt fallback
  const firstLine = prompt
    .split(/\n+/)[0]
    .replace(/^(?:scene\s*\d*\s*[:\-–—]\s*|shot\s*\d*\s*[:\-–—]\s*)/i, '')
    .trim();
  const firstClause = firstLine.split(/\.\s+/)[0]?.replace(/\.$/, '').trim() || firstLine;
  const cleanSubject = truncateClean(capitalizeFirst(firstClause), 64);

  return {
    title: cleanSubject || (kind === 'video' ? 'Generated video scene' : 'Generated scene frame'),
    subject: cleanSubject || (kind === 'video' ? 'Generated video scene' : 'Generated scene frame'),
    cast,
    identityKey: cleanSubject.toLowerCase(),
  };
}

/**
 * Formats an ISO timestamp or epoch milliseconds into a readable creation date and time.
 */
export function formatGenerationTimestamp(input?: string | number): string {
  if (input === undefined || input === null || input === '') return 'Saved in this studio';
  const date = typeof input === 'number' ? new Date(input) : new Date(input);
  if (Number.isNaN(date.getTime())) return 'Saved in this studio';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
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
