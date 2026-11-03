import {isGeneratedImage} from '../services/localGeneration';
import type { StoryboardShot } from '../types/framelock';

/** Editing story metadata never regenerates media or replaces a correction mask. */
export function updateShotDetails(shot: StoryboardShot, prompt: string, seconds: number): StoryboardShot {
  const text = prompt.trim();
  if (!text || text.length > 4000 || !Number.isFinite(seconds) || seconds < 0.5 || seconds > 15)
    throw new Error('Use a prompt of 1–4000 characters and a duration from 0.5 to 15 seconds.');
  if(shot.narrationDurationSeconds && seconds < Math.ceil((shot.narrationDurationSeconds+.4)*10)/10)
    throw new Error('Keep enough time for the narration and its 0.4-second pause, or remove the recording first.');
  const changedPrompt = text !== shot.promptDescription;
  return { ...shot, promptDescription: text, durationSeconds: seconds,
    status: changedPrompt ? 'uncertain' : shot.status,
    discrepancyMessage: changedPrompt ? undefined : shot.discrepancyMessage,
    spokenDescription: `Shot ${shot.shotNumber}, duration ${seconds} seconds. ${text}. ${changedPrompt ? 'Prompt updated; image unchanged. Continuity needs review.' : `Continuity ${shot.status}.`}` };
}

/** A take switches its whole media selection, never just the video poster. */
export function restoreShotTake(shot: StoryboardShot, revisionId: string): StoryboardShot {
  const take = shot.revisions.find(item => item.revisionId === revisionId);
  if (!take) throw new Error('This take is no longer available.');
  if (take.imageUrl === shot.currentImageUrl && take.videoUrl === shot.videoUrl) return shot;
  return { ...shot, currentImageUrl: take.imageUrl, videoUrl: take.videoUrl, generatedJobId: take.generatedJobId,
    videoMaskPlan: take.videoMaskPlan?.sourceJobId === take.generatedJobId ? take.videoMaskPlan : undefined,
    timestamp: take.sourceTime, mediaSource: take.mediaSource ?? (isGeneratedImage(take.imageUrl) ? 'generated' : undefined),
    status: 'uncertain', continuityChecks: undefined, proposedFix: undefined, pixelVerification: undefined,
    detectedObjects: undefined, discrepancyMessage: undefined,
    spokenDescription: `Shot ${shot.shotNumber}. Restored take. Continuity needs review.` };
}
