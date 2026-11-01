import { describe, expect, it } from 'vitest';
import {
  DURATION,
  DEFAULT_PLAN,
  portalEase,
  readPlan,
  storyCaptions,
  timelineAt,
} from '../src/dream/timeline';

describe('dream timing and saved plans', () => {
  it('clamps seeking and ends on the last world without wrapping', () => {
    expect(timelineAt(-1).index).toBe(0);
    expect(timelineAt(NaN).time).toBe(0);
    expect(timelineAt(DURATION).index).toBe(2);
    expect(timelineAt(30).time).toBe(DURATION);
    expect(timelineAt(7).index).toBe(1);
    expect(timelineAt(14).index).toBe(2);
  });
  it('opens the doorway near the end of each scene and reaches the next scene continuously', () => {
    expect(timelineAt(3).blend).toBe(0);
    expect(timelineAt(5.8).blend).toBeGreaterThan(0);
    expect(timelineAt(DURATION / 3 - 0.0001).blend).toBeCloseTo(1, 3);
    expect(timelineAt(DURATION / 3).index).toBe(1);
    expect(timelineAt(19).blend).toBe(0);
  });
  it('uses a monotone easing with exact endpoints', () => {
    expect(portalEase(0)).toBe(0);
    expect(portalEase(1)).toBe(1);
    let previous = 0;
    for (let i = 1; i <= 100; i++) {
      const value = portalEase(i / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });
  it('restores only a valid bounded plan and copies mutable captions', () => {
    const restored = readPlan(DEFAULT_PLAN);
    expect(restored).toEqual(DEFAULT_PLAN);
    expect(restored?.captions).not.toBe(DEFAULT_PLAN.captions);
    expect(readPlan({ ...DEFAULT_PLAN, version: 2 })).toBeNull();
    expect(readPlan({ ...DEFAULT_PLAN, anchor: 'yes' })).toBeNull();
    expect(readPlan({ ...DEFAULT_PLAN, captions: ['one'] })).toBeNull();
    expect(readPlan({ ...DEFAULT_PLAN, story: 'a'.repeat(2001) })).toBeNull();
    expect(readPlan({ ...DEFAULT_PLAN, transition: 'unknown' })).toBeNull();
    expect(readPlan(null)).toBeNull();
  });
});

describe('offline scene edits', () => {
  it('migrates old plans and validates image metadata without allowing remote sources', () => {
    const { titles, images, ...oldPlan } = DEFAULT_PLAN;
    expect(readPlan(oldPlan)?.titles).toEqual(titles);
    expect(readPlan(oldPlan)?.images).toEqual([null, null, null]);
    expect(
      readPlan({
        ...DEFAULT_PLAN,
        images: [{ name: 'bad', data: 'https://example.com/image.jpg' }, null, null],
      }),
    ).toBeNull();
    expect(readPlan({ ...DEFAULT_PLAN, titles: ['one'] })).toBeNull();
    expect(readPlan({ ...DEFAULT_PLAN, images: [null] })).toBeNull();
  });
  it('applies three paragraphs exactly and rejects ambiguous or overlong input', () => {
    expect(storyCaptions('A forest.\n\nA lake.\n\nA mountain.')).toEqual([
      'A forest.',
      'A lake.',
      'A mountain.',
    ]);
    expect(() => storyCaptions('Only one paragraph.')).toThrow('exactly three');
    expect(() => storyCaptions('a'.repeat(161) + '\n\nb\n\nc')).toThrow('160');
  });
});
