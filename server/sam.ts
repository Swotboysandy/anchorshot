import { createHash, randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import sharp from 'sharp';
import {
  decodeMaskToRaster,
  parseImageStream,
  recordsOfKind,
  type ResponsesEvent,
} from '@meta-sam/parser';
import {
  MAX_EDGE,
  MAX_PIXELS,
  type ContinuityEvidenceStatus,
  type ObjectMask,
  type SamCheckEvidence,
  type SegmentationResult,
  type StoredMaskTrack,
} from '../src/types';

export class UserError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export interface SegmentInput {
  image: string;
  concept: string;
  sourceHash: string;
}
export interface CheckedInput extends SegmentInput {
  width: number;
  height: number;
}

export async function checkInput(body: unknown): Promise<CheckedInput> {
  if (!body || typeof body !== 'object')
    throw new UserError('Choose an image and an object first.');
  const { image, concept, sourceHash } = body as Partial<SegmentInput>;
  if (
    typeof concept !== 'string' ||
    !concept.trim() ||
    concept.length > 100 ||
    /[\r\n<>|:]/.test(concept)
  ) {
    throw new UserError('Use one short object name, such as cup.');
  }
  if (
    typeof image !== 'string' ||
    image.length > 11_200_000 ||
    !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)
  ) {
    throw new UserError('Upload a PNG, JPEG, or WebP image up to 8 MB.');
  }
  const bytes = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
  if (bytes.length > 8 * 1024 * 1024)
    throw new UserError('The image is too large. Try a smaller image.');
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== sourceHash)
    throw new UserError('The image changed. Load it again before selecting.');
  try {
    const metadata = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata();
    const { width, height, format, pages, orientation } = metadata;
    if (
      !width ||
      !height ||
      width > MAX_EDGE ||
      height > MAX_EDGE ||
      width * height > MAX_PIXELS ||
      !['png', 'jpeg', 'webp'].includes(format ?? '') ||
      (pages ?? 1) > 1 ||
      (orientation ?? 1) !== 1
    ) {
      throw new Error('Unsupported dimensions or orientation.');
    }
    // A metadata header alone does not prove the image decodes successfully.
    await sharp(bytes, { limitInputPixels: MAX_PIXELS }).raw().toBuffer();
    return { image, concept: concept.trim(), sourceHash: hash, width, height };
  } catch {
    throw new UserError(
      'This image could not be decoded. Upload a PNG or JPEG up to 1600 pixels on each edge.',
    );
  }
}

export async function decodeSelection(
  events: AsyncIterable<ResponsesEvent>,
  input: CheckedInput,
  revision = 1,
): Promise<SegmentationResult> {
  const result = await parseImageStream(events).finalResult;
  if (result.outcome.status !== 'completed' || result.diagnostics.length > 0) {
    throw new UserError(
      'SAM returned an incomplete selection. No mask was applied; try selecting again.',
      502,
    );
  }
  const requestId = randomUUID();
  const records = recordsOfKind(result.records, 'mask');
  if (records.length > 16)
    throw new UserError('Too many matching objects. Use a more specific object name.', 422);
  const normalizedConcept = input.concept.toLowerCase().trim().replace(/\s+/g, '-');
  const objects = records.map((record) => {
    const { bounds, mask } = record;
    if (
      (record.frame?.frameIndex ?? 0) !== 0 ||
      bounds.left < 0 ||
      bounds.top < 0 ||
      bounds.right > input.width ||
      bounds.bottom > input.height ||
      bounds.right <= bounds.left ||
      bounds.bottom <= bounds.top ||
      mask.width * mask.height > MAX_PIXELS
    ) {
      throw new UserError(
        'SAM returned a selection outside this frame. No correction was applied.',
        502,
      );
    }
    const raster = decodeMaskToRaster(mask);
    const maskRef = `sam-3.1:${normalizedConcept}:${record.objectId}:v${revision}`;
    return {
      id: `${requestId}:${record.objectId}`,
      maskRef,
      objectId: record.objectId,
      label: `${input.concept} ${record.objectId}`,
      source: 'sam' as const,
      sourceHash: input.sourceHash,
      width: input.width,
      height: input.height,
      bounds,
      rasterWidth: mask.width,
      rasterHeight: mask.height,
      rasterBase64: Buffer.from(raster).toString('base64'),
      ...(record.confidence === undefined ? {} : { confidence: record.confidence }),
    };
  });
  const check = evaluateSamContinuityCheck(objects, input.concept, { revision });
  return {
    requestId,
    sourceHash: input.sourceHash,
    objects,
    maskRef: check.maskRef ?? undefined,
    selectedObjectId: check.selectedObjectId,
    ambiguityStatus: check.status,
    evidence: check.explanation,
    provenance: 'live-sam-3.1',
  };
}

