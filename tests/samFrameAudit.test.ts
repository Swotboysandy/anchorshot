import { describe, expect, it, vi } from 'vitest';
import { detectMaskedColor } from '../src/services/maskIntegrity';
import { MetaModelClient } from '../src/services/metaModels';
import * as canvasEngine from '../src/services/canvasEngine';
import type { StoryboardShot } from '../src/types/framelock';

describe('Real SAM detection & color auditing on frames', () => {
  it('classifies object pigments accurately inside binary SAM masks', () => {
    // 20x20 test canvas
    const width = 20;
    const height = 20;
    const totalPixels = width * height;
    const mask = new Uint8Array(totalPixels);
    // Mask center 10x10 square
    for (let y = 5; y < 15; y++) {
      for (let x = 5; x < 15; x++) {
        mask[y * width + x] = 1;
      }
    }

    // 1. Blue test frame
    const bluePixels = new Uint8ClampedArray(totalPixels * 4);
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      bluePixels[idx] = 30;      // R
      bluePixels[idx + 1] = 80;  // G
      bluePixels[idx + 2] = 220; // B
      bluePixels[idx + 3] = 255; // A
    }
    const blueResult = detectMaskedColor(bluePixels, mask);
    expect(blueResult.colorName).toBe('blue');
    expect(blueResult.pixelCount).toBe(100);
    expect(blueResult.confidence).toBeGreaterThan(0.7);

    // 2. Red test frame
    const redPixels = new Uint8ClampedArray(totalPixels * 4);
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      redPixels[idx] = 220;      // R
      redPixels[idx + 1] = 35;   // G
      redPixels[idx + 2] = 35;   // B
      redPixels[idx + 3] = 255;  // A
    }
    const redResult = detectMaskedColor(redPixels, mask);
    expect(redResult.colorName).toBe('red');
    expect(redResult.confidence).toBeGreaterThan(0.7);

    // 3. Amber test frame
    const amberPixels = new Uint8ClampedArray(totalPixels * 4);
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      amberPixels[idx] = 225;    // R
      amberPixels[idx + 1] = 125;// G
      amberPixels[idx + 2] = 10; // B
      amberPixels[idx + 3] = 255;// A
    }
    const amberResult = detectMaskedColor(amberPixels, mask);
    expect(amberResult.colorName).toBe('amber');
  });

  it('audits shot continuity dynamically without relying on planted fixture flags', async () => {
    const client = new MetaModelClient();

    // Stub sampleImageColorInMask behavior on client or module
    const consistentShot: StoryboardShot = {
      id: 'shot-1',
      shotNumber: 1,
      durationSeconds: 4.0,
      promptDescription: 'Close-up of detective with blue cup on counter',
      spokenDescription: 'Shot 1. Close-up. Generated image, continuity unreviewed.',
      currentImageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEeQHzc1p9eQAAAABJRU5ErkJggg==',
      originalImageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEeQHzc1p9eQAAAABJRU5ErkJggg==',
      status: 'uncertain',
      revisions: [],
    };

    const rule = {
      id: 'rule-cup-color',
      scope: 'all_shots' as const,
      targetObject: 'cup',
      property: 'color',
      expectedValue: 'blue',
      revision: 1,
    };

    // A frame that cannot be measured is never reported as verified.
    const unmeasured = await client.auditShotContinuity(consistentShot, rule);
    expect(unmeasured.status).toBe('uncertain');
    expect(unmeasured.spokenDescription).not.toMatch(/Continuity verified/);

    vi.spyOn(canvasEngine, 'sampleImageColorInMask').mockResolvedValueOnce({
      colorName: 'blue',
      rgb: [37, 99, 235],
      pixelCount: 120,
      confidence: 0.96,
    });
    const auditedConsistent = await client.auditShotContinuity(consistentShot, rule);
    expect(auditedConsistent.status).toBe('consistent');
    expect(auditedConsistent.discrepancyMessage).toBeUndefined();
    expect(auditedConsistent.spokenDescription).toMatch(/Continuity verified/);

    // Mismatch scenario: real SAM sample returns red cup
    vi.spyOn(canvasEngine, 'sampleImageColorInMask').mockResolvedValueOnce({
      colorName: 'red',
      rgb: [220, 38, 38],
      pixelCount: 120,
      confidence: 0.96,
    });

    const mismatchShot: StoryboardShot = {
      id: 'shot-2',
      shotNumber: 2,
      durationSeconds: 3.5,
      promptDescription: 'Medium shot of desk with red cup',
      spokenDescription: 'Shot 2. Generated image; continuity unreviewed.',
      currentImageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEeQHzc1p9eQAAAABJRU5ErkJggg==',
      originalImageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEeQHzc1p9eQAAAABJRU5ErkJggg==',
      status: 'uncertain',
      revisions: [],
    };

    const auditedMismatch = await client.auditShotContinuity(mismatchShot, rule);
    expect(auditedMismatch.status).toBe('mismatch');
    expect(auditedMismatch.discrepancyMessage).toMatch(/Visual audit detected a red cup/);
    expect(auditedMismatch.proposedFix).toBeDefined();
    expect(auditedMismatch.proposedFix?.targetColor).toBe('blue');
    expect(auditedMismatch.proposedFix?.targetObject).toBe('cup');
  });
});
