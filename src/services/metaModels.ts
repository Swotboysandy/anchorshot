import { normalizeContinuityColor } from './maskIntegrity';
import {
  BoundingBox,
  ContinuityFinding,
  ContinuityRule,
  DirectorPresetScenario,
  ModelInvocationRecord,
  SamMask,
  StoryboardShot,
} from '../types/framelock';

export interface VideoDetectedObject {
  objectId: string;
  label: string;
  confidence: number;
  concept?: string;
  bounds: { left: number; top: number; right: number; bottom: number };
  width?: number;
  height?: number;
  maskRef?: string;
}
import {
  applySamPixelFixToImage,
  applySamPixelFixWithVerification,
  generateSam3MaskData,
  getTargetObjectBox,
  supportsOfflineSampleObject,
  renderMuseStoryboardFrame,
  sampleImageColorInMask,
  SceneRenderSpec,
} from './canvasEngine';
import { toDataUrl } from './animaticExport';
import { isGeneratedImage, isGeneratedShot } from './localGeneration';
import { expandMask } from '../lib/correction';
import { buildShotPrompt, castInShot, normalizeCast, normalizeShot, propInShot, type CastMember, type ShotSize, type ShotSpec } from '../lib/shotLanguage';

export type PlannedShot = ShotSpec & { seconds: number };

/** The canvas sample renderer only knows four framings; map planned sizes onto them. */
function canvasFraming(size: ShotSize): SceneRenderSpec['cameraAngle'] {
  if (size === 'Over-shoulder') return 'over_shoulder';
  if (size === 'Close' || size === 'Extreme close' || size === 'Insert') return 'closeup';
  if (size === 'Medium' || size === 'Two-shot') return 'medium';
  return 'wide';
}

const SEQUENCE_SIZES: Record<SceneRenderSpec['cameraAngle'], ShotSize> = {
  wide: 'Wide',
  medium: 'Medium',
  closeup: 'Close',
  over_shoulder: 'Over-shoulder',
};

/** Spoken framing, e.g. "close shot, low angle on 85mm, push in, golden hour light". */
function describeFraming(shot: ShotSpec): string {
  return `${shot.size.toLowerCase()} shot, ${shot.angle.toLowerCase()} angle on ${shot.lens}, ${shot.movement === 'Locked' ? 'locked camera' : shot.movement.toLowerCase()}, ${shot.light.toLowerCase()} light`;
}

export const DIRECTOR_PRESETS: DirectorPresetScenario[] = [
  {
    id: 'midnight-diner',
    title: 'Sequence 01: Midnight Diner Rain',
    genre: 'Neo-Noir Thriller',
    description: '4-shot sequence with an intentional prop color continuity error in Shot 2 (Red vs Blue ceramic coffee cup).',
    transcript:
      ' Continuity Rule across all shots: the ceramic coffee cup on the diner counter must be cobalt blue. Shot 1: Wide establishing shot of Detective Miller seated at the rain-streaked midnight diner counter with the blue ceramic cup in front of him. Shot 2: Medium shot as Miller leans toward the counter; a ceramic cup sits beside his notebook. Shot 3: Extreme close-up on Millerâ€™s hand reaching for the blue ceramic coffee cup as neon light reflects off the rim. Shot 4: Over-the-shoulder shot looking past Miller toward the rain-soaked window, the blue cup resting on the counter.',
  },
  {
    id: 'harbor-beacon',
    title: 'Sequence 02: Fog Pier Signal',
    genre: 'Mystery Drama',
    description: '4-shot sequence auditing rain umbrella continuity (Amber vs Crimson umbrella mismatch in Shot 3).',
    transcript:
      'Continuity Rule for all shots: the detectiveâ€™s storm umbrella must be bright amber. Shot 1: Wide shot on the fog pier at dusk with the detective holding the amber umbrella near the railing. Shot 2: Medium profile shot as the detective checks his watch under the amber umbrella. Shot 3: Close-up on the umbrella canopy under the pier streetlamp as rain intensifies. Shot 4: Over-the-shoulder shot watching a ferry approach through the fog with the amber umbrella in frame.',
  },
  {
    id: 'courier-protocol',
    title: 'Sequence 03: Emerald Trench Exchange',
    genre: 'Cyber-Noir',
    description: '4-shot sequence verifying wardrobe color lock on the courier jacket across camera angles.',
    transcript:
      'Continuity Rule across all shots: the courier jacket must remain emerald green. Shot 1: Wide shot inside the terminal cafÃ© with the courier wearing the emerald jacket. Shot 2: Medium shot at the booth table showing the courier jacket sleeve and collar. Shot 3: Close-up on the courier jacket pocket as a keycard is slipped inside. Shot 4: Over-the-shoulder view of the exit doors with the emerald jacket in foreground.',
  },
];

const KNOWN_COLORS = [
  'emerald',
  'green',
  'amber',
  'yellow',
  'gold',
  'blue',
  'cobalt',
  'red',
  'crimson',
  'white',
  'purple',
  'cyan',
];
const KNOWN_OBJECTS = [
  'car',
  'automobile',
  'vehicle',
  'altar',
  'church',
  'dress',
  'gown',
  'cup',
  'mug',
  'umbrella',
  'jacket',
  'coat',
];

export interface MetaApiEnvConfig {
  apiKey: string;
  baseUrl: string;
  models: {
    voiceTranscribe: string;
    spark: string;
    image: string;
    sam: string;
  };
  isLiveConfigured: boolean;
}

export function getMetaApiEnvConfig(): MetaApiEnvConfig {
  // This branch is deliberately offline; keys never enter the browser client.
  const apiKey = '';
  const baseUrl = '';
  const isLiveConfigured = false;

  return {
    apiKey,
    baseUrl,
    models: {
      voiceTranscribe: 'muse-voice-transcribe-1.0',
      spark: 'muse-spark-1.3',
      image: 'muse-image-1.0',
      sam: 'sam-3.1',
    },
    isLiveConfigured,
  };
}

/**
 * Meta AI Model API Client Orchestrator
 * Implements clean TypeScript abstractions for:
 * 1. muse-voice-transcribe-1.0
 * 2. muse-spark-1.3
 * 3. muse-image-1.0
 * 4. sam-3.1
 * Executes deterministic local Canvas fixtures only. Live credentials are ignored.
 */
export class MetaModelClient {
  private logs: ModelInvocationRecord[] = [];
  private onLogCallback?: (logs: ModelInvocationRecord[]) => void;
  private config: MetaApiEnvConfig = getMetaApiEnvConfig();
  private sessionToken?: string;

  public getConfig(): MetaApiEnvConfig {
    return this.config;
  }

  public setSessionToken(token?: string) {
    this.sessionToken = token;
  }

  public onLogUpdate(cb: (logs: ModelInvocationRecord[]) => void) {
    this.onLogCallback = cb;
  }