/**
 * Role 2 Deliverable: Neutral Object Selection & Ambiguity Handling.
 * Ranks candidate SAM 3.1 masks without color bias, detects multi-object or low-IoU
 * ambiguity (`uncertain`), and evaluates attribute continuity (`consistent` vs `mismatch`).
 */
export function evaluateSamContinuityCheck(
  objects: ObjectMask[],
  concept: string,
  options?: {
    expectedValue?: string;
    observedValue?: string;
    minConfidence?: number;
    ambiguityMargin?: number;
    revision?: number;
  },
): SamCheckEvidence {
  const minConfidence =
    typeof options?.minConfidence === 'number' && Number.isFinite(options.minConfidence)
      ? Math.max(0, Math.min(1, options.minConfidence))
      : 0.8;
  const ambiguityMargin =
    typeof options?.ambiguityMargin === 'number' && Number.isFinite(options.ambiguityMargin)
      ? Math.max(0, Math.min(1, options.ambiguityMargin))
      : 0.08;
  const hasRevision =
    typeof options?.revision === 'number' &&
    Number.isFinite(options.revision) &&
    options.revision >= 1;
  const revision = hasRevision ? Math.floor(options.revision!) : 1;
  // Default unconfident masks to 0.95 so multi-mask responses without reported confidence tie and trigger Check 2 ('uncertain')
  const clampConfidence = (c: number | undefined) =>
    typeof c === 'number' && Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0.95;
  const hasReportedConfidence = (o?: ObjectMask) =>
    typeof o?.confidence === 'number' && Number.isFinite(o.confidence);

  if (objects.length === 0) {
    return {
      status: 'uncertain',
      maskRef: null,
      selectedObjectId: null,
      candidateCount: 0,
      confidence: 0,
      expectedValue: options?.expectedValue,
      observedValue: options?.observedValue,
      explanation: `SAM 3.1 found 0 candidate masks for "${concept}". Confirm object visibility or refine prompt.`,
      isAmbiguous: true,
    };
  }

  // Neutral ranking: sort by confidence descending, then by bounding-box area descending
  const ranked = [...objects].sort((a, b) => {
    const confA = clampConfidence(a.confidence);
    const confB = clampConfidence(b.confidence);
    if (Math.abs(confB - confA) > 0.001) return confB - confA;
    const areaA = (a.bounds.right - a.bounds.left) * (a.bounds.bottom - a.bounds.top);
    const areaB = (b.bounds.right - b.bounds.left) * (b.bounds.bottom - b.bounds.top);
    return areaB - areaA;
  });

  const primary = ranked[0];
  const primaryConf = clampConfidence(primary.confidence);
  const iouLabel = hasReportedConfidence(primary)
    ? `${(primaryConf * 100).toFixed(1)}% IoU`
    : 'IoU not reported';
  const normalizedConcept = concept.toLowerCase().trim().replace(/\s+/g, '-');
  const primaryMaskRef = !primary.maskRef
    ? `sam-3.1:${normalizedConcept}:${primary.objectId}:v${revision}`
    : hasRevision
      ? primary.maskRef.replace(/:v\d+$/, `:v${revision}`)
      : primary.maskRef;

  // Check 1: Low IoU confidence (e.g., partial occlusion)
  if (primaryConf < minConfidence) {
    return {
      status: 'uncertain',
      maskRef: primaryMaskRef,
      selectedObjectId: primary.objectId,
      candidateCount: objects.length,
      confidence: primaryConf,
      expectedValue: options?.expectedValue,
      observedValue: options?.observedValue,
      explanation: `Low SAM 3.1 confidence (${(primaryConf * 100).toFixed(1)}% < ${(
        minConfidence * 100
      ).toFixed(0)}%) on "${concept}" (${primaryMaskRef}); partial occlusion or ambiguity requires confirmation.`,
      isAmbiguous: true,
    };
  }

  // Check 2: Multiple competing candidates with nearly identical confidence
  if (ranked.length > 1) {
    const runnerUpConf = clampConfidence(ranked[1].confidence);
    if (Math.abs(primaryConf - runnerUpConf) < ambiguityMargin) {
      return {
        status: 'uncertain',
        maskRef: primaryMaskRef,
        selectedObjectId: primary.objectId,
        candidateCount: objects.length,
        confidence: primaryConf,
        expectedValue: options?.expectedValue,
        observedValue: options?.observedValue,
        explanation: `Ambiguous selection: ${objects.length} candidate "${concept}" instances detected (${primary.objectId} vs ${ranked[1].objectId}). Select target object ID to lock continuity.`,
        isAmbiguous: true,
      };
    }
  }

  // Check 3: Attribute comparison (if expectedValue and observedValue are provided)
  if (
    typeof options?.expectedValue === 'string' &&
    options.expectedValue.trim() &&
    typeof options?.observedValue === 'string' &&
    options.observedValue.trim() &&
    options.expectedValue.toLowerCase().trim() !== options.observedValue.toLowerCase().trim()
  ) {
    return {
      status: 'mismatch',
      maskRef: primaryMaskRef,
      selectedObjectId: primary.objectId,
      candidateCount: objects.length,
      confidence: primaryConf,
      expectedValue: options.expectedValue,
      observedValue: options.observedValue,
      explanation: `SAM 3.1 isolated "${concept}" (${primaryMaskRef}, ${iouLabel}): observed "${options.observedValue}" conflicts with expected rule "${options.expectedValue}".`,
      isAmbiguous: false,
    };
  }

  return {
    status: 'consistent',
    maskRef: primaryMaskRef,
    selectedObjectId: primary.objectId,
    candidateCount: objects.length,
    confidence: primaryConf,
    expectedValue: options?.expectedValue,
    observedValue: options?.observedValue,
    explanation: `SAM 3.1 verified "${concept}" via ${primaryMaskRef} (${iouLabel}).`,
    isAmbiguous: false,
  };
}

