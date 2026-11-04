/**
 * Turns a spoken or typed director command into a typed intent.
 *
 * From BZcreativ's feat/claude-sam-meta (parse-then-switch voice router), merged
 * with main's fixes: colours limited to the continuity palette with cyan kept
 * distinct, explicit shot numbers including ordinals, narration only when the command
 * itself asks for it, and a bare colour updating the current rule's object.
 */

export type VoiceIntent =
  | { kind: 'playback'; action: 'play' | 'stop' }
  | { kind: 'help' }
  | { kind: 'invalid_command'; message: string }
  | { kind: 'audit' }
  | { kind: 'narrate' }
  | { kind: 'fix'; shotNumber?: number; color?: string; object?: string }
  | { kind: 'segment'; object: string; shotNumber?: number }
  | { kind: 'recolor'; object?: string; color: string; shotNumber?: number }
  | { kind: 'modify_video'; object: string; color: string }
  | { kind: 'generative_edit'; prompt: string; object?: string; shotNumber?: number }
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

export function resolveVoiceColor(text: string): string | undefined {
  const match = text.toLowerCase().match(new RegExp(`\\b(${COLORS})\\b`));
  return match?.[1] ? COLOR_MAP[match[1]] : undefined;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4,
  five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8,
  nine: 9, ninth: 9, ten: 10, tenth: 10, eleven: 11, eleventh: 11, twelve: 12, twelfth: 12,
};
const NUMBERS = `\\d+|${Object.keys(NUMBER_WORDS).join('|')}`;

const toShot = (raw?: string) => (raw ? (NUMBER_WORDS[raw.toLowerCase()] ?? Number(raw)) : undefined);

/** "shot 2", "scene #3", "the second shot". A bare number elsewhere is not a shot. */
function shotNumberIn(text: string): number | undefined {
  const match =
    text.match(new RegExp(`\\b(?:shot|scene|frame)\\s*#?\\s*(${NUMBERS})\\b`, 'i')) ??
    text.match(new RegExp(`#\\s*(\\d+)\\b`)) ??
    text.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s+(?:shot|scene|frame)\b/i);
  return toShot(match?.[1]);
}

const cleanObject = (noun: string) => noun.replace(/^(?:the|my|a|an|this|that)\s+/i, '').trim().toLowerCase();

const SCENE_LEVEL_NOUNS = new Set([
  'scene', 'scenes', 'shot', 'shots', 'frame', 'frames', 'story', 'storyboard',
  'sequence', 'film', 'video', 'setting', 'location', 'background', 'environment',
  'weather', 'lighting', 'camera', 'mood', 'pacing',
]);

export function normalizeVoiceObject(noun: string): string {
  const cleaned = cleanObject(noun);
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return cleaned;
  return words[words.length - 1];
}

export type VoiceConfirmationDecision = 'confirm' | 'repeat' | 'cancel' | null;

/**
 * Classifies a short spoken reply when the studio is waiting for voice confirmation
 * ("yes", "confirm", "go ahead" vs "repeat", "try again", "mistake" vs "cancel").
 */
export function classifyVoiceConfirmationReply(rawText: string): VoiceConfirmationDecision {
  const cleaned = rawText
    .replace(/\b(uh|um|please)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,!?;:]+|[\s.,!?;:]+$/g, '')
    .toLowerCase();
  if (!cleaned) return null;
  if (/^(?:yes|yeah|yep|confirm|confirmed|go ahead|do it|run it|proceed|correct|ok|okay|sure|apply|apply it)$/.test(cleaned)) {
    return 'confirm';
  }
  if (/^(?:repeat|try again|record again|re-?record|mistake|wrong|no|nope|not that|start over|redo)$/.test(cleaned)) {
    return 'repeat';
  }
  if (/^(?:cancel|stop|never mind|nevermind|dismiss|abort|forget it)$/.test(cleaned)) {
    return 'cancel';
  }
  return null;
}

/**
 * Summarizes what a voice command will do in plain spoken language so the user
 * can confirm or repeat before any action is taken.
 */
