import OpenAI from 'openai';
import { ANGLES, COLOR_TEMPS, LENSES, LIGHTS, MOVEMENTS, normalizeCast, normalizeShot, SHOT_SIZES, type CastMember, type ShotSpec } from '../src/lib/shotLanguage';
import { resolveUpstreamChatModel } from './models';

/**
 * Shot-planning role behind `/api/muse/spark`. Prompts and the rule schema live
 * here, so any provider only has to return text: the fixture for offline work,
 * or any OpenAI-compatible chat endpoint (Meta gateway, Baseten, local server).
 * Every provider's reply passes the same validation before the app sees it.
 */
export interface ContinuityRule {
  id: string;
  scope: 'all_shots';
  targetObject: string;
  property: 'color';
  expectedValue: string;
  revision: number;
}
export interface PlannedShot extends ShotSpec {
  seconds: number;
}
export interface PlanResult {
  model: string;
  provenance: 'offline-fixture' | 'live-model';
  ruleRevision: number;
  rules: ContinuityRule[];
  /** Shot list chosen by the model; absent from the offline fixture. */
  shots?: PlannedShot[];
  cast?: CastMember[];
}
export interface Planner {
  plan(transcript: string, revision: number, signal?: AbortSignal, beforeRetry?: () => void): Promise<PlanResult>;
}

export class PlannerOutputError extends Error {}

const OBJECTS: Record<string, string> = { cup: 'cup', mug: 'cup', umbrella: 'umbrella', jacket: 'jacket', coat: 'jacket' };
const COLORS: Record<string, string> = {
  emerald: 'emerald', green: 'emerald', amber: 'amber', yellow: 'amber', gold: 'amber',
  blue: 'blue', cobalt: 'blue', red: 'red', crimson: 'red', white: 'white', purple: 'purple', cyan: 'cyan',
};

const rule = (targetObject: string, expectedValue: string, revision: number): ContinuityRule => ({
  id: `rule-${targetObject}-color`,
  scope: 'all_shots',
  targetObject,
  property: 'color',
  expectedValue,
  revision,
});

/** Keyword planner kept from the original endpoint; it never calls a model. */
export const fixturePlanner: Planner = {
  async plan(transcript, revision) {
    const lower = transcript.toLowerCase();
    const object = Object.keys(OBJECTS).find((word) => lower.includes(word));
    const sentence = transcript.split('.')[0]?.toLowerCase() || lower;
    const color = Object.keys(COLORS).find((word) => sentence.includes(word));
    if (!object) return { model: 'muse-spark-1.3', provenance: 'offline-fixture', ruleRevision: revision, rules: [] };
    return {
      model: 'muse-spark-1.3',
      provenance: 'offline-fixture',
      ruleRevision: revision,
      rules: [rule(OBJECTS[object], color ? COLORS[color] : 'blue', revision)],
    };
  },
};

export const MIN_SHOTS = 3;
export const MAX_SHOTS = 8;

export const PLANNER_PROMPT = `You are a film director's first assistant. From the director's spoken notes, extract the visual continuity rules and plan the storyboard shot list.
Reply with JSON only, no prose:
{"rules":[{"targetObject":string,"expectedValue":string}],
 "cast":[{"name":string,"age":string,"build":string,"features":string,"wardrobe":string}],
 "shots":[{"cast":[string],"subject":string,"intent":string,"size":string,"angle":string,"lens":string,"movement":string,"light":string,"temp":string,"seconds":number}]}

Rules: targetObject is one of: ${[...new Set(Object.values(OBJECTS))].join(', ')}. expectedValue is that object's colour, one of: ${[...new Set(Object.values(COLORS))].join(', ')}. Only include rules the director actually stated; use an empty list if there are none.

Cast: list everyone who appears. If the notes imply an unnamed person ("a courier"), invent a short working name like "THE COURIER". Fix one concrete look per person and keep it for the whole film: age like "30s", build, features (face, skin tone, hair), and wardrobe including headwear. Unless the director says a look changes, it never changes.

Shots: plan ${MIN_SHOTS} to ${MAX_SHOTS} shots in story order. If the director numbers shots ("Shot 2: ..."), keep exactly those shots and that order. Otherwise start a new shot whenever the framing, who is on screen, the location or time of day, the dramatic turn or a significant action changes. Usually open wide to establish place, move closer as tension builds, and avoid the same size three times in a row.
- cast: exact names from the cast list of who is actually visible in this frame, not merely mentioned; empty if nobody is.
- subject: what the frame shows, concrete and visible (people, action, setting, props with their continuity colour). No mood words without a visible cause, no on-screen text.
- intent: one short phrase on why this shot exists, e.g. "establish the diner".
- size: one of ${SHOT_SIZES.join(', ')}. angle: one of ${ANGLES.join(', ')}. lens: one of ${LENSES.join(', ')}. movement: one of ${MOVEMENTS.join(', ')}. light: one of ${LIGHTS.join(', ')}. temp: one of ${COLOR_TEMPS.join(', ')}.
- seconds: 2 to 8; quicker for action, longer for quiet or emotional moments.`;

