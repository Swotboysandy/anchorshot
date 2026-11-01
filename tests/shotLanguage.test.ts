import { describe, expect, it } from 'vitest';
import { buildShotPrompt, normalizeShot, SHOT_PRESETS, SHOT_SIZES } from '../src/lib/shotLanguage';

describe('shot language', () => {
  it('keeps model output inside the vocabulary', () => {
    expect(normalizeShot({ size: 'close', angle: 'LOW', lens: '85mm', movement: 'push in', light: 'golden hour', temp: 'warm', subject: ' Miller reaches for the cup ' })).toEqual({
      size: 'Close', angle: 'Low', lens: '85mm', movement: 'Push in', light: 'Golden hour', temp: 'Warm', subject: 'Miller reaches for the cup', intent: undefined,
    });
    expect(normalizeShot({ size: 'cinematic hero shot', lens: '18mm', movement: 42 })).toMatchObject({ size: 'Medium', lens: '35mm', movement: 'Locked', subject: '' });
  });

  it('only uses vocabulary values in presets', () => {
    for (const preset of Object.values(SHOT_PRESETS)) expect(SHOT_SIZES).toContain(preset.size);
  });

  it('puts continuity before the shot and keeps the frame single', () => {
    const prompt = buildShotPrompt({
      shot: normalizeShot({ size: 'Wide', angle: 'High', lens: '24mm', light: 'Night', temp: 'Cool', subject: 'Rain-streaked diner counter, detective seated.' }),
      continuity: [{ targetObject: 'cup', expectedValue: 'blue' }],
      setting: 'Midnight diner, neon sign outside the window.',
    });
    const blocks = prompt.split('\n\n').map((block) => block.split('\n')[0]);
    expect(blocks.slice(0, 3)).toEqual(['CONTINUITY', 'SET', 'SHOT']);
    expect(prompt).toContain('The cup is blue: the same cup, same colour, in every shot.');
    expect(prompt).toContain('Wide shot, high angle, 24mm, locked camera. Rain-streaked diner counter, detective seated. Night lighting, cool palette.');
    expect(prompt).toMatch(/never a grid/);
  });
});