export function describeVoiceActionSummary(rawText: string, hasExistingShots: boolean): string {
  const intent = parseVoiceCommand(rawText);
  if (!hasExistingShots && !['playback', 'help', 'narrate', 'invalid_command'].includes(intent.kind)) {
    return 'generate a 4-scene storyboard from your spoken description';
  }
  switch (intent.kind) {
    case 'playback':
      return intent.action === 'play' ? 'start playing the animatic' : 'pause the animatic';
    case 'help':
      return 'open the keyboard and voice shortcuts guide';
    case 'audit':
      return 'run a SAM 3.1 continuity check across all scenes';
    case 'narrate':
      return 'read the full storyboard sequence aloud';
    case 'segment':
      return `find and segment the ${intent.object}${intent.shotNumber ? ` in Shot ${intent.shotNumber}` : ' in the active scene'}`;
    case 'recolor':
      return `change the ${intent.object || 'tracked object'} to ${intent.color}${intent.shotNumber ? ` in Shot ${intent.shotNumber}` : ''}`;
    case 'fix':
      return `apply the continuity repair${intent.shotNumber ? ` in Shot ${intent.shotNumber}` : ''}${intent.color ? ` (${intent.color})` : ''}`;
    case 'modify_video':
      return `recolour the reviewed ${intent.object} video mask to ${intent.color}`;
    case 'generative_edit':
      return intent.object
        ? `change the ${intent.object} to "${intent.prompt}"${intent.shotNumber ? ` in Shot ${intent.shotNumber}` : ''}`
        : `apply a masked edit ("${intent.prompt}") to the active scene`;
    case 'rule_update':
      return `update the continuity rule so ${intent.object || 'the tracked object'} stays ${intent.color}`;
    case 'invalid_command':
      return intent.message;
    case 'rebuild':
    default:
      return hasExistingShots
        ? 'update and regenerate your storyboard scenes with this direction'
        : 'generate a 4-scene storyboard from your spoken description';
  }
}