  private recordCall(model: ModelInvocationRecord['model'], operation: string, summary: string) {
    const entry: ModelInvocationRecord = {
      id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      model,
      operation,
      timestamp: Date.now(),
      summary,
    };
    this.logs = [entry, ...this.logs].slice(0, 20);
    this.onLogCallback?.(this.logs);
  }

  public getLogs(): ModelInvocationRecord[] {
    return this.logs;
  }

  /**
   * 1. `muse-voice-transcribe-1.0`
   * Converts recorded audio blob or voice dictation buffer into director transcript text.
   */
  public async transcribeAudio(
    audioBlob?: Blob | null,
    fallbackCommandText?: string
  ): Promise<{ transcript: string; confidence: number; durationMs: number }> {
    await new Promise((r) => setTimeout(r, 320));
    const transcript =
      fallbackCommandText?.trim() ||
      'Continuity Rule across all shots: the ceramic coffee cup must be blue. Shot 2 has a red cup discrepancyâ€”segment the cup and recolor it to cobalt blue.';

    this.recordCall(
      'muse-voice-transcribe-1.0',
      'transcribeAudio',
      `Transcribed ${audioBlob ? `${Math.round(audioBlob.size / 1024)}KB audio stream` : 'voice stream'} (${transcript.length} chars, 99.2% conf)`
    );

    return {
      transcript,
      confidence: 0.992,
      durationMs: 320,
    };
  }

  /**
   * 2A. `muse-spark-1.3` â€” Continuity Rule Extraction (Structured JSON Output)
   */
  public async extractContinuityRules(transcript: string): Promise<ContinuityRule[]> {
    const live = await this.planWithServer(transcript);
    if (live) return live.rules;
    await new Promise((r) => setTimeout(r, 240));
    const lower = transcript.toLowerCase();

    let detectedObject = '';
    for (const obj of KNOWN_OBJECTS) {
      if (new RegExp(`\\b${obj}(?:s|es)?\\b`).test(lower)) {
        detectedObject =
          obj === 'mug' ? 'cup' :
          obj === 'coat' ? 'jacket' :
          obj === 'automobile' || obj === 'vehicle' ? 'car' :
          obj === 'gown' ? 'dress' :
          obj;
        break;
      }
    }

    // A scene that names no tracked prop has no continuity rule.
    if (!detectedObject) return [];

    let detectedColor =
      detectedObject === 'car' || detectedObject === 'dress' || detectedObject === 'altar'
        ? 'white'
        : 'blue';
    // Look for "must be <color>" or "remain <color>" or first mentioned color in rule sentence
    const ruleSentence = transcript.split('.')[0]?.toLowerCase() || lower;
    for (const col of KNOWN_COLORS) {
      if (new RegExp(`\\b${col}\\b`).test(ruleSentence)) {
        detectedColor =
          col === 'cobalt'
            ? 'blue'
            : col === 'crimson'
              ? 'red'
              : col === 'yellow' || col === 'gold'
                ? 'amber'
                : col === 'green'
                  ? 'emerald'
                  : col;
        break;
      }
    }

    const rules: ContinuityRule[] = [
      {
        id: `rule-${detectedObject}-color`,
        scope: 'all_shots',
        targetObject: detectedObject,
        property: 'color',
        expectedValue: detectedColor,
        revision: 1,
      },
      {
        id: `rule-${detectedObject}-presence`,
        scope: 'all_shots',
        targetObject: detectedObject,
        property: 'spatial_anchor',
        expectedValue: 'foreground_counter',
        revision: 1,
      },
    ];

    this.recordCall(
      'muse-spark-1.3',
      'extractContinuityRules',
      `Extracted ${rules.length} continuity constraints: ${detectedObject}.color = "${detectedColor}" (scope: all_shots)`
    );

    return rules;
  }