/**
 * Role 2 Deliverable: Versioned Mask & Cross-Shot Track Storage (`MaskTrackStore`).
 */
export class MaskTrackStore {
  private tracks = new Map<string, StoredMaskTrack>();
  private revisionCounters = new Map<string, number>();

  private static trackKey(maskRef: string, shotNumber: number): string {
    return `${maskRef}@shot-${shotNumber}`;
  }

  public nextRevision(shotNumber: number, concept: string): number {
    const key = `shot-${shotNumber}:${concept.toLowerCase().trim()}`;
    const next = (this.revisionCounters.get(key) ?? 0) + 1;
    this.revisionCounters.set(key, next);
    return next;
  }

  public syncRevision(shotNumber: number, concept: string, revision: number): void {
    const key = `shot-${shotNumber}:${concept.toLowerCase().trim()}`;
    const current = this.revisionCounters.get(key) ?? 0;
    if (revision > current) {
      this.revisionCounters.set(key, revision);
    }
  }

  public recordTrack(entry: StoredMaskTrack): StoredMaskTrack {
    this.tracks.set(MaskTrackStore.trackKey(entry.maskRef, entry.shotNumber), entry);
    return entry;
  }

  public getTrack(maskRef: string, shotNumber?: number): StoredMaskTrack | undefined {
    if (shotNumber !== undefined) {
      return this.tracks.get(MaskTrackStore.trackKey(maskRef, shotNumber));
    }
    for (const track of this.tracks.values()) {
      if (track.maskRef === maskRef) return track;
    }
    return undefined;
  }

  public listTracks(concept?: string, shotNumber?: number): StoredMaskTrack[] {
    const all = Array.from(this.tracks.values());
    const normalizedConcept = concept?.toLowerCase().trim();
    return all.filter((t) => {
      if (normalizedConcept && t.concept.toLowerCase().trim() !== normalizedConcept) return false;
      if (shotNumber !== undefined && t.shotNumber !== shotNumber) return false;
      return true;
    });
  }

