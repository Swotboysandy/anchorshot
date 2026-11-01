/**
 * Shot language shared by the planner (server) and frame generation (client).
 *
 * Vocabulary, presets and prompt block order are ported from Fylmer
 * (Nikku@6823c8dd: app/_components/inspectors/storyboard-shared.ts and the
 * storyboard generate route), adapted to AnchorShot's continuity rules.
 */

export const SHOT_SIZES = ['Establishing', 'Wide', 'Medium', 'Close', 'Extreme close', 'Over-shoulder', 'Two-shot', 'Insert'] as const;
export const ANGLES = ['Eye level', 'Low', 'High', 'Dutch', "Bird's eye", "Worm's eye"] as const;
export const LENSES = ['24mm', '35mm', '50mm', '85mm', '135mm'] as const;
export const MOVEMENTS = ['Locked', 'Pan', 'Tilt', 'Dolly', 'Handheld', 'Push in', 'Pull out', 'Whip'] as const;
export const LIGHTS = ['Natural', 'Golden hour', 'Overcast', 'Hard shadows', 'Low key', 'High key', 'Dawn', 'Dusk', 'Night'] as const;
export const COLOR_TEMPS = ['Cool', 'Neutral', 'Warm'] as const;

export type ShotSize = (typeof SHOT_SIZES)[number];
export type Angle = (typeof ANGLES)[number];
export type Lens = (typeof LENSES)[number];
export type Movement = (typeof MOVEMENTS)[number];
export type Light = (typeof LIGHTS)[number];
export type ColorTemp = (typeof COLOR_TEMPS)[number];

export interface ShotSpec {
  size: ShotSize;
  angle: Angle;
  lens: Lens;
  movement: Movement;
  light: Light;
  temp: ColorTemp;
  /** What the frame shows, in the director's terms. */
  subject: string;
  /** Why this shot exists in the scene, e.g. "establish the diner". */
  intent?: string;
}

/** Standard shot shorthands mapped to size, angle and lens (and movement where implied). */
export const SHOT_PRESETS: Record<string, Pick<ShotSpec, 'size' | 'angle' | 'lens'> & { movement?: Movement; label: string }> = {
  ECU: { label: 'Extreme close-up', size: 'Extreme close', angle: 'Eye level', lens: '85mm' },
  CU: { label: 'Close-up', size: 'Close', angle: 'Eye level', lens: '85mm' },
  MCU: { label: 'Medium close-up', size: 'Close', angle: 'Eye level', lens: '50mm' },
  MS: { label: 'Medium shot', size: 'Medium', angle: 'Eye level', lens: '50mm' },
  MLS: { label: 'Medium long shot', size: 'Medium', angle: 'Eye level', lens: '35mm' },
  WS: { label: 'Wide shot', size: 'Wide', angle: 'Eye level', lens: '24mm' },
  EWS: { label: 'Extreme wide, establishing', size: 'Establishing', angle: 'High', lens: '24mm' },
  OTS: { label: 'Over the shoulder', size: 'Over-shoulder', angle: 'Eye level', lens: '50mm' },
  POV: { label: 'Point of view', size: 'Medium', angle: 'Eye level', lens: '35mm', movement: 'Handheld' },
};

const pick = <T extends string>(options: readonly T[], value: unknown, fallback: T): T => {
  if (typeof value !== 'string') return fallback;
  const wanted = value.trim().toLowerCase();
  return options.find((option) => option.toLowerCase() === wanted) ?? fallback;
};

/** Coerces model or user input to the vocabulary; unknown values fall back to a neutral default. */
export function normalizeShot(raw: Partial<Record<keyof ShotSpec, unknown>>): ShotSpec {
  return {
    size: pick(SHOT_SIZES, raw.size, 'Medium'),
    angle: pick(ANGLES, raw.angle, 'Eye level'),
    lens: pick(LENSES, raw.lens, '35mm'),
    movement: pick(MOVEMENTS, raw.movement, 'Locked'),
    light: pick(LIGHTS, raw.light, 'Natural'),
    temp: pick(COLOR_TEMPS, raw.temp, 'Neutral'),
    subject: typeof raw.subject === 'string' ? raw.subject.trim().slice(0, 400) : '',
    intent: typeof raw.intent === 'string' && raw.intent.trim() ? raw.intent.trim().slice(0, 200) : undefined,
  };
}

/** House visual language appended to every frame; kept neutral so the director's scene leads. */
export const HOUSE_LOOK =
  'Filmic 35mm look: motivated, naturalistic lighting; shallow depth of field; gentle film grain; deliberate negative space with rule-of-thirds blocking. No text, captions, logos or watermarks.';

const ANTI_GRID =
  'One single frame depicting ONE moment: never a grid, collage, contact sheet, storyboard sheet, split screen or multiple panels.';

export interface ContinuityAnchor {
  targetObject: string;
  expectedValue: string;
}

/**
 * Builds a frame prompt. Fixed blocks lead (style, continuity, set), then the one
 * block that varies per shot, then the locks and house look. Continuity comes first
 * because image models weight early text most (verified in Fylmer's A/B).
 */
export function buildShotPrompt(options: {
  shot: ShotSpec;
  continuity?: ContinuityAnchor[];
  setting?: string;
  style?: string;
  avoid?: string;
}): string {
  const { shot } = options;
  const anchors = (options.continuity ?? []).map(
    (rule) => `The ${rule.targetObject} is ${rule.expectedValue}: the same ${rule.targetObject}, same colour, in every shot.`,
  );
  const shotLine = [
    `${shot.size} shot, ${shot.angle.toLowerCase()} angle, ${shot.lens}, ${shot.movement.toLowerCase()} camera.`,
    shot.subject ? `${shot.subject.replace(/\.$/, '')}.` : '',
    `${shot.light} lighting, ${shot.temp.toLowerCase()} palette.`,
  ]
    .filter(Boolean)
    .join(' ');
  return [
    options.style ? `STYLE LOCK\n${options.style}` : '',
    anchors.length ? `CONTINUITY\n${anchors.join(' ')}` : '',
    options.setting ? `SET\n${options.setting}` : '',
    `SHOT\n${shotLine}`,
    HOUSE_LOOK,
    ANTI_GRID,
    options.avoid ? `AVOID\n${options.avoid}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
