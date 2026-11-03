export const MAX_EDGE = 1600;
export const MAX_PIXELS = MAX_EDGE * MAX_EDGE;

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface ObjectMask {
  id: string;
  maskRef?: string;
  objectId: string;
  label: string;
  source: 'sample' | 'sam';
  sourceHash: string;
  width: number;
  height: number;
  bounds: Bounds;
  rasterWidth: number;
  rasterHeight: number;
  rasterBase64: string;
  confidence?: number;
}
export interface FrameAsset {
  id: string;
  hash: string;
  name: string;
  kind: 'sample' | 'upload';
  width: number;
  height: number;
  dataUrl: string;
  pixels: Uint8ClampedArray;
}
export interface PixelReport {
  selected: number;
  changedInside: number;
  changedOutside: number;
}
export interface Correction {
  id: string;
  sourceHash: string;
  selectionId: string;
  color: string;
  dataUrl: string;
  report: PixelReport;
}
export interface ServiceStatus {
  configured: boolean;
  model: string;
  sessionToken: string;
  requestsUsed: number;
  requestLimit: number;
}
export type ContinuityEvidenceStatus = 'consistent' | 'mismatch' | 'uncertain';

export interface SamCheckEvidence {
  status: ContinuityEvidenceStatus;
  maskRef: string | null;
  selectedObjectId: string | null;
  candidateCount: number;
  confidence: number;
  expectedValue?: string;
  observedValue?: string;
  explanation: string;
  isAmbiguous: boolean;
}

export interface StoredMaskTrack {
  segmentationId?: string;
  maskRef: string;
  concept: string;
  shotNumber: number;
  revision: number;
  objectId: string;
  bounds: Bounds;
  confidence: number;
  sourceHash: string;
  status: ContinuityEvidenceStatus;
  evidence: string;
  provenance?: 'live-sam-3.1' | 'offline-fixture';
  createdAt: number;
}

export interface SegmentationResult {
  requestId: string;
  sourceHash: string;
  objects: ObjectMask[];
  maskRef?: string;
  selectedObjectId?: string | null;
  ambiguityStatus?: ContinuityEvidenceStatus;
  evidence?: string;
  provenance?: 'live-sam-3.1' | 'offline-fixture';
}