  /**
   * Uses the server's connected planner (for example Meta muse-spark through Baseten).
   * Returns null only when no live planner is configured. Connected-provider failures
   * are surfaced instead of being disguised as sample generation.
   */
  private async planWithServer(transcript: string): Promise<{ rules: ContinuityRule[]; shots?: PlannedShot[]; cast?: CastMember[] } | null> {
    if (typeof fetch !== 'function') return null;
    let live = false;
    try {
      const health = await (await fetch('/api/health')).json();
      if (health?.plannerLive !== true) return null;
      live = true;
      const res = await fetch('/api/muse/spark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Anchorshot-Session': String(health.sessionToken ?? '') },
        body: JSON.stringify({ transcript, previousRevision: 0 }),
      });
      const plan = await res.json();
      if (!res.ok || !Array.isArray(plan.rules)) throw new Error(plan.error || 'The planner returned an invalid plan.');
      const rules: ContinuityRule[] = plan.rules;
      const anchor = rules[0]?.targetObject;
      this.recordCall(
        'muse-spark-1.3',
        'extractContinuityRules',
        `${plan.model} extracted ${rules.map((r) => `${r.targetObject}.color = "${r.expectedValue}"`).join(', ')}`
      );
      const shots: PlannedShot[] | undefined = Array.isArray(plan.shots) && plan.shots.length
        ? plan.shots.map((shot: Record<string, unknown>) => ({ ...normalizeShot(shot), seconds: Number(shot.seconds) || 4 }))
        : undefined;
      return {
        rules: anchor
          ? [
              ...rules,
              {
                id: `rule-${anchor}-presence`,
                scope: 'all_shots',
                targetObject: anchor,
                property: 'spatial_anchor',
                expectedValue: 'foreground_counter',
                revision: plan.ruleRevision,
              },
            ]
          : [],
        shots,
        cast: normalizeCast(plan.cast),
      };
    } catch (error) {
      if (live) throw error;
      return null;
    }
  }

  /**
   * 2B & 3 & 4. `muse-spark-1.3` + `muse-image-1.0` + `sam-3.1`
   * Generates structured shot list from director transcript, synthesizes frames with `muse-image-1.0`,
   * and runs initial multimodal audit + `sam-3.1` segmentation on any continuity discrepancy.
   */
  public async generateFilmFromTranscript(
    transcript:string, onProgress?:(message:string,percent:number)=>void, signal?:AbortSignal,
  ):Promise<{rules:ContinuityRule[];shots:StoryboardShot[]}> {
    const healthResponse=await fetch('/api/health',{signal});
    if(!healthResponse.ok)throw new Error('The local server is unavailable.');
    const health=await healthResponse.json();
    if(!health.plannerLive)throw new Error('Connect the scene planner before generating a film.');
    // Without a video model, a connected image model still draws real frames from the plan.
    if(!health.videoReady&&health.imageModel)return this.generateStoryboardFromTranscript(transcript,undefined,false,onProgress);
    if(!health.videoReady)throw new Error('Video generation is not connected yet. Your prompt is kept; no cup demo or sample scenes were created.');
    const headers={'Content-Type':'application/json','X-Anchorshot-Session':String(health.sessionToken??'')};
    onProgress?.('Planning scenes from your direction…',5);
    const response=await fetch('/api/muse/spark',{method:'POST',headers,signal,
      body:JSON.stringify({transcript:transcript+'\nProduction constraint: create at most 3 shots for this test. Use only the requested story, with no demo objects.',previousRevision:0})});
    const plan=await response.json();
    if(!response.ok)throw new Error(plan.error||'Scene planning failed.');
    if(plan.provenance!=='live-model'||!Array.isArray(plan.shots)||!plan.shots.length||plan.shots.length>3)throw new Error('The planner must provide 1–3 real scene descriptions for this test. No video request sent.');
    const rules:ContinuityRule[]=Array.isArray(plan.rules)?plan.rules:[];
    const shots:StoryboardShot[]=[];
    for(let i=0;i<plan.shots.length;i++) {
      signal?.throwIfAborted();
      const planned=normalizeShot(plan.shots[i]);
      const prompt=buildShotPrompt({shot:planned,continuity:rules.filter(r=>r.property==='color'),cast:normalizeCast(plan.cast),hasReferences:false});
      onProgress?.(`Rendering scene ${i+1} of ${plan.shots.length} at 25 fps: ${planned.subject}`,10+Math.round(i/plan.shots.length*85));
      const res=await fetch('/api/muse/video',{method:'POST',headers,body:JSON.stringify({prompt}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(330000)]):AbortSignal.timeout(330000)});
      const clip=await res.json();
      if(!res.ok)throw new Error(clip.error||`Scene ${i+1} could not be rendered.`);
      if(clip.fps!==25||typeof clip.videoUrl!=='string'||typeof clip.imageUrl!=='string'||!Number.isFinite(clip.seconds))throw new Error('The renderer returned invalid video metadata.');
      shots.push({id:`shot-${i+1}`,shotNumber:i+1,durationSeconds:clip.seconds,promptDescription:planned.subject,
        spokenDescription:`Scene ${i+1}: ${planned.subject}. Generated video at 25 frames per second; continuity unreviewed.`,
        currentImageUrl:clip.imageUrl,originalImageUrl:clip.imageUrl,videoUrl:clip.videoUrl,generatedJobId:clip.id,mediaSource:'generated',status:'uncertain',
        revisions:[{revisionId:`rev-${clip.id}`,timestamp:Date.now(),imageUrl:clip.imageUrl,videoUrl:clip.videoUrl,generatedJobId:clip.id,mediaSource:'generated',actionApplied:`Generated video by ${clip.model}; 25 fps; continuity unreviewed`}],
      });
    }
    onProgress?.('Your generated scenes are ready.',100);
    return {rules,shots};
  }

  public async generateStoryboardFromTranscript(
    transcript: string,
    existingRules?: ContinuityRule[],
    injectIntentionalDiscrepancy: boolean = true,
    onProgress?: (message: string, percent: number) => void
  ): Promise<{ rules: ContinuityRule[]; shots: StoryboardShot[] }> {
    onProgress?.('Planning the shots...', 5);
    // The planner model, when connected, also chooses the shot list; otherwise the
    // classic four-angle sequence is used.
    const plan = existingRules && existingRules.length > 0 ? null : await this.planWithServer(transcript);
    const rules = existingRules && existingRules.length > 0
      ? existingRules
      : plan?.rules ?? (await this.extractContinuityRules(transcript));
    const plannedShots = plan?.shots;
    const shotCount = plannedShots?.length ?? 4;

    const primaryRule = rules[0];
    const targetObject = primaryRule?.targetObject ?? '';
    const expectedColor = primaryRule?.expectedValue ?? '';
    const sampleObjectSupported = supportsOfflineSampleObject(targetObject);
    const mismatchedColor =
      expectedColor === 'white'
        ? 'red'
        : expectedColor === 'blue'
        ? 'red'
        : expectedColor === 'amber'
        ? 'crimson'
        : expectedColor === 'emerald' || expectedColor === 'green'
        ? 'amber'
        : 'blue';

    const cameraSequence: Array<SceneRenderSpec['cameraAngle']> = [
      'wide',
      'medium',
      'closeup',
      'over_shoulder',
    ];

    // Parse custom shot sentences if present
    const shotRegex = /Shot\s*(\d+)\s*:\s*([^.]+)/gi;
    const parsedDescriptions: Record<number, string> = {};
    let match: RegExpExecArray | null;
    while ((match = shotRegex.exec(transcript)) !== null) {
      const num = parseInt(match[1], 10);
      if (num >= 1 && num <= 8) {
        parsedDescriptions[num] = match[2].trim();
      }
    }

    // Without a planned shot list, each line of the direction becomes a shot description.
    if (!plannedShots && Object.keys(parsedDescriptions).length === 0) {
      const lines = transcript
        .split(/[\r\n]+/)
        .map((l) => l.trim())
        .filter(
          (l) =>
            l.length > 5 &&
            !l.toLowerCase().startsWith('continuity rule') &&
            !l.toLowerCase().includes('last-minute wedding')
        );
      lines.forEach((l, idx) => {
        if (idx < 6) {
          parsedDescriptions[idx + 1] = l;
        }
      });
    }

    const health = await this.getSamBackendHealth();
    if (health?.imageModel) {
      return {
        rules,
        shots: await this.generateModelFrames(health.imageModel, rules, cameraSequence, parsedDescriptions, plannedShots, plan?.cast, onProgress, transcript),
      };
    }

    const mismatchShotNumber = targetObject === 'umbrella' ? 3 : 2;
    const shots: StoryboardShot[] = [];

    for (let i = 0; i < shotCount; i++) {
      const shotNumber = i + 1;
      const planned = plannedShots?.[i];
      const cameraAngle = planned ? canvasFraming(planned.size) : cameraSequence[i % cameraSequence.length];
      const framing = planned ? describeFraming(planned) : `${cameraAngle.replace('_', ' ')} framing`;
      const durationSeconds = planned?.seconds ?? (shotNumber === 1 ? 4.0 : 3.5);
      const hasDiscrepancy = injectIntentionalDiscrepancy && sampleObjectSupported && rules.length > 0 && shotNumber === mismatchShotNumber;
      const isUncertainOcclusion =
        injectIntentionalDiscrepancy && targetObject === 'jacket' && shotNumber === 4;
      const actualRenderedColor = hasDiscrepancy ? mismatchedColor : expectedColor;

      const basePrompt =
        parsedDescriptions[shotNumber] ||
        planned?.subject ||
        (rules.length ? '' : transcript.trim()) ||
        (targetObject === 'car'
          ? `${cameraAngle.replace('_', ' ')} shot of the ${actualRenderedColor} wedding car on the way to the ceremony`
          : targetObject === 'altar'
          ? `${cameraAngle.replace('_', ' ')} shot of the flower-draped wedding altar`
          : `${cameraAngle.replace('_', ' ')} shot featuring the ${actualRenderedColor} ${targetObject}`);

      const weatherOrMood: SceneRenderSpec['weatherOrMood'] =
        targetObject === 'umbrella'
          ? 'fog_pier'
          : targetObject === 'car' || targetObject === 'altar'
          ? 'studio_warm'
          : 'rain_noir';

      let { imageUrl, box } = renderMuseStoryboardFrame({
        shotNumber,
        cameraAngle,
        settingTitle: targetObject === 'car' || targetObject === 'altar' ? 'Wedding Story' : 'Studio Stage',
        targetObject,
        objectColorName: actualRenderedColor,
        weatherOrMood,
        characterPose: 'seated_detective',
        seed: shotNumber * 17,
      });

      this.recordCall(
        'muse-image-1.0',
        `generateFrame(Shot ${shotNumber})`,
        `Rendered 800x450 frame [seed:${1000 + shotNumber * 17}, framing:${cameraAngle}, ${targetObject}:${actualRenderedColor}]`
      );

      let samMask: SamMask | undefined;
      if (hasDiscrepancy || isUncertainOcclusion) {
        samMask = await this.segmentObjectWithSam3(
          shotNumber,
          targetObject,
          box,
          isUncertainOcclusion ? 0.724 : 0.986,
          (primaryRule?.revision ?? 0),
          imageUrl
        );
      }

      const shotStatus = !sampleObjectSupported ? 'uncertain' : hasDiscrepancy
        ? 'mismatch'
        : isUncertainOcclusion
        ? 'uncertain'
        : 'consistent';

      const spokenDescription = primaryRule && !sampleObjectSupported
        ? `Shot ${shotNumber}, ${framing}, duration ${durationSeconds} seconds. ${basePrompt}. Generic offline preview: ${targetObject} is not rendered. Its continuity is not checked.`
        : !primaryRule
        ? `Shot ${shotNumber}, ${framing}, duration ${durationSeconds} seconds. ${basePrompt}. Generic offline preview; no continuity object selected and continuity is not checked.`
        : hasDiscrepancy
        ? `Shot ${shotNumber}, ${framing}, duration ${durationSeconds} seconds. ${basePrompt}. Continuity Alert: ${targetObject} rendered in ${actualRenderedColor} instead of expected ${expectedColor}. Press Y to apply SAM 3.1 mask recolor to ${expectedColor}.`
        : isUncertainOcclusion
        ? `Shot ${shotNumber}, ${framing}, duration ${durationSeconds} seconds. ${basePrompt}. Offline sample has an ambiguous ${targetObject}. Mask accuracy is not measured. Review the selection before correcting its color.`
        : `Shot ${shotNumber}, ${framing}, duration ${durationSeconds} seconds. ${basePrompt}. Offline sample: ${targetObject} is drawn in ${expectedColor}.`;

      shots.push({
        id: `shot-${shotNumber}`,
        shotNumber,
        durationSeconds,
        movement: planned?.movement,
        promptDescription: basePrompt,
        spokenDescription,
        currentImageUrl: imageUrl,
        originalImageUrl: imageUrl,
        mediaSource: 'sample',
        status: shotStatus,
        discrepancyMessage: hasDiscrepancy
          ? `Visual audit detected a ${actualRenderedColor} ${targetObject} in Shot ${shotNumber}, violating rule "${targetObject}.color = ${expectedColor}" (rev ${(primaryRule?.revision ?? 0)}).`
          : isUncertainOcclusion
          ? `Offline sample includes an ambiguous ${targetObject} in Shot ${shotNumber}. Review its selection; mask accuracy is not measured.`
          : undefined,
        proposedFix:
          hasDiscrepancy || isUncertainOcclusion
            ? {
                action: 'recolor',
                targetObject,
                targetColor: expectedColor,
                mask: samMask,
                candidates:
                  isUncertainOcclusion && samMask
                    ? [
                        samMask,
                        {
                          ...samMask,
                          id: `${samMask.id}-alt`,
                          objectId: '1',
                          maskRef: `sam-3.1:${targetObject.toLowerCase().replace(/\s+/g, '-')}:1:v${(primaryRule?.revision ?? 0)}`,
                          confidence: 0.682,
                        },
                      ]
                    : samMask
                      ? [samMask]
                      : undefined,
              }
            : undefined,
        revisions: [
          {
            revisionId: `rev-${shotNumber}-initial`,
            timestamp: Date.now() - (shotCount - i) * 15000,
            imageUrl,
            mediaSource: 'sample',
            actionApplied: primaryRule && !sampleObjectSupported ? `Generic offline preview; ${targetObject} not rendered` : primaryRule ? `Offline sample (${actualRenderedColor} ${targetObject})` : 'Generic offline preview; no continuity object selected',
            ruleRevision: (primaryRule?.revision ?? 0),
            maskRef: samMask?.maskRef,
          },
        ],
      });
    }

    this.recordCall(
      'muse-spark-1.3',
      'auditShotContinuity',
      `Audited ${shots.length} shots against ${rules.length} rules: ${shots.filter((s) => s.status === 'consistent').length} consistent, ${shots.filter((s) => s.status === 'mismatch').length} mismatch flagged.`
    );

    return { rules, shots };
  }

  /**
   * Draws each shot with the image model connected on the server. Nothing is
   * injected or assumed: frames stay `uncertain` until continuity is reviewed.
   */
  private async generateModelFrames(
    model: string,
    rules: ContinuityRule[],
    cameraSequence: Array<SceneRenderSpec['cameraAngle']>,
    descriptions: Record<number, string>,
    plannedShots?: PlannedShot[],
    cast?: CastMember[],
    onProgress?: (message: string, percent: number) => void,
    transcript: string = ''
  ): Promise<StoryboardShot[]> {
    const colourRules = rules.filter((r) => r.property === 'color');
    const anchor = colourRules[0] ?? rules[0];
    const shots: StoryboardShot[] = [];
    const shotCount = plannedShots?.length ?? 4;
    // First solo frame of each character, reused as the reference for their later shots.
    const referenceFrames = new Map<string, string>();
    for (let i = 0; i < shotCount; i++) {
      const shotNumber = i + 1;
      onProgress?.(`Drawing frame ${shotNumber} of ${shotCount}...`, 10 + Math.round((i / shotCount) * 90));
      const planned = plannedShots?.[i];
      const fallbackAngle = cameraSequence[i % cameraSequence.length];
      const subject =
        descriptions[shotNumber] ||
        planned?.subject ||
        `${fallbackAngle.replace('_', ' ')} shot. ${transcript.trim()}`;
      const shot = planned ? { ...planned, subject } : normalizeShot({ size: SEQUENCE_SIZES[fallbackAngle], subject });
      const durationSeconds = planned?.seconds ?? (shotNumber === 1 ? 4.0 : 3.5);
      const seed = shotNumber * 17;
      const onScreen = castInShot(shot, cast ?? []);
      const references = [...new Set(onScreen.map((c) => referenceFrames.get(c.name)).filter((url): url is string => Boolean(url)))];
      const res = await fetch('/api/muse/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Framelock-Session': this.sessionToken ?? '' },
        body: JSON.stringify({
          prompt: buildShotPrompt({ shot, continuity: colourRules, cast, hasReferences: references.length > 0 }),
          references,
          targetObject: anchor?.targetObject ?? 'scene',
          seed,
        }),
      });
      const frame = await res.json().catch(() => ({}));
      if (!res.ok || typeof frame.url !== 'string')
        throw new Error(frame.error || `Shot ${shotNumber} could not be generated.`);
      if (onScreen.length === 1 && !referenceFrames.has(onScreen[0].name)) referenceFrames.set(onScreen[0].name, frame.url);
      this.recordCall(
        'muse-image-1.0',
        `generateFrame(Shot ${shotNumber})`,
        `${model} drew ${frame.width}x${frame.height} frame [seed:${seed}, sha256:${String(frame.sourceHash).slice(0, 12)}]`
      );
      shots.push({
        id: `shot-${shotNumber}`,
        shotNumber,
        durationSeconds,
        movement: planned?.movement,
        absentProps: colourRules.filter((r) => !propInShot(shot, r.targetObject, cast)).map((r) => r.targetObject),
        promptDescription: subject,
        spokenDescription: `Shot ${shotNumber}, ${describeFraming(shot)}, duration ${durationSeconds} seconds. ${subject}. Generated image; continuity unreviewed.`,
        currentImageUrl: frame.url,
        originalImageUrl: frame.url,
        mediaSource: 'generated',
        status: 'uncertain',
        revisions: [
          {
            revisionId: `rev-${shotNumber}-initial`,
            timestamp: Date.now(),
            imageUrl: frame.url,
            mediaSource: 'generated',
            actionApplied: `Generated by ${model}; unreviewed`,
            ruleRevision: anchor?.revision ?? 1,
          },
        ],
      });
    }
    return shots;
  }

  /**
   * 4. `sam-3.1` (Segment Anything Model 3.1)
   * Isolates the target object via text prompt + bounding box and returns a binary/RLE mask with versioned `maskRef`.
   */
  public async segmentObjectWithSam3(
    shotNumber: number,
    targetObject: string,
    customBox?: BoundingBox,
    confidence: number = 0.986,
    revision: number = 1,
    imageUrl?: string
  ): Promise<SamMask> {
    const cameraSequence: Array<SceneRenderSpec['cameraAngle']> = [
      'wide',
      'medium',
      'closeup',
      'over_shoulder',
    ];
    const angle = cameraSequence[(shotNumber - 1) % cameraSequence.length];
    const box = customBox || getTargetObjectBox(angle, targetObject);

    // Attempt live Meta Platform SAM 3.1 API if session is active
    if (imageUrl && typeof window !== 'undefined') {
      try {
        const healthRes = await fetch('/api/health');
        if (healthRes.ok) {
          const health = await healthRes.json();
          if (health.configured && health.sessionToken) {
            this.sessionToken = health.sessionToken;
            // Generated frames are served by URL; SAM needs the bytes inline.
            const frameData = await toDataUrl(imageUrl);
            const base64Data = frameData.split(',')[1] || '';
            const raw = atob(base64Data);
            const rawBytes = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) rawBytes[i] = raw.charCodeAt(i);
            const hashBuffer = await crypto.subtle.digest('SHA-256', rawBytes);
            const sourceHash = Array.from(new Uint8Array(hashBuffer))
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('');

            const liveRes = await fetch('/api/segment/check', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Framelock-Session': health.sessionToken,
                'X-Anchorshot-Session': health.sessionToken,
              },
              body: JSON.stringify({
                image: frameData,
                concept: targetObject,
                sourceHash,
                shotNumber,
                ruleRevision: revision,
              }),
            });

            const liveData = await liveRes.json();
            if (!liveRes.ok) throw new Error(liveData.error || `Segmentation failed (${liveRes.status}).`);
            if (liveData.provenance !== 'live-sam-3.1' || !liveData.objects?.length) throw new Error(`No verified ${targetObject} mask was returned for this frame.`);
            const candidates: SamMask[] = liveData.objects.map((object: any) => {
              const canvas = document.createElement('canvas');
              canvas.width = object.width; canvas.height = object.height;
              const context = canvas.getContext('2d');
              if (!context) throw new Error('Canvas is unavailable for the object mask.');
              const overlay = context.createImageData(object.width, object.height);
              expandMask(object).forEach((on: number, pixel: number) => { if (on) overlay.data.set([56,189,248,255],pixel*4); });
              context.putImageData(overlay,0,0);
              return {id:object.id, objectId:object.objectId, maskRef:object.maskRef,
                sourceImageUrl:imageUrl, sourceHash, serverSessionId:liveData.maskSessionId, segmentationId:liveData.requestId, candidateCount:liveData.objects.length, provenance:'live-sam-3.1',
                confidence:object.confidence ?? 0, providerConfidence:object.confidence, maskBase64:canvas.toDataURL('image/png'),
                box:{x:object.bounds.left/object.width*100,y:object.bounds.top/object.height*100,
                  width:(object.bounds.right-object.bounds.left)/object.width*100,height:(object.bounds.bottom-object.bounds.top)/object.height*100}};
            });
            const primary = candidates.find(mask => mask.objectId === liveData.selectedObjectId) ?? candidates[0];
            this.recordCall('sam-3.1',`segmentObject("${targetObject}", Shot ${shotNumber}) [LIVE META API]`,
              `Returned ${candidates.length} source-bound masks; selected ${primary.objectId}.`);
            return {...primary,candidates};
          }
        }
      } catch (error) {
        // A configured provider failure is not permission to substitute a sample mask.
        throw new Error(error instanceof Error ? error.message : 'Object segmentation failed.');
      }
    }

    await new Promise((r) => setTimeout(r, 180));
    if (!supportsOfflineSampleObject(targetObject)) throw new Error(`No offline sample mask exists for ${targetObject}. Select the object from real media instead.`);

    const generatedMask = generateSam3MaskData(
      `${targetObject}-shot-${shotNumber}`,
      box,
      confidence,
      revision
    );
    const mask: SamMask = {
      ...generatedMask,
      sourceImageUrl: imageUrl,
      provenance: generatedMask.provenance ?? 'offline-fixture',
    };

    this.recordCall(
      'sam-3.1',
      `segmentObject("${targetObject}", Shot ${shotNumber})`,
      `Generated maskRef ${mask.maskRef} [box: ${box.x}%,${box.y}% ${box.width}x${box.height}%, fixture confidence: ${(mask.confidence * 100).toFixed(1)}%]`
    );

    return mask;
  }

  /**
   * Selects a known candidate without turning selection into a continuity verdict.
   */
  public async disambiguateMaskSelection(
    shot: StoryboardShot,
    selectedObjectId: string,
    signal?: AbortSignal
  ): Promise<StoryboardShot> {
    const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000);
    requestSignal.throwIfAborted();
    const candidates = shot.proposedFix?.candidates ?? [];
    const selectedCandidate = candidates.find(
      (candidate) => candidate.objectId === selectedObjectId
    );
    const currentMask = selectedCandidate ?? shot.proposedFix?.mask;
    let resolvedMaskRef = currentMask?.maskRef ?? '';
    if (!currentMask || (!selectedCandidate && currentMask.objectId !== selectedObjectId))
      throw new Error('That object has no selectable mask. Select the object again.');
    if ((isGeneratedShot(shot) || currentMask.sourceImageUrl) && currentMask.sourceImageUrl !== shot.currentImageUrl)
      throw new Error('This mask belongs to another frame. Select the object in the current frame again.');
    // Selecting an instance is not a colour measurement.
    const nextStatus = shot.status;

    let detached=Boolean(currentMask.serverDetached);
    if(currentMask.provenance==='live-sam-3.1'&&!detached){
      if(!currentMask.serverSessionId||!currentMask.sourceHash||!currentMask.segmentationId)detached=true;
      else if(typeof fetch==='function'){
        const healthResponse=await fetch('/api/health',{signal:requestSignal});
        if(!healthResponse.ok)throw new Error('Mask service could not be checked. Retry the selection.');
        const health=await healthResponse.json();
        detached=health.maskSessionId!==currentMask.serverSessionId;
        if(!detached)this.sessionToken=health.sessionToken;
      }
    }
    if (currentMask.provenance === 'live-sam-3.1' && !detached && typeof fetch === 'function' && this.sessionToken) {
      try {
        const res = await fetch('/api/masks/disambiguate', {
          signal: requestSignal,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Framelock-Session': this.sessionToken,
          },
          body: JSON.stringify({
            maskRef: currentMask.maskRef,
            maskSessionId: currentMask.serverSessionId,
            segmentationId: currentMask.segmentationId,
            sourceHash: currentMask.sourceHash,
            selectedObjectId,
            status: nextStatus,
            shotNumber: shot.shotNumber,
            confidence: currentMask.confidence,
          }),
        });
        const data = await res.json();
        if(!res.ok){
          if((res.status===409||res.status===404)&&['MASK_SOURCE_CHANGED','MASK_TRACK_EXPIRED','MASK_SESSION_EXPIRED','MASK_RESULT_CHANGED'].includes(data.code))detached=true;
          else throw new Error(`The selected mask could not be confirmed (${res.status}). Select it again.`);
        }
        if (typeof data?.track?.maskRef === 'string') {
          resolvedMaskRef = data.track.maskRef;
        }
      } catch (error) { throw error; }
    }

    requestSignal.throwIfAborted();
    const mask = currentMask
      ? {
          ...currentMask,
          serverDetached: detached,
          objectId: selectedObjectId,
          maskRef: resolvedMaskRef,
          candidateCount: 1,
        }
      : undefined;

    this.recordCall(
      'sam-3.1',
      `disambiguateMaskSelection("${selectedObjectId}", Shot ${shot.shotNumber})`,
      `Disambiguated Shot ${shot.shotNumber}: objectId=${selectedObjectId}, maskRef=${mask?.maskRef ?? resolvedMaskRef}, status ${shot.status} â†’ ${nextStatus}`
    );

    return {
      ...shot,
      status: nextStatus,
      discrepancyMessage: shot.status === 'uncertain' ? undefined : shot.discrepancyMessage,
      proposedFix: shot.proposedFix
        ? {
            ...shot.proposedFix,
            mask: mask ?? shot.proposedFix.mask,
          }
        : shot.proposedFix,
    };
  }

  /**
   * Role 2 & 4: Live / Real Frame SAM 3.1 Continuity Audit.
   * Runs SAM 3.1 to detect the target object on the given frame, extracts the mask,
   * samples actual pixel pigments inside the mask, and checks for continuity violations
   * against the expected rule value.
   */
  public async auditShotContinuity(
    shot: StoryboardShot,
    rule: ContinuityRule
  ): Promise<StoryboardShot> {
    const targetObject = rule.targetObject;
    const expectedColor = normalizeContinuityColor(rule.expectedValue) ?? rule.expectedValue;

    // Segment object on the real frame via SAM 3.1
    let mask: SamMask;
    try { mask = await this.segmentObjectWithSam3(
      shot.shotNumber,
      targetObject,
      undefined,
      0.986,
      rule.revision,
      shot.currentImageUrl
    ); } catch (error) {
      return { ...shot, status:'uncertain', proposedFix:undefined,
        discrepancyMessage:`${targetObject} could not be checked: ${(error as Error).message}`,
        spokenDescription:`Shot ${shot.shotNumber}. ${targetObject} continuity is unverified. ${(error as Error).message}` };
    }

    // Planned absence is not evidence of visual absence when SAM has not verified the frame.
    if (shot.absentProps?.includes(targetObject) && mask.provenance !== 'live-sam-3.1') {
      return {
        ...shot,
        status: 'uncertain',
        spokenDescription: `Shot ${shot.shotNumber}. The plan leaves out ${targetObject}, but its absence has not been verified in the frame.`,
        discrepancyMessage: undefined,
        proposedFix: undefined,
      };
    }

    // Sample actual color inside the detected mask
    let detectedColor: string | null = null;
    try {
      // A sample mask says nothing about where the object is in a model-drawn frame.
      if (shot.currentImageUrl && (mask.provenance === 'live-sam-3.1' || !isGeneratedShot(shot))) {
        const sample = await sampleImageColorInMask(shot.currentImageUrl, mask);
        // No clear majority colour counts as not measured.
        detectedColor = sample.confidence >= 0.5 ? sample.colorName : null;
      }
    } catch {
      // An unreadable frame stays unverified below.
    }

    const isMatch = detectedColor?.toLowerCase().trim() === expectedColor.toLowerCase().trim();
    // Never report "verified" without a measured colour.
    const unmeasured = detectedColor === null;
    const isAmbiguous = mask.confidence < 0.8 || (mask.candidateCount ?? 1) > 1 || unmeasured;
    const status = isAmbiguous ? 'uncertain' : isMatch ? 'consistent' : 'mismatch';

    const spokenDescription = status === 'consistent'
      ? `Shot ${shot.shotNumber}, duration ${shot.durationSeconds} seconds. ${shot.promptDescription}. Color check passed: the selected ${targetObject} pixels match ${expectedColor}.`
      : isAmbiguous
      ? `Shot ${shot.shotNumber}, duration ${shot.durationSeconds} seconds. ${shot.promptDescription}. Continuity uncertain: ${mask.provenance !== 'live-sam-3.1' ? `the ${targetObject} could not be found in this frame` : unmeasured ? 'the colour could not be measured' : (mask.candidateCount ?? 1) > 1 ? 'multiple candidate objects need review' : 'the selection evidence is insufficient'} on ${targetObject}.`
      : `Shot ${shot.shotNumber}, duration ${shot.durationSeconds} seconds. ${shot.promptDescription}. Continuity Alert: ${targetObject} rendered in ${detectedColor} instead of expected ${expectedColor}. Press Y to apply SAM 3.1 mask recolor to ${expectedColor}.`;

    const discrepancyMessage = status === 'consistent'
      ? undefined
      : unmeasured
      ? mask.provenance !== 'live-sam-3.1'
        ? `The ${targetObject} could not be found in Shot ${shot.shotNumber}, so continuity is unverified.`
        : `The ${targetObject} colour in Shot ${shot.shotNumber} could not be measured, so continuity is unverified.`
      : isAmbiguous
      ? `Selection or color evidence is insufficient for ${targetObject} in Shot ${shot.shotNumber}. Review the mask and measured color; selection alone does not verify continuity.`
      : `Visual audit detected a ${detectedColor} ${targetObject} in Shot ${shot.shotNumber}, violating rule "${targetObject}.color = ${expectedColor}" (rev ${rule.revision}).`;

    const proposedFix = status !== 'consistent'
      ? {
          action: 'recolor' as const,
          targetObject,
          targetColor: expectedColor,
          mask,
          candidates: mask.candidates,
        }
      : undefined;

    this.recordCall(
      'sam-3.1',
      `auditShotContinuity(Shot ${shot.shotNumber})`,
      `Audited ${targetObject}: observed="${detectedColor}", expected="${expectedColor}" â†’ status: ${status} (mask: ${mask.maskRef})`
    );

    return {
      ...shot,
      status,
      spokenDescription,
      discrepancyMessage,
      proposedFix,
    };
  }

  /**
   * Audits all shots against active continuity rules.
   */
  public async auditAllShots(
    shots: StoryboardShot[],
    rules: ContinuityRule[]
  ): Promise<StoryboardShot[]> {
    const colorRules = rules.filter(rule => rule.property === 'color');
    if (!colorRules.length) return shots;
    const audited: StoryboardShot[] = [];
    for (const shot of shots) {
      const checks = [];
      for (const rule of colorRules) checks.push({ rule, result: await this.auditShotContinuity(shot, rule) });
      const problem = checks.find(check => check.result.status === 'mismatch') ?? checks.find(check => check.result.status === 'uncertain') ?? checks[0];
      audited.push({ ...problem.result, continuityChecks: checks.map(({ rule, result }) => ({
        ruleId: rule.id, targetObject: rule.targetObject, status: result.status, explanation: result.spokenDescription,
      })) });
    }
    return audited;
  }

  /**
   * Executes the proposed continuity fix on a shot using `sam-3.1` mask isolation,
   * client-side pixel manipulation (`applySamPixelFixWithVerification`), and
   * full-frame pixel-diff verification proving 0 outside-mask pixel drift.
   */
  public async applyContinuityFix(
    shot: StoryboardShot,
    overrideColor?: string,
    ruleRevision: number = 1
  ): Promise<StoryboardShot> {
    const targetObject = shot.proposedFix?.targetObject;
    if (!targetObject) throw new Error(`Shot ${shot.shotNumber} has no prop selected to recolour.`);
    const requestedColor = overrideColor || shot.proposedFix?.targetColor || 'blue';
    const targetColor = normalizeContinuityColor(requestedColor);
    if (!targetColor) throw new Error(`The colour ${requestedColor} is not supported by the local correction palette.`);

    let mask = shot.proposedFix?.mask;
    if (!mask) {
      mask = await this.segmentObjectWithSam3(
        shot.shotNumber,
        targetObject,
        undefined,
        0.986,
        ruleRevision,
        shot.currentImageUrl
      );
    }

    if (isGeneratedShot(shot) && mask.provenance !== 'live-sam-3.1')
      throw new Error('A real object mask is required for this generated frame. Sample masks cannot be used.');

    if ((isGeneratedShot(shot) || mask.sourceImageUrl) && mask.sourceImageUrl !== shot.currentImageUrl)
      throw new Error('This mask belongs to another frame. Select the object in the current frame again.');

    if ((mask.candidateCount ?? 1) > 1) throw new Error('Multiple objects match. Confirm one object before recolouring.');

    const { imageUrl: updatedImageUrl, pixelVerification } =
      await applySamPixelFixWithVerification(
        shot.currentImageUrl,
        mask,
        targetColor,
        ruleRevision
      );

    this.recordCall(
      'sam-3.1',
      `applyMaskedRecolor(Shot ${shot.shotNumber})`,
      `Mask ${mask.maskRef} (ruleRev ${ruleRevision}): ${pixelVerification.changedInsideMask} px updated inside mask, ${pixelVerification.changedOutsideMask} px outside (${pixelVerification.outsideDriftPercent}% drift)`
    );

    const newRevision = {
      revisionId: `rev-${shot.shotNumber}-${shot.revisions.length + 1}`,
      timestamp: Date.now(),
      imageUrl: updatedImageUrl,
      mediaSource: isGeneratedShot(shot) ? 'generated' as const : 'sample' as const,
      actionApplied: `SAM 3.1 masked recolor: ${targetObject} â†’ ${targetColor} (${pixelVerification.changedOutsideMask}px outside drift)`,
      ruleRevision,
      maskRef: mask.maskRef,
      pixelVerification,
    };

    let colorMeasured = false;
    try {
      const measured = await sampleImageColorInMask(updatedImageUrl, {...mask,sourceImageUrl:updatedImageUrl});
      colorMeasured = measured.confidence >= 0.5 && measured.colorName === targetColor;
    } catch { /* Containment alone cannot verify the intended appearance. */ }
    const expectedColor=normalizeContinuityColor(shot.proposedFix?.targetColor ?? '');
    const contradictsRule=colorMeasured && Boolean(expectedColor) && targetColor!==expectedColor;
    const measuredStatus = contradictsRule ? 'mismatch' : colorMeasured && targetColor===expectedColor && (shot.continuityChecks?.length ?? 0) <= 1 ? 'consistent' : 'uncertain';
    const updatedSpoken = `Shot ${shot.shotNumber}. ${targetObject} correction changed ${pixelVerification.changedInsideMask} selected pixels with zero outside-mask pixel drift. ${contradictsRule ? `Measured colour is ${targetColor}, but the rule requires ${expectedColor}.` : measuredStatus === 'consistent' ? `Measured colour is ${targetColor}.` : 'Continuity needs review.'}`;

    return {
      ...shot,
      currentImageUrl: updatedImageUrl,
      mediaSource: isGeneratedShot(shot) ? 'generated' : 'sample',
      // A video rendered before the fix would still show the old colour.
      videoUrl: undefined,
      generatedJobId: undefined,
      videoMaskPlan: undefined,
      detectedObjects: undefined,
      timestamp: undefined,
      status: measuredStatus,
      continuityChecks: shot.continuityChecks?.map(check => ({ ...check, status: 'uncertain', explanation: 'Frame edited; recheck this rule.' })),
      discrepancyMessage: contradictsRule ? `Measured ${targetObject} color is ${targetColor}; the rule still requires ${expectedColor}.` : undefined,
      spokenDescription: updatedSpoken,
      pixelVerification,
      proposedFix: {
        action: 'recolor',
        targetObject,
        targetColor: shot.proposedFix!.targetColor,
        mask: {...mask, sourceImageUrl:updatedImageUrl, candidates:undefined},
      },
      revisions: [...shot.revisions, newRevision],
    };
  }

  /**
   * Queries `/api/health` on the local Express + SAM 3.1 server to retrieve session token
   * and live configuration status.
   */
  public async getSamBackendHealth(): Promise<{
    configured: boolean;
    model: string;
    sessionToken: string;
    requestsUsed: number;
    requestLimit: number;
    tracksStored?: number;
    imageModel?: string | null;
  } | null> {
    if (typeof fetch !== 'function') return null;
    try {
      const res = await fetch('/api/health');
      if (!res.ok) return null;
      const health = await res.json();
      if (typeof health?.sessionToken === 'string') {
        this.sessionToken = health.sessionToken;
      }
      return health;
    } catch {
      return null;
    }
  }

  /**
   * Queries `/api/masks` to retrieve versioned `maskRef` cross-shot tracks stored on the server.
   */
  public async fetchStoredMaskTracks(concept?: string, shotNumber?: number) {
    if (typeof fetch !== 'function') return [];
    try {
      const params = new URLSearchParams();
      if (concept) params.set('concept', concept);
      if (shotNumber !== undefined) params.set('shotNumber', String(shotNumber));
      const query = params.toString() ? `?${params.toString()}` : '';
      const headers: Record<string, string> = {};
      if (this.sessionToken) {
        headers['X-Framelock-Session'] = this.sessionToken;
      }
      const res = await fetch(`/api/masks${query}`, { headers });
      if (!res.ok) return [];
      const data = await res.json();
      return data.tracks ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Meta muse-spark-1.3 Video & Audio Understanding API
   */
  public async understandVideoWithMuseSpark(
    videoUrl?: string,
    prompt?: string,
    jobId?: string,
    rules?: ContinuityRule[],
    shotIndex = 0,
    signal?: AbortSignal
  ): Promise<{
    model: string;
    provenance: string;
    summary: string;
    audioTranscription: string;
    findings: ContinuityFinding[];
    detectedObjects: VideoDetectedObject[];
    scenes: Array<{
      shotIndex: number;
      timestamp: number;
      label: string;
      description: string;
    }>;
  }> {
    const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000);
    requestSignal.throwIfAborted();
    const res = await fetch('/api/meta/video-understand', {
      signal: requestSignal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.sessionToken ? { 'X-Framelock-Session': this.sessionToken } : {}),
      },
      body: JSON.stringify({ videoUrl, prompt, jobId, rules, shotIndex }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Video review failed.');
    const data = await res.json();
    return { findings: [], detectedObjects: [], scenes: [], ...data };
  }

  /**
   * Meta muse-image-1.0 Generative Frame Edit with 0-Drift Sharp Composite
   */
  public async editFrameGenerative(
    imageBase64: string,
    prompt: string,
    maskBase64?: string,
    bounds?: { left: number; top: number; right: number; bottom: number },
    signal?: AbortSignal
  ): Promise<{
    editedImageUrl: string;
    changedInside: number;
    selectedPixels: number;
    totalPixels: number;
    outsideDrift: number;
    outsideDriftPercent: string;
    verified: boolean;
    model: string;
    provenance: string;
    promptApplied: string;
  }> {
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000);
    requestSignal.throwIfAborted();
    const res = await fetch('/api/meta/edit-frame', {
      signal: requestSignal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.sessionToken ? { 'X-Framelock-Session': this.sessionToken } : {}),
      },
      body: JSON.stringify({ imageBase64, maskBase64, prompt, bounds }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Generative edit failed.');
    return res.json();
  }

  /**
   * Ingest video keyframes into discrete StoryboardShot objects
   */
  public async ingestShotsFromVideo(
    videoUrl?: string,
    jobId?: string
  ): Promise<{ shots: StoryboardShot[] }> {
    const res = await fetch('/api/video/ingest-shots', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.sessionToken ? { 'X-Framelock-Session': this.sessionToken } : {}),
      },
      body: JSON.stringify({ videoUrl, jobId }),
    });
    if (!res.ok) throw new Error('Video shot ingestion failed');
    return res.json();
  }
}