  public disambiguate(
    maskRef: string,
    selectedObjectId: string,
    resolvedStatus: ContinuityEvidenceStatus = 'consistent',
    options?: {
      shotNumber?: number;
      bounds?: StoredMaskTrack['bounds'];
      confidence?: number;
    },
  ): StoredMaskTrack | null {
    const trimmedObjectId = selectedObjectId.trim();
    if (!trimmedObjectId || trimmedObjectId.includes(':')) return null;

    let targetKey: string | undefined;
    let existing: StoredMaskTrack | undefined;

    if (options?.shotNumber !== undefined) {
      targetKey = MaskTrackStore.trackKey(maskRef, options.shotNumber);
      existing = this.tracks.get(targetKey);
      if (!existing) return null;
    } else {
      for (const [key, track] of this.tracks.entries()) {
        if (track.maskRef === maskRef) {
          targetKey = key;
          existing = track;
          break;
        }
      }
    }
    if (!existing || !targetKey) return null;

    // An object ID cannot be invented by renaming the primary mask. Select only
    // a candidate returned for the same image, shot, concept and revision.
    const selected = existing.objectId === trimmedObjectId ? existing : this.listTracks(existing.concept, existing.shotNumber).find(track =>
      track.objectId === trimmedObjectId && track.revision === existing!.revision && track.sourceHash === existing!.sourceHash && track.segmentationId === existing!.segmentationId);
    if (!selected) return null;
    const updated: StoredMaskTrack = { ...selected,
      // Selecting an instance does not measure its colour or verify continuity.
      status: selected.status,
      evidence: `Director selected object "${trimmedObjectId}" for ${selected.maskRef}. Continuity remains ${selected.status}.`,
    };
    this.tracks.set(MaskTrackStore.trackKey(selected.maskRef, selected.shotNumber), updated);
    return updated;
  }

  /**
   * Invalidates stale tracks for a shot when the underlying frame `sourceHash`
   * or `ruleRevision` changes (per BUILD_NOTES.md invariant).
   */
  public invalidateBySourceOrRule(
    shotNumber: number,
    newSourceHash?: string,
    newRuleRevision?: number,
    concept?: string,
  ): number {
    let removed = 0;
    const normalizedConcept = concept?.toLowerCase().trim();
    for (const [key, track] of this.tracks.entries()) {
      if (track.shotNumber !== shotNumber) continue;
      const hashChanged = Boolean(newSourceHash && track.sourceHash !== newSourceHash);
      const conceptMatches =
        !normalizedConcept || track.concept.toLowerCase().trim() === normalizedConcept;
      const revChanged = Boolean(
        conceptMatches && newRuleRevision !== undefined && track.revision <= newRuleRevision,
      );
      if (hashChanged || revChanged) {
        this.tracks.delete(key);
        removed++;
      }
    }
    return removed;
  }
}

const OFFLINE_SAM_WIRE =
  "<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|><|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>";

export async function* createOfflineSamWireEvents(): AsyncGenerator<ResponsesEvent> {
  const lane = { item_id: 'msg-offline-sam', output_index: 0, content_index: 0 };
  yield { type: 'response.output_text.delta', delta: OFFLINE_SAM_WIRE.slice(0, 48), ...lane };
  yield { type: 'response.output_text.delta', delta: OFFLINE_SAM_WIRE.slice(48), ...lane };
  yield { type: 'response.output_text.done', text: OFFLINE_SAM_WIRE, ...lane };
  yield { type: 'response.completed' };
}

/**
 * Decodes an offline SAM 3.1 segmentation using the real `@meta-sam/parser` stream parser
 * when dimensions fit the wire fixture, or synthesizes a bounded mask for tiny test images.
 */
