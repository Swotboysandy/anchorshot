import { describe, expect, it } from 'vitest';
import { applyVideoFindingsToShots, type VideoDetectedObject } from '../src/services/metaModels';
import type { ContinuityFinding, StoryboardShot } from '../src/types/framelock';

function shot(id: string): StoryboardShot {
  return {
    id,
    shotNumber: Number(id.split('-')[1]) || 1,
    durationSeconds: 3.5,
    promptDescription: 'A cup on the counter',
    spokenDescription: '',
    currentImageUrl: 'x',
    originalImageUrl: 'x',
    status: 'consistent',
    revisions: [],
  };
}

const objects: VideoDetectedObject[] = [
  { objectId: '0', label: 'Cup #1', concept: 'cup', confidence: 0.96, width: 800, height: 450, bounds: { left: 100, top: 90, right: 260, bottom: 270 }, maskRef: 'sam-3.1:cup:0:v1' },
];

describe('applyVideoFindingsToShots', () => {
  it('flags the target shot on a mismatch and binds the sam-3.1 mask to the proposed fix', () => {
    const findings: ContinuityFinding[] = [
      {
        shotIndex: 1,
        status: 'mismatch',
        ruleId: 'rule-cup-color',
        targetObject: 'cup',
        expectedValue: 'blue',
        observedValue: 'red',
        maskRef: 'sam-3.1:cup:0:v1',
        objectId: '0',
        confidence: 0.96,
        explanation: 'observed "red" conflicts with expected "blue"',
        proposedAction: 'recolor',
      },
    ];

    const result = applyVideoFindingsToShots([shot('shot-1'), shot('shot-2')], findings, objects);

    expect(result[1].status).toBe('mismatch');
    expect(result[1].discrepancyMessage).toContain('conflicts');
    expect(result[1].proposedFix?.targetColor).toBe('blue');
    expect(result[1].proposedFix?.mask?.maskRef).toBe('sam-3.1:cup:0:v1');
    expect(result[1].proposedFix?.mask?.box.width).toBeGreaterThan(0);
    expect(result[0].status).toBe('consistent');
  });

  it('leaves shots untouched for empty findings and consistent findings', () => {
    const shots = [shot('shot-1')];
    expect(applyVideoFindingsToShots(shots, [], objects)).toBe(shots);

    const consistent: ContinuityFinding[] = [
      {
        shotIndex: 0,
        status: 'consistent',
        ruleId: 'r',
        targetObject: 'cup',
        expectedValue: 'blue',
        confidence: 0.96,
        explanation: 'verified',
        proposedAction: 'recolor',
      },
    ];
    const result = applyVideoFindingsToShots(shots, consistent, objects);
    expect(result[0].status).toBe('consistent');
    expect(result[0].proposedFix).toBeUndefined();
  });
});
