import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import {
  chatPlanner,
  fixturePlanner,
  parsePlannerReply,
  plannerFromSettings,
  PlannerOutputError,
} from '../server/planner';

const reply = (content: string) => ({ choices: [{ message: { content } }] });

describe('planner providers', () => {
  it('validates any model reply against the same rule schema', () => {
    expect(parsePlannerReply('```json\n{"rules":[{"targetObject":"umbrella","expectedValue":"red"}]}\n```', 4)).toEqual([
      { id: 'rule-umbrella-color', scope: 'all_shots', targetObject: 'umbrella', property: 'color', expectedValue: 'red', revision: 4 },
    ]);
    expect(() => parsePlannerReply('Sure! The cup is blue.', 1)).toThrow(PlannerOutputError);
    expect(() => parsePlannerReply('{"rules":[{"targetObject":"cup","expectedValue":"teal"}]}', 1)).toThrow(/expectedValue/);
    expect(() => parsePlannerReply('{"rules":[{"targetObject":"cup","expectedValue":"red"},{"targetObject":"cup","expectedValue":"blue"}]}', 1)).toThrow(/more than once/);
  });

  it('sends an invalid reply back once with the error, then accepts the corrected one', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce(reply('{"rules":[{"targetObject":"mug","expectedValue":"blue"}]}'))
      .mockResolvedValueOnce(reply('{"rules":[{"targetObject":"cup","expectedValue":"blue"}]}'));
    const result = await chatPlanner({ model: 'any-model', chat: { create } as never }).plan('Keep the cup blue.', 2);
    expect(result).toMatchObject({ model: 'any-model', provenance: 'live-model', ruleRevision: 2 });
    expect(result.rules[0].targetObject).toBe('cup');
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].messages.at(-1).content).toMatch(/targetObject must be one of/);
  });

  it('fails instead of guessing when the model never complies', async () => {
    const create = vi.fn().mockResolvedValue(reply('not json'));
    await expect(chatPlanner({ model: 'm', chat: { create } as never }).plan('x', 1)).rejects.toThrow(/m gave an invalid plan/);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('keeps the offline fixture unless a provider is fully configured', () => {
    expect(plannerFromSettings({})).toBe(fixturePlanner);
    expect(plannerFromSettings({ PLANNER_PROVIDER: 'openai-compatible', PLANNER_MODEL: 'm' })).toBe(fixturePlanner);
    expect(plannerFromSettings({ PLANNER_PROVIDER: 'openai-compatible', PLANNER_BASE_URL: 'http://127.0.0.1:1/v1', PLANNER_API_KEY: 'test', PLANNER_MODEL: 'm' })).not.toBe(fixturePlanner);
  });

  it('serves the configured planner through /api/muse/spark and reports bad output as 502', async () => {
    const create = vi.fn().mockResolvedValue(reply('nope'));
    const app = createApp({ settings: () => ({ key: '', requestLimit: 10 }), planner: chatPlanner({ model: 'm', chat: { create } as never }) });
    const health = await request(app).get('/api/health');
    const res = await request(app)
      .post('/api/muse/spark')
      .set('X-Anchorshot-Session', health.body.sessionToken)
      .send({ transcript: 'Keep the cup blue.' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/invalid plan/);
  });

});

describe('planned shot lists', () => {
  const shot = (subject: string, extra: object = {}) => ({ subject, size: 'wide', angle: 'eye level', lens: '24mm', movement: 'locked', light: 'night', temp: 'cool', seconds: 4, ...extra });

  it('normalises each planned shot and clamps its length', async () => {
    const reply = JSON.stringify({
      rules: [{ targetObject: 'cup', expectedValue: 'blue' }],
      shots: [shot('Diner exterior in rain'), shot('Miller at the counter', { size: 'close', lens: '18mm', seconds: 30 }), shot('Hand reaches for the blue cup', { seconds: 0.2 })],
    });
    const result = await chatPlanner({ model: 'm', chat: { create: vi.fn().mockResolvedValue(reply_(reply)) } as never }).plan('x', 1);
    expect(result.shots?.map((s) => [s.size, s.lens, s.seconds])).toEqual([
      ['Wide', '24mm', 4],
      ['Close', '35mm', 8],
      ['Wide', '24mm', 2],
    ]);
  });

  it('keeps rules-only replies valid and rejects unusable shot lists', () => {
    expect(parsePlannerReply('{"rules":[]}', 1)).toEqual([]);
    expect(() => parsePlannerReply(JSON.stringify({ rules: [], shots: [shot('a')] }), 1)).toThrow(/3 to 8 shots/);
    expect(() => parsePlannerReply(JSON.stringify({ rules: [], shots: [shot('a'), shot(''), shot('c')] }), 1)).toThrow(/shots\[1\]\.subject/);
  });
});

function reply_(content: string) {
  return { choices: [{ message: { content } }] };
}