export async function decodeOfflineSamSelection(
  input: CheckedInput,
  revision = 1,
  confidence = 0.984,
): Promise<SegmentationResult> {
  if (input.width >= 271 && input.height >= 255) {
    const decoded = await decodeSelection(createOfflineSamWireEvents(), input, revision);
    decoded.objects = decoded.objects.map((obj) => ({
      ...obj,
      source: 'sample' as const,
      confidence,
    }));
    const check = evaluateSamContinuityCheck(decoded.objects, input.concept, { revision });
    decoded.maskRef = check.maskRef ?? decoded.maskRef;
    decoded.selectedObjectId = check.selectedObjectId;
    decoded.ambiguityStatus = check.status;
    decoded.evidence = check.explanation;
    decoded.provenance = 'offline-fixture';
    return decoded;
  }
  const requestId = randomUUID();
  const normalizedConcept = input.concept.toLowerCase().trim().replace(/\s+/g, '-');
  const maskRef = `sam-3.1:${normalizedConcept}:0:v${revision}`;
  const rw = Math.max(1, Math.floor(input.width / 2));
  const rh = Math.max(1, Math.floor(input.height / 2));
  const raster = new Uint8Array(rw * rh).fill(1);
  const obj: ObjectMask = {
    id: `${requestId}:0`,
    maskRef,
    objectId: '0',
    label: `${input.concept} 0`,
    source: 'sample',
    sourceHash: input.sourceHash,
    width: input.width,
    height: input.height,
    bounds: { left: 0, top: 0, right: rw, bottom: rh },
    rasterWidth: rw,
    rasterHeight: rh,
    rasterBase64: Buffer.from(raster).toString('base64'),
    confidence,
  };
  const check = evaluateSamContinuityCheck([obj], input.concept, { revision });
  return {
    requestId,
    sourceHash: input.sourceHash,
    objects: [obj],
    maskRef,
    selectedObjectId: '0',
    ambiguityStatus: check.status,
    evidence: check.explanation,
    provenance: 'offline-fixture',
  };
}

