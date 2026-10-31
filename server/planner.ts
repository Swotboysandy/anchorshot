import OpenAI from 'openai';

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
export interface PlanResult {
  model: string;
  provenance: 'offline-fixture' | 'live-model';
  ruleRevision: number;
  rules: ContinuityRule[];
}
export interface Planner {
  plan(transcript: string, revision: number, signal?: AbortSignal): Promise<PlanResult>;
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
    return {
      model: 'muse-spark-1.3',
      provenance: 'offline-fixture',
      ruleRevision: revision,
      rules: [rule(object ? OBJECTS[object] : 'cup', color ? COLORS[color] : 'blue', revision)],
    };
  },
};

export const PLANNER_PROMPT = `You extract visual continuity rules from a film director's spoken notes.
Reply with JSON only, no prose: {"rules":[{"targetObject":string,"expectedValue":string}]}.
targetObject is one of: ${[...new Set(Object.values(OBJECTS))].join(', ')}.
expectedValue is the object's colour, one of: ${[...new Set(Object.values(COLORS))].join(', ')}.
Only include rules the director actually stated. Use an empty list if there are none.`;

/** Turns raw model text into rules, or explains exactly what was wrong. */
export function parsePlannerReply(text: string, revision: number): ContinuityRule[] {
  const json = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new PlannerOutputError('Reply was not valid JSON.');
  }
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
export function chatPlanner(options: { model: string; chat: Chat; attempts?: number }): Planner {
  const attempts = options.attempts ?? 2;
  return {
    async plan(transcript, revision, signal) {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: PLANNER_PROMPT },
        { role: 'user', content: transcript },
      ];
      let problem = '';
      for (let attempt = 0; attempt < attempts; attempt++) {
        const reply = await options.chat.create(
          { model: options.model, messages, temperature: 0 },
          { signal },
        );
        const text = reply.choices[0]?.message?.content ?? '';
        try {
          const rules = parsePlannerReply(text, revision);
          return { model: options.model, provenance: 'live-model', ruleRevision: revision, rules };
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
  const client = new OpenAI({ baseURL, apiKey, maxRetries: 0, timeout: 60_000 });
  return chatPlanner({ model, chat: client.chat.completions });
}
