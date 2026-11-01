/**
 * Turns a spoken or typed director command into a typed intent.
 *
 * From BZcreativ's feat/claude-sam-meta (parse-then-switch voice router), merged
 * with main's fixes: colours limited to the continuity palette with cyan kept
 * distinct, shot numbers 1-8 including ordinals, narration only when the command
 * itself asks for it, and a bare colour updating the current rule's object.
 */

export type VoiceIntent =
  | { kind: 'playback'; action: 'play' | 'stop' }
  | { kind: 'help' }
  | { kind: 'audit' }
  | { kind: 'narrate' }
  | { kind: 'fix'; shotNumber?: number; color?: string; object?: string }
  | { kind: 'segment'; object: string; shotNumber?: number }
  | { kind: 'recolor'; object?: string; color: string; shotNumber?: number }
  | { kind: 'modify_video'; object: string; color: string }
  | { kind: 'generative_edit'; prompt: string; object?: string }
  | { kind: 'rule_update'; object?: string; color: string }
  | { kind: 'rebuild'; transcript: string };

const COLOR_MAP: Record<string, string> = {
  blue: 'blue', navy: 'blue', cobalt: 'blue', azure: 'blue',
  cyan: 'cyan', teal: 'cyan',
  red: 'red', crimson: 'red', scarlet: 'red', ruby: 'red',
  amber: 'amber', gold: 'amber', yellow: 'amber', orange: 'amber',
  emerald: 'emerald', green: 'emerald', lime: 'emerald',
  purple: 'purple', violet: 'purple', magenta: 'purple',
  white: 'white', ivory: 'white',
};
const COLORS = Object.keys(COLOR_MAP).join('|');

const NUMBER_WORDS: Record<string, number> = {
  one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4,
  five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8,
};
const NUMBERS = `[1-8]|${Object.keys(NUMBER_WORDS).join('|')}`;

const toShot = (raw?: string) => (raw ? (NUMBER_WORDS[raw.toLowerCase()] ?? Number(raw)) : undefined);

/** "shot 2", "scene #3", "the second shot". A bare number elsewhere is not a shot. */
function shotNumberIn(text: string): number | undefined {
  const match =
    text.match(new RegExp(`\\b(?:shot|scene|frame)\\s*#?\\s*(${NUMBERS})\\b`, 'i')) ??
    text.match(new RegExp(`#\\s*([1-8])\\b`)) ??
    text.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth)\s+(?:shot|scene|frame)\b/i);
  return toShot(match?.[1]);
}

const cleanObject = (noun: string) => noun.replace(/^(?:the|my|a|an|this|that)\s+/i, '').trim().toLowerCase();

export function parseVoiceCommand(rawText: string): VoiceIntent {
  const cleaned = rawText
    .replace(/\b(uh|um|please|can\s+you|could\s+you|would\s+you)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,!?;:]+|[\s.,!?;:]+$/g, '');
  const lower = cleaned.toLowerCase();
  if (!lower) return { kind: 'rebuild', transcript: '' };

  if (/^(?:play|resume|start\s+animatic)\b/.test(lower)) return { kind: 'playback', action: 'play' };
  if (/^(?:stop|pause)\b/.test(lower)) return { kind: 'playback', action: 'stop' };
  if (/\b(?:help|shortcuts?|hotkeys?|keybindings?)\b/.test(lower)) return { kind: 'help' };
  if (/\b(?:audit|check\s+continuity|verify\s+continuity)\b/.test(lower)) return { kind: 'audit' };
  // Narration must be the command itself, so story text containing "read" or "describe" still rebuilds.
  if (
    /^narrate\b/.test(lower) ||
    /^(?:read|tell|describe)\s+(?:(?:to\s+)?me\s+)?(?:the\s+)?(?:scene|shots?|storyboard|sequence|all)\b/.test(lower)
  )
    return { kind: 'narrate' };

  // "modify video cup to blue", "recolor video umbrella to amber", "track video car"
  const video = lower.match(new RegExp(`\\b(?:modify|recolou?r|track)\\s+video\\s+(?:the\\s+)?([a-z0-9_-]+)(?:\\s+(?:to|into)\\s+(${COLORS}))?`));
  if (video) return { kind: 'modify_video', object: cleanObject(video[1]), color: video[2] ? COLOR_MAP[video[2]] : 'emerald' };

  // "generative edit: add steam to the cup", "inpaint: yellow flowers"
  const edit = cleaned.match(/\b(?:generative\s+edit|inpaint|edit\s+frame|add\s+to\s+frame)\s*[:,-]?\s*(.+)/i);
  if (edit) return { kind: 'generative_edit', prompt: edit[1].trim() };

  if (/^(?:fix|repair)\b/.test(lower)) {
    const color = lower.match(new RegExp(`\\b(?:to|into)\\s+(${COLORS})\\b`))?.[1];
    return { kind: 'fix', shotNumber: shotNumberIn(lower), color: color ? COLOR_MAP[color] : undefined };
  }

  // "make the car red in shot 2", "turn the cup to blue", "recolor the umbrella in shot 3 to amber"
  const shotClause = `(?:\\s+in\\s+(?:shot|scene|frame)\\s*#?\\s*(${NUMBERS}))?`;
  const direct = lower.match(new RegExp(`^(?:make|turn|change|paint)\\s+(?:the\\s+)?([a-z-]+)\\s+(${COLORS})${shotClause}\\b`));
  if (direct)
    return { kind: 'recolor', object: cleanObject(direct[1]), color: COLOR_MAP[direct[2]], shotNumber: toShot(direct[3]) ?? shotNumberIn(lower) };
  const toColour = lower.match(new RegExp(`^(?:recolou?r|change|turn|make|paint)\\s+(?:the\\s+)?([a-z-]+)?${shotClause}\\s*(?:to|into)\\s+(${COLORS})\\b`));
  if (toColour)
    return {
      kind: 'recolor',
      object: toColour[1] ? cleanObject(toColour[1]) : undefined,
      color: COLOR_MAP[toColour[3]],
      shotNumber: toShot(toColour[2]) ?? shotNumberIn(lower),
    };

  // "segment the cup", "detect the car in scene 2", "select umbrella in shot 1"
  const segment = lower.match(new RegExp(`^(?:segment|detect|select|find|track)\\s+(?:the\\s+)?([a-z0-9_-]+)${shotClause}`));
  if (segment && !/\b(?:to|into)\b/.test(lower))
    return { kind: 'segment', object: cleanObject(segment[1]), shotNumber: toShot(segment[2]) ?? shotNumberIn(lower) };

  // A bare colour ("emerald", "set it to amber") updates the main rule; longer text is direction.
  if (cleaned.split(' ').length <= 4) {
    const colour = lower.match(new RegExp(`\\b(${COLORS})\\b`))?.[1];
    if (colour) return { kind: 'rule_update', color: COLOR_MAP[colour] };
  }
  return { kind: 'rebuild', transcript: cleaned };
}