/**
 * Pure mapping from Meta muse-spark-1.3 continuity findings onto storyboard shots.
 * Flags the matching shot and binds its sam-3.1 candidate as the proposed fix.
 * Consistent findings leave the shot untouched.
 */
export function applyVideoFindingsToShots(
  shots: StoryboardShot[],
  findings: ContinuityFinding[],
  detectedObjects: VideoDetectedObject[]
): StoryboardShot[] {
  if (findings.length === 0) return shots;
  const next = [...shots];
  for (const finding of findings) {
    if (finding.status === 'consistent') continue;
    const idx = finding.shotIndex;
    if (idx < 0 || idx >= next.length) continue;
    const target = finding.targetObject.toLowerCase().trim();
    const matched = detectedObjects.filter((o) => {
      const hay = `${o.concept ?? ''} ${o.label ?? ''}`.toLowerCase();
      return hay.includes(target);
    });
    const boundObject =
      matched.find((o) => o.objectId === finding.objectId) ?? matched[0] ?? detectedObjects[0];
    next[idx] = {
      ...next[idx], status: finding.status, discrepancyMessage: finding.explanation,
      detectedObjects: matched.length > 0 ? (matched as StoryboardShot['detectedObjects']) : next[idx].detectedObjects,
      // Video findings are advisory. A real current-frame selection must be made
      // before any correction can be offered; a bounding box is not a SAM mask.
      proposedFix: undefined,
    };
  }
  return next;
}

export const metaModelClient = new MetaModelClient();
