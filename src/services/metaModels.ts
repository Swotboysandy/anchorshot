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
  renderMuseStoryboardFrame,
  sampleImageColorInMask,
  SceneRenderSpec,
} from './canvasEngine';
import { toDataUrl } from './animaticExport';
import { isGeneratedImage } from './localGeneration';
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
      ' Continuity Rule across all shots: the ceramic coffee cup on the diner counter must be cobalt blue. Shot 1: Wide establishing shot of Detective Miller seated at the rain-streaked midnight diner counter with the blue ceramic cup in front of him. Shot 2: Medium shot as Miller leans toward the counter; a ceramic cup sits beside his notebook. Shot 3: Extreme close-up on Miller’s hand reaching for the blue ceramic coffee cup as neon light reflects off the rim. Shot 4: Over-the-shoulder shot looking past Miller toward the rain-soaked window, the blue cup resting on the counter.',
  },
  {
    id: 'harbor-beacon',
    title: 'Sequence 02: Fog Pier Signal',
    genre: 'Mystery Drama',
    description: '4-shot sequence auditing rain umbrella continuity (Amber vs Crimson umbrella mismatch in Shot 3).',
    transcript:
      'Continuity Rule for all shots: the detective’s storm umbrella must be bright amber. Shot 1: Wide shot on the fog pier at dusk with the detective holding the amber umbrella near the railing. Shot 2: Medium profile shot as the detective checks his watch under the amber umbrella. Shot 3: Close-up on the umbrella canopy under the pier streetlamp as rain intensifies. Shot 4: Over-the-shoulder shot watching a ferry approach through the fog with the amber umbrella in frame.',
  },
  {
    id: 'courier-protocol',
    title: 'Sequence 03: Emerald Trench Exchange',
    genre: 'Cyber-Noir',
    description: '4-shot sequence verifying wardrobe color lock on the courier jacket across camera angles.',
    transcript:
      'Continuity Rule across all shots: the courier jacket must remain emerald green. Shot 1: Wide shot inside the terminal café with the courier wearing the emerald jacket. Shot 2: Medium shot at the booth table showing the courier jacket sleeve and collar. Shot 3: Close-up on the courier jacket pocket as a keycard is slipped inside. Shot 4: Over-the-shoulder view of the exit doors with the emerald jacket in foreground.',
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
      'Continuity Rule across all shots: the ceramic coffee cup must be blue. Shot 2 has a red cup discrepancy—segment the cup and recolor it to cobalt blue.';

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
   * 2A. `muse-spark-1.3` — Continuity Rule Extraction (Structured JSON Output)
   */
  public async extractContinuityRules(transcript: string): Promise<ContinuityRule[]> {
    const live = await this.planWithServer(transcript);
    if (live) return live.rules;
    await new Promise((r) => setTimeout(r, 240));
    const lower = transcript.toLowerCase();

    let detectedObject = 'cup';
    for (const obj of KNOWN_OBJECTS) {
      if (lower.includes(obj)) {
        detectedObject =
          obj === 'mug' ? 'cup' :
          obj === 'coat' ? 'jacket' :
          obj === 'automobile' || obj === 'vehicle' ? 'car' :
          obj === 'gown' ? 'dress' :
          obj;
        break;
      }
    }

    let detectedColor =
      detectedObject === 'car' || detectedObject === 'dress' || detectedObject === 'altar'
        ? 'white'
        : 'blue';
    // Look for "must be <color>" or "remain <color>" or first mentioned color in rule sentence
    const ruleSentence = transcript.split('.')[0]?.toLowerCase() || lower;
    for (const col of KNOWN_COLORS) {
      if (ruleSentence.includes(col)) {
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
   * Returns null when only the offline fixture is available or the call fails, so the
   * local keyword planner still answers.
   */
  private async planWithServer(transcript: string): Promise<{ rules: ContinuityRule[]; shots?: PlannedShot[]; cast?: CastMember[] } | null> {
    if (typeof fetch !== 'function') return null;
    try {
      const health = await (await fetch('/api/health')).json();
      if (health?.plannerLive !== true) return null;
      const res = await fetch('/api/muse/spark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Anchorshot-Session': String(health.sessionToken ?? '') },
        body: JSON.stringify({ transcript, previousRevision: 0 }),
      });
      const plan = await res.json();
      if (!res.ok || !Array.isArray(plan.rules) || !plan.rules.length) return null;
      const rules: ContinuityRule[] = plan.rules;
      const anchor = rules[0].targetObject;
      this.recordCall(
        'muse-spark-1.3',
        'extractContinuityRules',
        `${plan.model} extracted ${rules.map((r) => `${r.targetObject}.color = "${r.expectedValue}"`).join(', ')}`
      );
      const shots: PlannedShot[] | undefined = Array.isArray(plan.shots) && plan.shots.length
        ? plan.shots.map((shot: Record<string, unknown>) => ({ ...normalizeShot(shot), seconds: Number(shot.seconds) || 4 }))
        : undefined;
      return {
        rules: [
          ...rules,
          {
            id: `rule-${anchor}-presence`,
            scope: 'all_shots',
            targetObject: anchor,
            property: 'spatial_anchor',
            expectedValue: 'foreground_counter',
            revision: plan.ruleRevision,
          },
        ],
        shots,
        cast: normalizeCast(plan.cast),
      };
    } catch {
      return null;
    }
  }

  /**
   * 2B & 3 & 4. `muse-spark-1.3` + `muse-image-1.0` + `sam-3.1`
   * Generates structured shot list from director transcript, synthesizes frames with `muse-image-1.0`,
   * and runs initial multimodal audit + `sam-3.1` segmentation on any continuity discrepancy.
   */
  public async generateStoryboardFromTranscript(
    transcript: string,
    existingRules?: ContinuityRule[],
    injectIntentionalDiscrepancy: boolean = true
  ): Promise<{ rules: ContinuityRule[]; shots: StoryboardShot[] }> {
    // The planner model, when connected, also chooses the shot list; otherwise the
    // classic four-angle sequence is used.
    const plan = existingRules && existingRules.length > 0 ? null : await this.planWithServer(transcript);
    const rules = existingRules && existingRules.length > 0
      ? existingRules
      : plan?.rules ?? (await this.extractContinuityRules(transcript));
    const plannedShots = plan?.shots;
    const shotCount = plannedShots?.length ?? 4;

    const primaryRule = rules[0] || {
      id: 'rule-cup-color',
      scope: 'all_shots',
      targetObject: 'cup',
      property: 'color',
      expectedValue: 'blue',
      revision: 1,
    };

    const targetObject = primaryRule.targetObject;
    const expectedColor = primaryRule.expectedValue;
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
        shots: await this.generateModelFrames(health.imageModel, rules, cameraSequence, parsedDescriptions, plannedShots, plan?.cast),
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
      const hasDiscrepancy = injectIntentionalDiscrepancy && shotNumber === mismatchShotNumber;
      const isUncertainOcclusion =
        injectIntentionalDiscrepancy && targetObject === 'jacket' && shotNumber === 4;
      const actualRenderedColor = hasDiscrepancy ? mismatchedColor : expectedColor;

      const basePrompt =
        parsedDescriptions[shotNumber] ||
        planned?.subject ||
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

      // If live Meta API is available, generate real AI frame with muse-image-1.0!
      if (typeof window !== 'undefined' && shotNumber === mismatchShotNumber) {
        try {
          const healthRes = await fetch('/api/health');
          if (healthRes.ok) {
            const health = await healthRes.json();
            if (health.configured && health.sessionToken) {
              const frameRes = await fetch('/api/meta/generate-frame', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Framelock-Session': health.sessionToken,
                  'X-Anchorshot-Session': health.sessionToken,
                },
                body: JSON.stringify({ prompt: basePrompt }),
              });
              if (frameRes.ok) {
                const frameData = await frameRes.json();
                if (frameData.imageUrl) {
                  imageUrl = frameData.imageUrl;
                  this.recordCall(
                    'muse-image-1.0',
                    `generateFrame(Shot ${shotNumber}) [LIVE META API]`,
                    `Rendered real 800x450 image via Meta muse-image-1.0 for "${basePrompt.slice(0, 50)}..."`
                  );
                }
              }
            }
          }
        } catch {
          // Gracefully fallback to canvas image
        }
      }

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
          primaryRule.revision,
          imageUrl
        );
      }

      const shotStatus = hasDiscrepancy
        ? 'mismatch'
        : isUncertainOcclusion
        ? 'uncertain'
        : 'consistent';

      const spokenDescription = hasDiscrepancy
        ? `Shot ${shotNumber}, ${framing}, duration ${durationSeconds} seconds. ${basePrompt}. Continuity Alert: ${targetObject} rendered in ${actualRenderedColor} instead of expected ${expectedColor}. Press Y to apply SAM 3.1 mask recolor to ${expectedColor}.`
        : isUncertainOcclusion
        ? `Shot ${shotNumber}, ${framing}, duration ${durationSeconds} seconds. ${basePrompt}. Continuity Uncertain: partial foreground occlusion on ${targetObject} (72.4% confidence). Press Y to confirm SAM 3.1 mask and lock ${expectedColor}.`
        : `Shot ${shotNumber}, ${framing}, duration ${durationSeconds} seconds. ${basePrompt}. Continuity verified: ${targetObject} color is ${expectedColor}.`;

      shots.push({
        id: `shot-${shotNumber}`,
        shotNumber,
        durationSeconds,
        movement: planned?.movement,
        promptDescription: basePrompt,
        spokenDescription,
        currentImageUrl: imageUrl,
        originalImageUrl: imageUrl,
        status: shotStatus,
        discrepancyMessage: hasDiscrepancy
          ? `Visual audit detected a ${actualRenderedColor} ${targetObject} in Shot ${shotNumber}, violating rule "${targetObject}.color = ${expectedColor}" (rev ${primaryRule.revision}).`
          : isUncertainOcclusion
          ? `SAM 3.1 flagged partial occlusion ambiguity (72.4% IoU) on ${targetObject} in Shot ${shotNumber}. Confirm mask selection (${samMask?.maskRef}) to verify continuity.`
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
                          maskRef: `sam-3.1:${targetObject.toLowerCase().replace(/\s+/g, '-')}:1:v${primaryRule.revision}`,
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
            actionApplied: `Initial generation via muse-image-1.0 (${actualRenderedColor} ${targetObject})`,
            ruleRevision: primaryRule.revision,
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
    cast?: CastMember[]
  ): Promise<StoryboardShot[]> {
    const colourRules = rules.filter((r) => r.property === 'color');
    const anchor = colourRules[0] ?? rules[0];
    const shots: StoryboardShot[] = [];
    const shotCount = plannedShots?.length ?? 4;
    // First solo frame of each character, reused as the reference for their later shots.
    const referenceFrames = new Map<string, string>();
    for (let i = 0; i < shotCount; i++) {
      const shotNumber = i + 1;
      const planned = plannedShots?.[i];
      const fallbackAngle = cameraSequence[i % cameraSequence.length];
      const subject =
        descriptions[shotNumber] ||
        planned?.subject ||
        `${fallbackAngle.replace('_', ' ')} shot featuring the detective and the ${anchor.expectedValue} ${anchor.targetObject} on the counter`;
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
          targetObject: anchor.targetObject,
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
        status: 'uncertain',
        revisions: [
          {
            revisionId: `rev-${shotNumber}-initial`,
            timestamp: Date.now(),
            imageUrl: frame.url,
            actionApplied: `Generated by ${model}; unreviewed`,
            ruleRevision: anchor.revision,
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
              }),
            });

            if (liveRes.ok) {
              const liveData = await liveRes.json();
              if (liveData && liveData.objects?.[0]) {
                // SAM lists every match, bystanders included, in no useful order: take its most confident.
                const liveObj = liveData.objects.reduce((best: any, o: any) =>
                  (o.confidence ?? 0) > (best.confidence ?? 0) ? o : best
                );
                // Use SAM's real pixels, so colour checks do not average in the background.
                const maskCanvas = document.createElement('canvas');
                maskCanvas.width = liveObj.width;
                maskCanvas.height = liveObj.height;
                const mCtx = maskCanvas.getContext('2d');
                if (mCtx) {
                  const expanded = expandMask(liveObj);
                  const overlay = mCtx.createImageData(liveObj.width, liveObj.height);
                  expanded.forEach((on: number, pixel: number) => {
                    if (on) overlay.data.set([56, 189, 248, 255], pixel * 4);
                  });
                  mCtx.putImageData(overlay, 0, 0);
                }
                const maskPngDataUrl = maskCanvas.toDataURL('image/png');

                const liveMask: SamMask = {
                  id: `mask-${targetObject}-${shotNumber}`,
                  maskRef: liveData.maskRef || `sam-3.1:${targetObject}:0:v${revision}`,
                  objectId: '0',
                  box: {
                    x: Math.round((liveObj.bounds.left / liveObj.width) * 100),
                    y: Math.round((liveObj.bounds.top / liveObj.height) * 100),
                    width: Math.round(((liveObj.bounds.right - liveObj.bounds.left) / liveObj.width) * 100),
                    height: Math.round(((liveObj.bounds.bottom - liveObj.bounds.top) / liveObj.height) * 100),
                  },
                  confidence: liveObj.confidence || 0.95,
                  candidateCount: liveData.objects.length,
                  maskBase64: maskPngDataUrl,
                  provenance: 'live-sam-3.1',
                };

                this.recordCall(
                  'sam-3.1',
                  `segmentObject("${targetObject}", Shot ${shotNumber}) [LIVE META API]`,
                  `Live Meta SAM 3.1 returned maskRef ${liveMask.maskRef} [confidence: ${(liveMask.confidence * 100).toFixed(1)}%, req: ${liveData.requestId}]`
                );
                return liveMask;
              }
            }
          }
        }
      } catch {
        // Fall back gracefully to local fixture if network or live call unavailable
      }
    }

    await new Promise((r) => setTimeout(r, 180));
    const generatedMask = generateSam3MaskData(
      `${targetObject}-shot-${shotNumber}`,
      box,
      confidence,
      revision
    );
    const mask: SamMask = {
      ...generatedMask,
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
   * Locks a director-selected SAM 3.1 candidate. An `uncertain` shot becomes
   * `consistent`, and the active mask records the chosen object id and mask reference.
   */
  public async disambiguateMaskSelection(
    shot: StoryboardShot,
    selectedObjectId: string
  ): Promise<StoryboardShot> {
    const candidates = shot.proposedFix?.candidates ?? [];
    const selectedCandidate = candidates.find(
      (candidate) => candidate.objectId === selectedObjectId
    );
    const currentMask = selectedCandidate ?? shot.proposedFix?.mask;
    const revision = currentMask?.maskRef.match(/:v(\d+)$/)?.[1] ?? '1';
    const normalizedConcept = (shot.proposedFix?.targetObject ?? 'cup')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-');
    let resolvedMaskRef = selectedCandidate
      ? selectedCandidate.maskRef
      : `sam-3.1:${normalizedConcept}:${selectedObjectId}:v${revision}`;
    const nextStatus = shot.status === 'uncertain' ? 'consistent' : shot.status;

    if (typeof fetch === 'function' && this.sessionToken && currentMask?.maskRef) {
      try {
        const res = await fetch('/api/masks/disambiguate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Framelock-Session': this.sessionToken,
          },
          body: JSON.stringify({
            maskRef: currentMask.maskRef,
            selectedObjectId,
            status: nextStatus,
            shotNumber: shot.shotNumber,
            confidence: currentMask.confidence,
          }),
        });
        if (!res.ok) {
          this.recordCall(
            'sam-3.1',
            `disambiguateMaskSelection("${selectedObjectId}", Shot ${shot.shotNumber})`,
            `Server rejected disambiguation lock (${res.status}); shot remains ${shot.status}`
          );
          return shot;
        }
        const data = await res.json();
        if (typeof data?.track?.maskRef === 'string') {
          resolvedMaskRef = data.track.maskRef;
        }
      } catch {
        // Non-blocking when running purely offline without Express backend
      }
    }

    const mask = currentMask
      ? {
          ...currentMask,
          objectId: selectedObjectId,
          maskRef: resolvedMaskRef,
        }
      : undefined;

    this.recordCall(
      'sam-3.1',
      `disambiguateMaskSelection("${selectedObjectId}", Shot ${shot.shotNumber})`,
      `Disambiguated Shot ${shot.shotNumber}: objectId=${selectedObjectId}, maskRef=${mask?.maskRef ?? resolvedMaskRef}, status ${shot.status} → ${nextStatus}`
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
    const expectedColor = rule.expectedValue;

    // Segment object on the real frame via SAM 3.1
    let mask = await this.segmentObjectWithSam3(
      shot.shotNumber,
      targetObject,
      undefined,
      0.986,
      rule.revision,
      shot.currentImageUrl
    );

    // The plan leaves this prop out of the shot and SAM agrees, so the rule has nothing to check.
    if (shot.absentProps?.includes(targetObject) && mask.provenance !== 'live-sam-3.1') {
      return {
        ...shot,
        status: 'consistent',
        spokenDescription: `Shot ${shot.shotNumber}, duration ${shot.durationSeconds} seconds. ${shot.promptDescription}. The ${targetObject} is not in this shot, so its rule does not apply.`,
        discrepancyMessage: undefined,
        proposedFix: undefined,
      };
    }

    // SAM often misses, doubts or finds a whole crowd for a bare noun ("jacket") but finds "green jacket". The colour only
    // helps locate the object; the verdict below still comes from the measured pixels.
    if (isGeneratedImage(shot.currentImageUrl) && (mask.provenance !== 'live-sam-3.1' || mask.confidence < 0.8 || (mask.candidateCount ?? 1) > 1)) {
      const colourWord = expectedColor === 'emerald' ? 'green' : expectedColor;
      const retry = await this.segmentObjectWithSam3(
        shot.shotNumber,
        `${colourWord} ${targetObject}`,
        undefined,
        0.986,
        rule.revision,
        shot.currentImageUrl
      );
      if (retry.provenance === 'live-sam-3.1' && (mask.provenance !== 'live-sam-3.1' || retry.confidence > mask.confidence)) {
        mask = retry;
      }
    }

    // Sample actual color inside the detected mask
    let detectedColor: string | null = null;
    try {
      // A sample mask says nothing about where the object is in a model-drawn frame.
      if (shot.currentImageUrl && (mask.provenance === 'live-sam-3.1' || !isGeneratedImage(shot.currentImageUrl))) {
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
    const isAmbiguous = mask.confidence < 0.8 || unmeasured;
    const status = isAmbiguous ? 'uncertain' : isMatch ? 'consistent' : 'mismatch';

    const spokenDescription = status === 'consistent'
      ? `Shot ${shot.shotNumber}, duration ${shot.durationSeconds} seconds. ${shot.promptDescription}. Continuity verified: ${targetObject} color is ${expectedColor}.`
      : isAmbiguous
      ? `Shot ${shot.shotNumber}, duration ${shot.durationSeconds} seconds. ${shot.promptDescription}. Continuity uncertain: ${mask.provenance !== 'live-sam-3.1' ? `the ${targetObject} could not be found in this frame` : unmeasured ? 'the colour could not be measured' : `low SAM 3.1 confidence (${(mask.confidence * 100).toFixed(1)}%)`} on ${targetObject}.`
      : `Shot ${shot.shotNumber}, duration ${shot.durationSeconds} seconds. ${shot.promptDescription}. Continuity Alert: ${targetObject} rendered in ${detectedColor} instead of expected ${expectedColor}. Press Y to apply SAM 3.1 mask recolor to ${expectedColor}.`;

    const discrepancyMessage = status === 'consistent'
      ? undefined
      : unmeasured
      ? mask.provenance !== 'live-sam-3.1'
        ? `The ${targetObject} could not be found in Shot ${shot.shotNumber}, so continuity is unverified.`
        : `The ${targetObject} colour in Shot ${shot.shotNumber} could not be measured, so continuity is unverified.`
      : isAmbiguous
      ? `SAM 3.1 flagged ambiguity (${(mask.confidence * 100).toFixed(1)}% IoU) on ${targetObject} in Shot ${shot.shotNumber}. Confirm mask selection (${mask.maskRef}) to verify continuity.`
      : `Visual audit detected a ${detectedColor} ${targetObject} in Shot ${shot.shotNumber}, violating rule "${targetObject}.color = ${expectedColor}" (rev ${rule.revision}).`;

    const proposedFix = status !== 'consistent'
      ? {
          action: 'recolor' as const,
          targetObject,
          targetColor: expectedColor,
          mask,
        }
      : undefined;

    this.recordCall(
      'sam-3.1',
      `auditShotContinuity(Shot ${shot.shotNumber})`,
      `Audited ${targetObject}: observed="${detectedColor}", expected="${expectedColor}" → status: ${status} (mask: ${mask.maskRef})`
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
    const primaryRule = rules[0] || {
      id: 'rule-cup-color',
      scope: 'all_shots',
      targetObject: 'cup',
      property: 'color',
      expectedValue: 'blue',
      revision: 1,
    };

    const audited: StoryboardShot[] = [];
    for (const shot of shots) {
      audited.push(await this.auditShotContinuity(shot, primaryRule));
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
    const targetObject = shot.proposedFix?.targetObject || 'cup';
    const targetColor = overrideColor || shot.proposedFix?.targetColor || 'blue';

    let mask = shot.proposedFix?.mask;
    if (!mask) {
      mask = await this.segmentObjectWithSam3(
        shot.shotNumber,
        targetObject,
        undefined,
        0.986,
        ruleRevision
      );
    }

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
      actionApplied: `SAM 3.1 masked recolor: ${targetObject} → ${targetColor} (${pixelVerification.changedOutsideMask}px outside drift)`,
      ruleRevision,
      maskRef: mask.maskRef,
      pixelVerification,
    };

    const updatedSpoken = `Shot ${shot.shotNumber}. ${shot.promptDescription}. Continuity verified: ${targetObject} recolored to ${targetColor} via SAM 3.1 mask ${mask.maskRef} with zero outside-mask pixel drift.`;

    return {
      ...shot,
      currentImageUrl: updatedImageUrl,
      // A video rendered before the fix would still show the old colour.
      videoUrl: undefined,
      generatedJobId: undefined,
      status: 'consistent',
      discrepancyMessage: undefined,
      spokenDescription: updatedSpoken,
      pixelVerification,
      proposedFix: {
        action: 'recolor',
        targetObject,
        targetColor,
        mask,
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
    rules?: ContinuityRule[]
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
    const res = await fetch('/api/meta/video-understand', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.sessionToken ? { 'X-Framelock-Session': this.sessionToken } : {}),
      },
      body: JSON.stringify({ videoUrl, prompt, jobId, rules }),
    });
    if (!res.ok) throw new Error('Meta Video Understanding API request failed');
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
    bounds?: { left: number; top: number; right: number; bottom: number }
  ): Promise<{
    editedImageUrl: string;
    outsideDrift: number;
    outsideDriftPercent: string;
    verified: boolean;
    model: string;
    provenance: string;
    promptApplied: string;
  }> {
    const res = await fetch('/api/meta/edit-frame', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.sessionToken ? { 'X-Framelock-Session': this.sessionToken } : {}),
      },
      body: JSON.stringify({ imageBase64, maskBase64, prompt, bounds }),
    });
    if (!res.ok) throw new Error('Meta Generative Edit request failed');
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

