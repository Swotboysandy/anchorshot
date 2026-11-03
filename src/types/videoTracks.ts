export const VIDEO_COLORS = { blue: [37,99,235], emerald: [16,185,129], amber: [245,158,11], red: [220,38,38], purple: [124,58,237], white: [226,232,240] } as const;
export type VideoColor = keyof typeof VIDEO_COLORS;
export interface VideoFrameInfo { index: number; sourceHash: string; url: string; width: number; height: number }
export interface VideoManifest { jobId: string; fingerprint: string; fps: number; frames: VideoFrameInfo[] }
export interface VideoMaskFrame {
  frameIndex: number; sourceHash: string; maskBase64: string; revision: number;
  proposalNote?: string;
  absent: boolean; reviewed: boolean; method: 'manual' | 'optical-flow';
}
export interface VideoObjectTrack { objectId: 'cup' | 'umbrella'; color: VideoColor; frames: VideoMaskFrame[] }
export interface VideoTrackPlan { sourceJobId: string; fingerprint: string; tracks: VideoObjectTrack[] }
export interface VideoCorrectionReport {
  sourceJobId: string; sourceFingerprint: string; frames: number; fps: number;
  rawChangedOutside: number; rawChangedInside: number;
  encodedOutsideMeanError: number; encodedOutsideMaxError: number;
  objects: Array<{ objectId: string; visibleFrames: number; selectedPixels: number; changedPixels: number }>;
  review: 'human-reviewed-masks'; semanticContinuity: 'unverified';
}
export interface CorrectedVideo { id: string; sourceJobId: string; videoUrl: string; imageUrl: string; report: VideoCorrectionReport }
