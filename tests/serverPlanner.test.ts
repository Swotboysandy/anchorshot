import { afterEach, describe, expect, it, vi } from 'vitest';
// Sample frames are drawn on a browser canvas; stand in for it under Node.
vi.mock('../src/services/canvasEngine', async (original) => ({
  ...(await original<typeof import('../src/services/canvasEngine')>()),
  renderMuseStoryboardFrame: () => ({ imageUrl: 'data:image/png;base64,AA==', box: { x: 50, y: 50, width: 10, height: 10 } }),
}));
import { MetaModelClient } from '../src/services/metaModels';

afterEach(() => vi.unstubAllGlobals());

const stub = (health: object, spark: () => Response) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url === '/api/health' ? Response.json(health) : spark())),
  );

describe('continuity rules from the server planner', () => {
  it('uses the live planner and keeps the anchor rule the storyboard expects', async () => {
    stub({ plannerLive: true, sessionToken: 't' }, () =>
      Response.json({
        model: 'meta-models/muse-spark-open-1026',
        ruleRevision: 1,
        rules: [{ id: 'rule-umbrella-color', scope: 'all_shots', targetObject: 'umbrella', property: 'color', expectedValue: 'red', revision: 1 }],
      }),
    );
    const rules = await new MetaModelClient().extractContinuityRules('Keep the umbrella red.');
    expect(rules.map((r) => [r.targetObject, r.property, r.expectedValue])).toEqual([
      ['umbrella', 'color', 'red'],
      ['umbrella', 'spatial_anchor', 'foreground_counter'],
    ]);
  });

  it('falls back to the local planner when the server has no live model or fails', async () => {
    stub({ plannerLive: false }, () => Response.json({}));
    expect((await new MetaModelClient().extractContinuityRules('The jacket must be amber.'))[0]).toMatchObject({ targetObject: 'jacket', expectedValue: 'amber' });
    stub({ plannerLive: true }, () => Response.json({ error: 'invalid plan' }, { status: 502 }));
    expect((await new MetaModelClient().extractContinuityRules('The jacket must be amber.'))[0]).toMatchObject({ targetObject: 'jacket' });
  });
});

describe('a scene with no stated continuity rule', () => {
  const subjects = ['Courier enters the market', 'Courier passes the stalls', 'Courier reaches the door'];
  it('keeps the planned shots and never invents a cup', async () => {
    const prompts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/health') return Response.json({ plannerLive: true, imageModel: 'img', sessionToken: 't' });
      if (url === '/api/muse/spark')
        return Response.json({ model: 'meta', ruleRevision: 1, rules: [], shots: subjects.map((subject) => ({ subject, seconds: 4 })) });
      prompts.push(JSON.parse(String(init?.body)).prompt);
      return Response.json({ url: `/api/muse/frames/${'a'.repeat(64)}.png`, width: 1024, height: 576, sourceHash: 'a'.repeat(64) });
    }));
    const { rules, shots } = await new MetaModelClient().generateStoryboardFromTranscript('A courier rides through a market.');
    expect(rules).toEqual([]);
    expect(shots.map((s) => s.promptDescription)).toEqual(subjects);
    expect(prompts.join(' ')).not.toMatch(/cup/i);
  });

  it('offline, flags no mismatch and describes the actual scene', async () => {
    stub({ plannerLive: false }, () => Response.json({}));
    const { rules, shots } = await new MetaModelClient().generateStoryboardFromTranscript('A courier rides through a market.');
    expect(rules).toEqual([]);
    expect(shots.some((s) => s.status === 'mismatch')).toBe(false);
    expect(shots.map((s) => s.promptDescription).join(' ')).not.toMatch(/cup/i);
  });
});

describe('storyboard from a planned shot list', () => {
  const planned = [
    { subject: 'Night market in rain, courier on a bicycle', size: 'Establishing', angle: 'High', lens: '24mm', movement: 'Pan', light: 'Night', temp: 'Cool', seconds: 6 },
    { subject: 'Courier weaving past stalls', size: 'Medium', angle: 'Eye level', lens: '35mm', movement: 'Dolly', light: 'Night', temp: 'Cool', seconds: 5 },
    { subject: 'Clockmaker opens the door', size: 'Medium', angle: 'Eye level', lens: '50mm', movement: 'Push in', light: 'Night', temp: 'Warm', seconds: 4 },
    { subject: 'Clockmaker smiles at the courier', size: 'Close', angle: 'Low', lens: '85mm', movement: 'Locked', light: 'Night', temp: 'Warm', seconds: 5 },
    { subject: 'Package changes hands', size: 'Insert', angle: 'High', lens: '85mm', movement: 'Locked', light: 'Night', temp: 'Warm', seconds: 3 },
  ];
  const plan = () =>
    Response.json({ model: 'meta', ruleRevision: 1, rules: [{ id: 'rule-jacket-color', scope: 'all_shots', targetObject: 'jacket', property: 'color', expectedValue: 'emerald', revision: 1 }], shots: planned });

  it('uses the planned count, framing, lengths and subjects for sample frames', async () => {
    stub({ plannerLive: true, sessionToken: 't' }, plan);
    const { shots } = await new MetaModelClient().generateStoryboardFromTranscript('A courier rides to the clockmaker.', undefined, false);
    expect(shots.map((s) => [s.durationSeconds, s.promptDescription])).toEqual(planned.map((p) => [p.seconds, p.subject]));
    expect(shots[3].spokenDescription).toMatch(/^Shot 4, close shot, low angle on 85mm, locked camera, night light, duration 5 seconds\./);
  });

  it('builds model-frame prompts from the plan with continuity first', async () => {
    const prompts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/health') return Response.json({ plannerLive: true, imageModel: 'img', sessionToken: 't' });
      if (url === '/api/muse/spark') return plan();
      prompts.push(JSON.parse(String(init?.body)).prompt);
      return Response.json({ url: `/api/muse/frames/${'a'.repeat(64)}.png`, width: 1024, height: 576, sourceHash: 'a'.repeat(64) });
    }));
    const { shots } = await new MetaModelClient().generateStoryboardFromTranscript('A courier rides to the clockmaker.');
    expect(shots).toHaveLength(5);
    const steps: string[] = [];
    await new MetaModelClient().generateStoryboardFromTranscript('A courier rides.', undefined, true, (message) => steps.push(message));
    expect(steps[0]).toBe('Planning the shots...');
    expect(steps.at(-1)).toBe('Drawing frame 5 of 5...');
    expect(prompts[0].startsWith('CONTINUITY\nThe jacket is emerald')).toBe(true);
    expect(prompts[0]).toContain('Establishing shot, high angle, 24mm, pan camera. Night market in rain, courier on a bicycle.');
  });
});