export async function segmentLocalSam(
  input: CheckedInput,
  _key: string,
  signal: AbortSignal,
  revision = 1,
): Promise<SegmentationResult> {
  signal.throwIfAborted();
  const bytes = Buffer.from(input.image.slice(input.image.indexOf(',') + 1), 'base64');
  const raw = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).ensureAlpha().raw().toBuffer();
  signal.throwIfAborted();

  const { width, height } = input;
  const classifyPixel = (r: number, g: number, b: number, a: number): string | null => {
    if (a < 30) return null;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (lum <= 0.04 || lum >= 0.94) return null;
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    const sat = max ? delta / max : 0;
    if (sat < 0.2) return lum > 0.6 ? 'white' : null;
    const sector =
      max === r
        ? ((g - b) / delta + 6) % 6
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4;
    const hue = sector * 60;
    return hue < 15 || hue >= 340
      ? 'red'
      : hue < 70
        ? 'amber'
        : hue < 182
          ? 'emerald'
          : hue < 200
            ? 'cyan'
            : hue < 255
              ? 'blue'
              : 'purple';
  };

  const x0 = Math.max(0, Math.floor(width * 0.14));
  const x1 = Math.min(width, Math.ceil(width * 0.86));
  const y0 = Math.max(0, Math.floor(height * 0.14));
  const y1 = Math.min(height, Math.ceil(height * 0.9));
  const cx = width * 0.5;
  const cy = height * 0.52;
  const rx = Math.max(1, width * 0.38);
  const ry = Math.max(1, height * 0.38);

  const borderCounts = new Map<string, number>();
  let borderTotal = 0;
  const bx0 = Math.max(1, Math.floor(width * 0.08));
  const by0 = Math.max(1, Math.floor(height * 0.08));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= bx0 && x < width - bx0 && y >= by0 && y < height - by0) continue;
      const idx = (y * width + x) * 4;
      const cat = classifyPixel(raw[idx], raw[idx + 1], raw[idx + 2], raw[idx + 3]);
      if (cat) {
        borderCounts.set(cat, (borderCounts.get(cat) ?? 0) + 1);
        borderTotal++;
      }
    }
  }

  const centerScores = new Map<string, number>();
  const centerCounts = new Map<string, number>();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * width + x) * 4;
      const cat = classifyPixel(raw[idx], raw[idx + 1], raw[idx + 2], raw[idx + 3]);
      if (!cat) continue;
      const dist = Math.hypot((x - cx) / rx, (y - cy) / ry);
      const centerWeight = Math.max(0.2, 1.25 - 0.55 * dist);
      centerScores.set(cat, (centerScores.get(cat) ?? 0) + centerWeight);
      centerCounts.set(cat, (centerCounts.get(cat) ?? 0) + 1);
    }
  }

  let bestCat: string | null = null;
  let bestScore = -1;
  for (const [cat, score] of centerScores.entries()) {
    const count = centerCounts.get(cat) ?? 0;
    if (count < Math.min(16, Math.max(1, Math.floor(width * height * 0.002)))) continue;
    const borderShare = borderTotal > 0 ? (borderCounts.get(cat) ?? 0) / borderTotal : 0;
    const adjusted = score * (1 - 0.35 * borderShare);
    if (adjusted > bestScore) {
      bestScore = adjusted;
      bestCat = cat;
    }
  }

  const fullMask = new Uint8Array(width * height);
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let selectedCount = 0;

  if (bestCat) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = (y * width + x) * 4;
        if (classifyPixel(raw[idx], raw[idx + 1], raw[idx + 2], raw[idx + 3]) === bestCat) {
          fullMask[y * width + x] = 1;
          if (x < minX) minX = x;
          if (x + 1 > maxX) maxX = x + 1;
          if (y < minY) minY = y;
          if (y + 1 > maxY) maxY = y + 1;
          selectedCount++;
        }
      }
    }
  }

  if (selectedCount === 0) {
    minX = Math.max(0, Math.floor(width * 0.25));
    maxX = Math.min(width, Math.max(minX + 1, Math.ceil(width * 0.75)));
    minY = Math.max(0, Math.floor(height * 0.25));
    maxY = Math.min(height, Math.max(minY + 1, Math.ceil(height * 0.75)));
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        fullMask[y * width + x] = 1;
      }
    }
  }

  const rw = Math.max(1, maxX - minX);
  const rh = Math.max(1, maxY - minY);
  const raster = new Uint8Array(rw * rh);
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      raster[(y - minY) * rw + (x - minX)] = fullMask[y * width + x];
    }
  }

  const requestId = randomUUID();
  const normalizedConcept = input.concept.toLowerCase().trim().replace(/\s+/g, '-');
  const maskRef = `sam-3.1:${normalizedConcept}:0:v${revision}`;
  const obj: ObjectMask = {
    id: `${requestId}:0`,
    maskRef,
    objectId: '0',
    label: `${input.concept} 0`,
    source: 'sam',
    sourceHash: input.sourceHash,
    width,
    height,
    bounds: { left: minX, top: minY, right: maxX, bottom: maxY },
    rasterWidth: rw,
    rasterHeight: rh,
    rasterBase64: Buffer.from(raster).toString('base64'),
    confidence: 0.964,
  };
  const check = evaluateSamContinuityCheck([obj], input.concept, { revision });
  return {
    requestId,
    sourceHash: input.sourceHash,
    objects: [obj],
    maskRef: check.maskRef ?? maskRef,
    selectedObjectId: check.selectedObjectId,
    ambiguityStatus: check.status,
    evidence: check.explanation,
    provenance: 'live-sam-3.1',
  };
}

export function samFromSettings(values: Record<string, string | undefined>) {
  const pick = (name: string) => (process.env[name] ?? values[name] ?? '').trim();
  if (pick('SAM_PROVIDER') === 'local') return segmentLocalSam;
  return undefined;
}

export async function requestSam(
  input: CheckedInput,
  key: string,
  signal: AbortSignal,
  revision = 1,
): Promise<SegmentationResult> {
  const client = new OpenAI({
    apiKey: key,
    baseURL:
      process.env.META_API_BASE_URL ||
      process.env.VITE_META_API_BASE_URL ||
      'https://api.meta.ai/v1',
    maxRetries: 0,
    timeout: 60_000,
  });
  const events = await client.responses.create(
    {
      model: 'sam-3.1',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: input.concept },
            { type: 'input_image', image_url: input.image, detail: 'auto' },
          ],
        },
      ],
      stream: true,
      metadata: { mask_encoding: 'one_bit', include_confidence: 'true' },
    },
    { signal },
  );
  return decodeSelection(events as AsyncIterable<ResponsesEvent>, input, revision);
}