/** Turns raw model text into rules and shots, or explains exactly what was wrong. */
export function parsePlan(text: string, revision: number): { rules: ContinuityRule[]; shots?: PlannedShot[]; cast?: CastMember[] } {
  const json = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new PlannerOutputError('Reply was not valid JSON.');
  }
  const cast = normalizeCast((data as { cast?: unknown })?.cast);
  return { rules: parseRules(data, revision), shots: parseShots(data), ...(cast.length ? { cast } : {}) };
}

/** Rules only, for callers that do not plan shots. */
export function parsePlannerReply(text: string, revision: number): ContinuityRule[] {
  return parsePlan(text, revision).rules;
}

function parseShots(data: unknown): PlannedShot[] | undefined {
  const shots = (data as { shots?: unknown })?.shots;
  if (shots === undefined) return undefined;
  if (!Array.isArray(shots) || shots.length < MIN_SHOTS || shots.length > MAX_SHOTS)
    throw new PlannerOutputError(`"shots" must list ${MIN_SHOTS} to ${MAX_SHOTS} shots.`);
  return shots.map((item, index) => {
    const raw = (item ?? {}) as Record<string, unknown>;
    const shot = normalizeShot(raw);
    if (!shot.subject) throw new PlannerOutputError(`shots[${index}].subject must describe what the frame shows.`);
    const seconds = Number(raw.seconds);
    return { ...shot, seconds: Number.isFinite(seconds) ? Math.min(8, Math.max(2, Math.round(seconds * 2) / 2)) : 4 };
  });
}

function parseRules(data: unknown, revision: number): ContinuityRule[] {
  const rules = (data as { rules?: unknown })?.rules;
  if (!Array.isArray(rules)) throw new PlannerOutputError('Reply needs a "rules" array.');
  const objects = new Set(Object.values(OBJECTS));
  const colors = new Set(Object.values(COLORS));
  const seen = new Set<string>();
  return rules.map((item, index) => {
    const { targetObject, expectedValue } = (item ?? {}) as Record<string, unknown>;
    if (typeof targetObject !== 'string' || !objects.has(targetObject))
      throw new PlannerOutputError(`rules[${index}].targetObject must be one of: ${[...objects].join(', ')}.`);
    if (typeof expectedValue !== 'string' || !colors.has(expectedValue))
      throw new PlannerOutputError(`rules[${index}].expectedValue must be one of: ${[...colors].join(', ')}.`);
    if (seen.has(targetObject))
      throw new PlannerOutputError(`rules lists ${targetObject} more than once.`);
    seen.add(targetObject);
    return rule(targetObject, expectedValue, revision);
  });
}

type Chat = Pick<OpenAI['chat']['completions'], 'create'>;

/**
 * Any OpenAI-compatible chat model. An invalid reply is sent back once with the
 * validation error, then the request fails instead of guessing.
 */
export function chatPlanner(options: { model: string; upstreamModel?: string; chat: Chat; attempts?: number }): Planner {
  const attempts = options.attempts ?? 2;
  const targetModel = options.upstreamModel ?? options.model;
  return {
    async plan(transcript, revision, signal, beforeRetry) {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: PLANNER_PROMPT },
        { role: 'user', content: transcript },
      ];
      let problem = '';
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (attempt > 0) beforeRetry?.();
        const reply = await options.chat.create(
          { model: targetModel, messages, temperature: 0 },
          { signal },
        );
        const text = reply.choices[0]?.message?.content ?? '';
        try {
          const { rules, shots, cast } = parsePlan(text, revision);
          return { model: options.model, provenance: 'live-model', ruleRevision: revision, rules, ...(shots && { shots }), ...(cast && { cast }) };
        } catch (error) {
          if (!(error instanceof PlannerOutputError)) throw error;
          problem = error.message;
          messages.push(
            { role: 'assistant', content: text },
            { role: 'user', content: `${problem} Reply again with corrected JSON only.` },
          );
        }
      }
      throw new PlannerOutputError(`${options.model} gave an invalid plan: ${problem}`);
    },
  };
}

/**
 * PLANNER_PROVIDER=fixture (default) or openai-compatible, with PLANNER_BASE_URL,
 * PLANNER_API_KEY and PLANNER_MODEL. A missing value keeps the offline fixture.
 */
export function plannerFromSettings(values: Record<string, string | undefined>): Planner {
  const pick = (name: string) => (process.env[name] ?? values[name] ?? '').trim();
  if (pick('PLANNER_PROVIDER') !== 'openai-compatible') return fixturePlanner;
  const [baseURL, apiKey, model] = ['PLANNER_BASE_URL', 'PLANNER_API_KEY', 'PLANNER_MODEL'].map(pick);
  if (!baseURL || !apiKey || !model) return fixturePlanner;
  const upstreamModel = resolveUpstreamChatModel(baseURL, model, values);
  const client = new OpenAI({ baseURL, apiKey, maxRetries: 0, timeout: 60_000 });
  return chatPlanner({ model, upstreamModel, chat: client.chat.completions });
}
