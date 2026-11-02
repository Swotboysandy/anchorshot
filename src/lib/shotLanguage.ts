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
  /** Names of the cast on screen in this shot. */
  cast?: string[];
}

/** Fixed look for one character, repeated in every frame they appear in (Fylmer's cast brief). */
export interface CastMember {
  name: string;
  age?: string;
  build?: string;
  features?: string;
  wardrobe?: string;
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Keeps usable cast briefs from model output; a character needs a name and some visible detail. */
export function normalizeCast(raw: unknown): CastMember[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const c = (item ?? {}) as Record<string, unknown>;
      return { name: text(c.name, 60), age: text(c.age, 30), build: text(c.build, 80), features: text(c.features, 200), wardrobe: text(c.wardrobe, 200) };
    })
    .filter((c) => c.name && (c.features || c.wardrobe))
    .slice(0, 6);
}

const describeCast = (c: CastMember) =>
  `${c.name}: ${[c.age, c.build, c.features, c.wardrobe && `wearing ${c.wardrobe}`].filter(Boolean).join(', ')}`;

/** Cast listed on the shot, or named in its subject when the model did not list them. */
function castInShot(shot: ShotSpec, cast: CastMember[]): CastMember[] {
  const named = (shot.cast ?? []).map((n) => n.toLowerCase());
  const subject = shot.subject.toLowerCase();
  return cast.filter((c) => named.includes(c.name.toLowerCase()) || subject.includes(c.name.toLowerCase()));
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
    ...(Array.isArray(raw.cast) ? { cast: raw.cast.filter((n): n is string => typeof n === 'string').slice(0, 6) } : {}),
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
 * Builds a frame prompt. The identity lock leads, then fixed blocks (style, continuity, set), then the one
 * block that varies per shot, then the locks and house look. Continuity comes first
 * because image models weight early text most (verified in Fylmer's A/B).
 */
export function buildShotPrompt(options: {
  shot: ShotSpec;
  continuity?: ContinuityAnchor[];
  cast?: CastMember[];
  setting?: string;
  style?: string;
  avoid?: string;
}): string {
  const { shot } = options;
  // With a known cast, a prop rule only applies where the prop is in the shot; otherwise
  // "the jacket is emerald" dresses whoever is on screen in that jacket.
  const inShot = castInShot(shot, options.cast ?? []);
  const shotText = [shot.subject, ...inShot.map((c) => `${c.wardrobe} ${c.features}`)].join(' ').toLowerCase();
  const anchors = (options.continuity ?? [])
    .filter((rule) => !options.cast?.length || shotText.includes(rule.targetObject.toLowerCase()))
    .map(
    (rule) => `The ${rule.targetObject} is ${rule.expectedValue}: the same ${rule.targetObject}, same colour, in every shot.`,
  );
  const shotLine = [
    `${shot.size} shot, ${shot.angle.toLowerCase()} angle, ${shot.lens}, ${shot.movement.toLowerCase()} camera.`,
    shot.subject ? `${shot.subject.replace(/\.$/, '')}.` : '',
    `${shot.light} lighting, ${shot.temp.toLowerCase()} palette.`,
  ]
    .filter(Boolean)
    .join(' ');
  const onScreen = inShot;
  const identity = onScreen.length
    ? `IDENTITY LOCK\n${onScreen.map(describeCast).join('\n')}\nThe same ${onScreen.length === 1 ? 'individual' : 'individuals'} in every shot: same face and facial structure, same skin tone, same hair, same wardrobe and headwear, not a look-alike or a different actor. Exactly ${onScreen.length} ${onScreen.length === 1 ? 'person' : 'distinct people'} from this list; never duplicate them.`
    : '';
  return [
    identity,
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
