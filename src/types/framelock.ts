import type { MaskVerificationReport } from '../services/maskIntegrity';

export type RuleStatus = 'consistent' | 'mismatch' | 'uncertain';

export interface ContinuityRule {
  id: string;
  scope: 'all_shots' | 'single_shot';
  targetObject: string; // e.g. "cup"
  property: string;     // e.g. "color"
  expectedValue: string; // e.g. "blue"
  revision: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SamMask {
  /** How many matches SAM returned before the best was picked. */
  candidateCount?: number;
  id: string;
  maskRef: string; // Versioned SAM 3.1 mask reference, e.g. "sam-3.1:cup-shot-2:v1"
  objectId: string;
  maskBase64: string; // Binary/RLE mask canvas data
  box: BoundingBox;
  confidence: number;
  provenance?: 'offline-fixture' | 'live-sam-3.1';
}

export interface PixelVerificationReport extends MaskVerificationReport {
  maskRef: string;
  ruleRevision: number;
  totalPixels: number;
  selectedMaskPixels: number;
  changedInsideMask: number;
  changedOutsideMask: number;
  outsideDriftPercent: number;
  verifiedAt: number;
}

export interface StoryboardShot {
  id: string;
  shotNumber: number;
  durationSeconds: number;
  /** Planned camera move (see shotLanguage MOVEMENTS). */
  movement?: string;
  /** Rule objects the plan leaves out of this shot, so their rules do not apply here. */
  absentProps?: string[];
  timestamp?: number;
  promptDescription: string;
  spokenDescription: string;
  currentImageUrl: string;
  originalImageUrl: string;
  status: RuleStatus;
  videoUrl?: string;
  generatedJobId?: string;
  detectedObjects?: Array<{
    id: string;
    maskRef: string;
    objectId: string;
    label: string;
    concept: string;
    confidence: number;
    width?: number;
    height?: number;
    bounds: { left: number; top: number; right: number; bottom: number };
    rasterWidth: number;
    rasterHeight: number;
    rasterBase64: string;
  }>;
  discrepancyMessage?: string;
  pixelVerification?: PixelVerificationReport;
  proposedFix?: {
    action: 'recolor' | 'replace';
    targetObject: string;
    targetColor: string;
    mask?: SamMask;
    candidates?: SamMask[];
  };
  revisions: Array<{
    revisionId: string;
    timestamp: number;
    imageUrl: string;
    actionApplied: string;
    ruleRevision?: number;
    maskRef?: string;
    pixelVerification?: PixelVerificationReport;
  }>;
}

export interface ContinuityFinding {
  shotIndex: number;
  status: RuleStatus;
  ruleId: string;
  targetObject: string;
  expectedValue: string;
  observedValue?: string;
  maskRef?: string;
  objectId?: string;
  confidence: number;
  explanation: string;
  proposedAction: 'recolor';
}

export interface ProjectState {
  projectId: string;
  title: string;
  transcript: string;
  isRecording: boolean;
  rules: ContinuityRule[];
  shots: StoryboardShot[];
  activeShotId: string | null;
  isPlayingAnimatic: boolean;
  isProcessing: boolean;
  statusAnnouncement: string; // for screen readers (aria-live)
}

export type MetaModelName =
  | 'muse-voice-transcribe-1.0'
  | 'muse-spark-1.3'
  | 'muse-image-1.0'
  | 'sam-3.1';

export interface ModelInvocationRecord {
  id: string;
  model: MetaModelName;
  operation: string;
  timestamp: number;
  summary: string;
  provenance?: 'offline-fixture' | 'live-meta-api';
}

export interface DirectorPresetScenario {
  id: string;
  title: string;
  genre: string;
  transcript: string;
  description: string;
}
