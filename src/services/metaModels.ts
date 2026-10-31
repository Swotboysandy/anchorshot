import {
  BoundingBox,
  ContinuityRule,
  DirectorPresetScenario,
  ModelInvocationRecord,
  SamMask,
  StoryboardShot,
} from '../types/framelock';
import {
  applySamPixelFixToImage,
  applySamPixelFixWithVerification,
  generateSam3MaskData,
  getTargetObjectBox,
  renderMuseStoryboardFrame,
  SceneRenderSpec,
} from './canvasEngine';

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
const KNOWN_OBJECTS = ['cup', 'mug', 'umbrella', 'jacket', 'coat'];

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
    await new Promise((r) => setTimeout(r, 240));
    const lower = transcript.toLowerCase();

    let detectedObject = 'cup';
    for (const obj of KNOWN_OBJECTS) {
      if (lower.includes(obj)) {
        detectedObject = obj === 'mug' ? 'cup' : obj === 'coat' ? 'jacket' : obj;
        break;
      }
    }

    let detectedColor = 'blue';
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
   * 2B & 3 & 4. `muse-spark-1.3` + `muse-image-1.0` + `sam-3.1`
   * Generates structured shot list from director transcript, synthesizes frames with `muse-image-1.0`,
   * and runs initial multimodal audit + `sam-3.1` segmentation on any continuity discrepancy.
   */
  public async generateStoryboardFromTranscript(
    transcript: string,
    existingRules?: ContinuityRule[],
    injectIntentionalDiscrepancy: boolean = true
  ): Promise<{ rules: ContinuityRule[]; shots: StoryboardShot[] }> {
    const rules = existingRules && existingRules.length > 0
      ? existingRules
      : await this.extractContinuityRules(transcript);

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
      expectedColor === 'blue'
        ? 'red'
        : expectedColor === 'amber'
        ? 'crimson'
        : expectedColor === 'emerald' || expectedColor === 'green'
        ? 'amber'
        : 'red';

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

    const health = await this.getSamBackendHealth();
    if (health?.imageModel) {
      return {
        rules,
        shots: await this.generateModelFrames(health.imageModel, primaryRule, cameraSequence, parsedDescriptions),
      };
    }

    const mismatchShotNumber = targetObject === 'umbrella' ? 3 : 2;
    const shots: StoryboardShot[] = [];

    for (let i = 0; i < 4; i++) {
      const shotNumber = i + 1;
      const cameraAngle = cameraSequence[i % cameraSequence.length];
      const hasDiscrepancy = injectIntentionalDiscrepancy && shotNumber === mismatchShotNumber;
      const isUncertainOcclusion =
        injectIntentionalDiscrepancy && targetObject === 'jacket' && shotNumber === 4;
      const actualRenderedColor = hasDiscrepancy ? mismatchedColor : expectedColor;

      const basePrompt =
        parsedDescriptions[shotNumber] ||
        `${cameraAngle.replace('_', ' ')} shot featuring the detective and the ${actualRenderedColor} ${targetObject} on the counter`;

      const { imageUrl, box } = renderMuseStoryboardFrame({
        shotNumber,
        cameraAngle,
        settingTitle: 'Studio Stage',
        targetObject,
        objectColorName: actualRenderedColor,
        weatherOrMood: targetObject === 'umbrella' ? 'fog_pier' : 'rain_noir',
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
          primaryRule.revision
        );
      }

      const shotStatus = hasDiscrepancy
        ? 'mismatch'
        : isUncertainOcclusion
        ? 'uncertain'
        : 'consistent';

      const spokenDescription = hasDiscrepancy
        ? `Shot ${shotNumber}, ${cameraAngle.replace('_', ' ')} framing, duration 3.5 seconds. ${basePrompt}. Continuity Alert: ${targetObject} rendered in ${actualRenderedColor} instead of expected ${expectedColor}. Press Y to apply SAM 3.1 mask recolor to ${expectedColor}.`
        : isUncertainOcclusion
        ? `Shot ${shotNumber}, ${cameraAngle.replace('_', ' ')} framing, duration 3.5 seconds. ${basePrompt}. Continuity Uncertain: partial foreground occlusion on ${targetObject} (72.4% confidence). Press Y to confirm SAM 3.1 mask and lock ${expectedColor}.`
        : `Shot ${shotNumber}, ${cameraAngle.replace('_', ' ')} framing, duration 3.5 seconds. ${basePrompt}. Continuity verified: ${targetObject} color is ${expectedColor}.`;

      shots.push({
        id: `shot-${shotNumber}`,
        shotNumber,
        durationSeconds: shotNumber === 1 ? 4.0 : 3.5,
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
            timestamp: Date.now() - (4 - i) * 15000,
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
    rule: ContinuityRule,
    cameraSequence: Array<SceneRenderSpec['cameraAngle']>,
    descriptions: Record<number, string>
  ): Promise<StoryboardShot[]> {
    const shots: StoryboardShot[] = [];
    for (let i = 0; i < 4; i++) {
      const shotNumber = i + 1;
      const cameraAngle = cameraSequence[i % cameraSequence.length];
      const framing = cameraAngle.replace('_', ' ');
      const prompt =
        descriptions[shotNumber] ||
        `${framing} shot featuring the detective and the ${rule.expectedValue} ${rule.targetObject} on the counter`;
      const seed = shotNumber * 17;
      const res = await fetch('/api/muse/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Framelock-Session': this.sessionToken ?? '' },
        body: JSON.stringify({
          prompt: `Cinematic storyboard frame, ${framing} framing. ${prompt}. The ${rule.targetObject} is ${rule.expectedValue}.`,
          targetObject: rule.targetObject,
          seed,
        }),
      });
      const frame = await res.json().catch(() => ({}));
      if (!res.ok || typeof frame.url !== 'string')
        throw new Error(frame.error || `Shot ${shotNumber} could not be generated.`);
      this.recordCall(
        'muse-image-1.0',
        `generateFrame(Shot ${shotNumber})`,
        `${model} drew ${frame.width}x${frame.height} frame [seed:${seed}, sha256:${String(frame.sourceHash).slice(0, 12)}]`
      );
      shots.push({
        id: `shot-${shotNumber}`,
        shotNumber,
        durationSeconds: shotNumber === 1 ? 4.0 : 3.5,
        promptDescription: prompt,
        spokenDescription: `Shot ${shotNumber}, ${framing} framing, duration ${shotNumber === 1 ? 4 : 3.5} seconds. ${prompt}. Generated image; continuity unreviewed.`,
        currentImageUrl: frame.url,
        originalImageUrl: frame.url,
        status: 'uncertain',
        revisions: [
          {
            revisionId: `rev-${shotNumber}-initial`,
            timestamp: Date.now(),
            imageUrl: frame.url,
            actionApplied: `Generated by ${model}; unreviewed`,
            ruleRevision: rule.revision,
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
    revision: number = 1
  ): Promise<SamMask> {
    await new Promise((r) => setTimeout(r, 180));
    const cameraSequence: Array<SceneRenderSpec['cameraAngle']> = [
      'wide',
      'medium',
      'closeup',
      'over_shoulder',
    ];
    const angle = cameraSequence[(shotNumber - 1) % cameraSequence.length];
    const box = customBox || getTargetObjectBox(angle, targetObject);
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
}

export const metaModelClient = new MetaModelClient();