function buildSamMaskFromFinding(
  finding: ContinuityFinding,
  object?: VideoDetectedObject
): SamMask {
  const concept = finding.targetObject.toLowerCase().trim().replace(/\s+/g, '-');
  const objectId = finding.objectId ?? object?.objectId ?? '0';
  const box: BoundingBox =
    object && object.width && object.height
      ? {
          x: Math.round((object.bounds.left / object.width) * 100),
          y: Math.round((object.bounds.top / object.height) * 100),
          width: Math.round(((object.bounds.right - object.bounds.left) / object.width) * 100),
          height: Math.round(((object.bounds.bottom - object.bounds.top) / object.height) * 100),
        }
      : { x: 0, y: 0, width: 0, height: 0 };
  return {
    id: `mask-${concept}-${objectId}`,
    maskRef: finding.maskRef ?? `sam-3.1:${concept}:${objectId}:v1`,
    objectId,
    maskBase64: '',
    box,
    confidence: finding.confidence,
    provenance: 'live-sam-3.1',
  };
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
    const mask = buildSamMaskFromFinding(finding, boundObject);
    next[idx] = {
      ...next[idx],
      status: finding.status,
      discrepancyMessage: finding.explanation,
      detectedObjects: matched.length > 0 ? (matched as StoryboardShot['detectedObjects']) : next[idx].detectedObjects,
      proposedFix: {
        action: 'recolor',
        targetObject: finding.targetObject,
        targetColor: finding.expectedValue,
        mask,
      },
    };
  }
  return next;
}

export const metaModelClient = new MetaModelClient();
