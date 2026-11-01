export const DURATION = 20;
export const SCENES = [
  {
    id: 'kitchen',
    title: 'The familiar',
    place: 'A quiet kitchen',
    caption: 'I was holding my red mug in the kitchen.',
  },
  {
    id: 'ocean',
    title: 'The impossible',
    place: 'An endless ocean',
    caption: 'I opened a door. On the other side was an ocean.',
  },
  {
    id: 'moon',
    title: 'The unexpected',
    place: 'Under another moon',
    caption: 'Beyond the water, the moon was waiting.',
  },
] as const;
export type Transition = 'doorway' | 'dissolve';

// The shared animation guidance's on-screen movement curve: (0.77, 0, 0.175, 1).
export function portalEase(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 18; i++) {
    const t = (lo + hi) / 2;
    const x = 3 * (1 - t) ** 2 * t * 0.77 + 3 * (1 - t) * t ** 2 * 0.175 + t ** 3;
    if (x < progress) lo = t;
    else hi = t;
  }
  const t = (lo + hi) / 2;
  return 3 * (1 - t) * t ** 2 + t ** 3;
}

export function timelineAt(seconds: number) {
  const time = Number.isFinite(seconds) ? Math.max(0, Math.min(DURATION, seconds)) : 0;
  const segment = DURATION / 3;
  const index = Math.min(2, Math.floor(time / segment));
  const local = (time - index * segment) / segment;
  const blend = index < 2 ? portalEase(Math.max(0, (local - 0.68) / 0.32)) : 0;
  return { time, index, next: Math.min(2, index + 1), blend };
}

export function clockLabel(seconds: number) {
  return `00:${Math.floor(Math.max(0, Math.min(DURATION, seconds)))
    .toString()
    .padStart(2, '0')}`;
}

export interface SceneImage {
  name: string;
  data: string;
}
export interface DreamPlan {
  version: 1;
  story: string;
  titles: string[];
  images: (SceneImage | null)[];
  captions: string[];
  anchor: boolean;
  transition: Transition;
  reducedMotion: boolean;
}
export const DEFAULT_PLAN: DreamPlan = {
  version: 1,
  titles: SCENES.map((scene) => scene.place),
  images: [null, null, null],
  story: SCENES.map((scene) => scene.caption).join('\n\n'),
  captions: SCENES.map((scene) => scene.caption),
  anchor: true,
  transition: 'doorway',
  reducedMotion: false,
};
export function readPlan(value: unknown): DreamPlan | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Partial<DreamPlan>;
  if (
    p.version !== 1 ||
    typeof p.story !== 'string' ||
    p.story.length > 2000 ||
    !Array.isArray(p.captions) ||
    p.captions.length !== 3 ||
    p.captions.some((x) => typeof x !== 'string' || x.length > 160) ||
    (p.titles !== undefined &&
      (!Array.isArray(p.titles) ||
        p.titles.length !== 3 ||
        p.titles.some((title) => typeof title !== 'string' || title.length > 80))) ||
    (p.images !== undefined &&
      (!Array.isArray(p.images) ||
        p.images.length !== 3 ||
        p.images.some(
          (image) =>
            image !== null &&
            (!image ||
              typeof image.name !== 'string' ||
              image.name.length > 200 ||
              typeof image.data !== 'string' ||
              image.data.length > 1500000 ||
              !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image.data)),
        ))) ||
    typeof p.anchor !== 'boolean' ||
    typeof p.reducedMotion !== 'boolean' ||
    !['doorway', 'dissolve'].includes(p.transition ?? '')
  )
    return null;
  return {
    version: 1,
    story: p.story,
    titles: p.titles ? [...p.titles] : [...DEFAULT_PLAN.titles],
    images: p.images ? p.images.map((image) => (image ? { ...image } : null)) : [null, null, null],
    captions: [...p.captions],
    anchor: p.anchor,
    transition: p.transition!,
    reducedMotion: p.reducedMotion,
  };
}

/** Explicit editing operation: no inference or silent truncation. */
export function storyCaptions(story: string): string[] {
  const paragraphs = story
    .trim()
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, ' ').trim());
  if (paragraphs.length !== 3 || paragraphs.some((part) => !part || part.length > 160)) {
    throw new Error(
      'Write exactly three paragraphs, separated by blank lines, with up to 160 characters each.',
    );
  }
  return paragraphs;
}
