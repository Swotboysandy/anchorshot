import { describe, expect, it } from 'vitest';
import { buildShotPrompt, normalizeCast, normalizeShot, SHOT_PRESETS, SHOT_SIZES } from '../src/lib/shotLanguage';

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

  it('leads with an identity lock for the cast on screen only', () => {
    const cast = normalizeCast([
      { name: 'THE COURIER', age: '30s', features: 'short black hair', wardrobe: 'emerald jacket, no hat' },
      { name: 'THE CLOCKMAKER', age: '70s', features: 'white beard' },
      { name: 'NOBODY' },
      'junk',
    ]);
    expect(cast.map((c) => c.name)).toEqual(['THE COURIER', 'THE CLOCKMAKER']);
    const prompt = buildShotPrompt({ shot: normalizeShot({ subject: 'Rider in the market', cast: ['the courier'] }), cast });
    expect(prompt.startsWith('IDENTITY LOCK\nTHE COURIER: 30s, short black hair, wearing emerald jacket, no hat')).toBe(true);
    expect(prompt).toContain('Exactly 1 person');
    expect(prompt).not.toContain('CLOCKMAKER');
    const named = buildShotPrompt({ shot: normalizeShot({ subject: 'The clockmaker smiles' }), cast });
    expect(named).toContain('THE CLOCKMAKER: 70s');
    expect(buildShotPrompt({ shot: normalizeShot({ subject: 'Empty street' }), cast })).not.toContain('IDENTITY LOCK');
  });

  it('applies a prop rule only to shots containing the prop when the cast is known', () => {
    const cast = normalizeCast([
      { name: 'THE COURIER', features: 'short hair', wardrobe: 'emerald jacket' },
      { name: 'THE CLOCKMAKER', features: 'white beard', wardrobe: 'brown waistcoat' },
    ]);
    const continuity = [{ targetObject: 'jacket', expectedValue: 'emerald' }];
    const withCourier = buildShotPrompt({ shot: normalizeShot({ subject: 'Riding', cast: ['THE COURIER'] }), cast, continuity });
    expect(withCourier).toContain('The jacket is emerald');
    const clockmakerAlone = buildShotPrompt({ shot: normalizeShot({ subject: 'He smiles', cast: ['THE CLOCKMAKER'] }), cast, continuity });
    expect(clockmakerAlone).not.toContain('jacket');
    expect(buildShotPrompt({ shot: normalizeShot({ subject: 'Empty street' }), continuity })).toContain('The jacket is emerald');
  });
});
