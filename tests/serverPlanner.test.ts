import { afterEach, describe, expect, it, vi } from 'vitest';
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