export function parseVoiceCommand(rawText: string): VoiceIntent {
  const cleaned = rawText
    .replace(/\b(uh|um|please|can\s+you|could\s+you|would\s+you)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,!?;:]+|[\s.,!?;:]+$/g, '');
  const lower = cleaned.toLowerCase();
  if (!lower) return { kind: 'rebuild', transcript: '' };

  if (/^(?:in\s+(?:shot|scene|frame)\s*#?\s*\S+\s*,?\s*)?(?:fix|repair|make|turn|change|paint|recolou?r|replace|swap|edit|segment|detect|select|find|track)\b/.test(lower)) {
    const reference=lower.match(/\b(?:shot|scene|frame)\s*#?\s*([^\s,;!?]+)/)?.[1] ?? lower.match(/#\s*([^\s,;!?]+)/)?.[1];
    if(reference){
      const number=NUMBER_WORDS[reference] ?? (/^\d+$/.test(reference)?Number(reference):NaN);
      if(!Number.isSafeInteger(number)||number<1)return {kind:'invalid_command',message:'Use a positive whole scene number, for example: fix shot 2. Your film has not changed.'};
    }
  }


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

  // Video edits require an explicit object and colour; tracking never implies recolouring.
  if (/^(?:modify|recolou?r|track)\s+video\b/.test(lower)) {
    const video = lower.match(new RegExp(`^(?:modify|recolou?r)\\s+video\\s+(?:the\\s+)?([a-z0-9_-]+)\\s+(?:to|into)\\s+(${COLORS})$`));
    if (video) return {kind:'modify_video',object:cleanObject(video[1]),color:COLOR_MAP[video[2]]};
    return {kind:'invalid_command',message:lower.startsWith('track ')
      ? 'Open Review video masks to select and review each object. Tracking does not recolor the video.'
      : 'Name one object and its color, for example: recolor video cup to blue. Your film has not changed.'};
  }

  // "generative edit: add steam to the cup", "inpaint: yellow flowers"
  const edit = cleaned.match(/\b(?:generative\s+edit|inpaint|edit\s+frame|add\s+to\s+frame)\s*[:,-]?\s*(.+)/i);
  if (edit) return { kind: 'generative_edit', prompt: edit[1].trim() };

  if (/^(?:fix|repair)\b/.test(lower)) {
    const color = lower.match(new RegExp(`\\b(?:to|into)\\s+(${COLORS})\\b`))?.[1];
    return { kind: 'fix', shotNumber: shotNumberIn(lower), color: color ? COLOR_MAP[color] : undefined };
  }

  // "make the car red in shot 2", "turn the cup to blue", "recolor the umbrella in shot 3 to amber",
  // "in shot 2 change the coffee cup to red"
  const leadShot = `(?:in\\s+(?:shot|scene|frame)\\s*#?\\s*(${NUMBERS})\\s*,?\\s*)?`;
  const shotClause = `(?:\\s+in\\s+(?:shot|scene|frame)\\s*#?\\s*(${NUMBERS}))?`;
  const objPhrase = `([a-z-]+(?:\\s+(?!to\\b|into\\b|with\\b|in\\b|${COLORS}\\b)[a-z-]+)?)`;
  const direct = lower.match(new RegExp(`^${leadShot}(?:make|turn|change|paint)\\s+(?:the\\s+)?${objPhrase}\\s+(${COLORS})${shotClause}\\b`));
  if (direct && !SCENE_LEVEL_NOUNS.has(normalizeVoiceObject(direct[2])))
    return {
      kind: 'recolor',
      object: normalizeVoiceObject(direct[2]),
      color: COLOR_MAP[direct[3]],
      shotNumber: toShot(direct[1]) ?? toShot(direct[4]) ?? shotNumberIn(lower),
    };
  const toColour = lower.match(new RegExp(`^${leadShot}(?:recolou?r|change|turn|make|paint|set|switch|swap)\\s+(?:the\\s+)?(?:${objPhrase}\\s*)?${shotClause}\\s*(?:to|into|with)\\s+(?:a\\s+|an\\s+)?(${COLORS})(?:\\s+[a-z-]+)?${shotClause}\\b`));
  if (toColour && (!toColour[2] || !SCENE_LEVEL_NOUNS.has(normalizeVoiceObject(toColour[2]))))
    return {
      kind: 'recolor',
      object: toColour[2] ? normalizeVoiceObject(toColour[2]) : undefined,
      color: COLOR_MAP[toColour[4]],
      shotNumber: toShot(toColour[1]) ?? toShot(toColour[3]) ?? toShot(toColour[5]) ?? shotNumberIn(lower),
    };

  // Spoken object replacement/editing: "replace the cup with a lantern in shot 2", "edit the jacket to a leather coat"
  const objectEdit = lower.match(new RegExp(`^${leadShot}(?:replace|swap|edit)\\s+(?:the\\s+)?${objPhrase}${shotClause}\\s+(?:with|into|to)\\s+(.+?)${shotClause}$`));
  if (objectEdit) {
    const targetObj = normalizeVoiceObject(objectEdit[2]);
    if (!SCENE_LEVEL_NOUNS.has(targetObj)) {
      const promptText = objectEdit[4].replace(new RegExp(`\\s+in\\s+(?:shot|scene|frame)\\s*#?\\s*(${NUMBERS})$`, 'i'), '').trim();
      const maybeColor = COLOR_MAP[promptText];
      const shotNum = toShot(objectEdit[1]) ?? toShot(objectEdit[3]) ?? toShot(objectEdit[5]) ?? shotNumberIn(lower);
      if (maybeColor) {
        return { kind: 'recolor', object: targetObj, color: maybeColor, shotNumber: shotNum };
      }
      return { kind: 'generative_edit', object: targetObj, prompt: promptText, shotNumber: shotNum };
    }
  }

  // "segment the cup", "detect the car in scene 2", "select umbrella in shot 1"
  const segment = lower.match(new RegExp(`^(?:segment|detect|select|find|track)\\s+(?:the\\s+)?([a-z0-9_-]+)${shotClause}`));
  if (segment && !/\b(?:to|into)\b/.test(lower))
    return { kind: 'segment', object: cleanObject(segment[1]), shotNumber: toShot(segment[2]) ?? shotNumberIn(lower) };

  // "the jacket must be emerald" is a rule, not new story; a longer script still rebuilds.
  const stated = lower.match(new RegExp(`^(?:the\\s+|my\\s+)?([a-z-]+)\\s+(?:must|should)\\s+(?:be|stay|remain)\\s+(${COLORS})\\b[^.!?]*$`));
  if (stated) return { kind: 'rule_update', object: stated[1], color: COLOR_MAP[stated[2]] };

  // A bare colour ("emerald", "set it to amber") updates the main rule; longer text is direction.
  if (cleaned.split(' ').length <= 4) {
    const colour = lower.match(new RegExp(`\\b(${COLORS})\\b`))?.[1];
    if (colour) return { kind: 'rule_update', color: COLOR_MAP[colour] };
  }
  return { kind: 'rebuild', transcript: cleaned };
}
