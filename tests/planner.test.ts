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
