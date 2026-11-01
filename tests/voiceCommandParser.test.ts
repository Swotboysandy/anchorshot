import { describe, expect, it } from 'vitest';
import { parseVoiceCommand } from '../src/services/voiceCommandParser';

// Cases adapted from BZcreativ's tests/voiceCommandParser.test.ts on feat/claude-sam-meta.
describe('voice command parser', () => {
  it('parses playback, help, audit and narration commands', () => {
    expect(parseVoiceCommand('play sequence')).toEqual({ kind: 'playback', action: 'play' });
    expect(parseVoiceCommand('pause')).toEqual({ kind: 'playback', action: 'stop' });
    expect(parseVoiceCommand('show shortcuts')).toEqual({ kind: 'help' });
    expect(parseVoiceCommand('verify continuity')).toEqual({ kind: 'audit' });
    expect(parseVoiceCommand('read me the storyboard')).toEqual({ kind: 'narrate' });
    expect(parseVoiceCommand('describe the sequence')).toEqual({ kind: 'narrate' });
  });

  it('parses fix commands with shot numbers in words, digits and ordinals up to 8', () => {
    expect(parseVoiceCommand('fix shot two')).toEqual({ kind: 'fix', shotNumber: 2, color: undefined });
    expect(parseVoiceCommand('repair scene #4 to cobalt')).toEqual({ kind: 'fix', shotNumber: 4, color: 'blue' });
    expect(parseVoiceCommand('fix the seventh shot')).toEqual({ kind: 'fix', shotNumber: 7, color: undefined });
    expect(parseVoiceCommand('fix it')).toEqual({ kind: 'fix', shotNumber: undefined, color: undefined });
  });

  it('parses recolour commands with object, colour synonyms and shot', () => {
    expect(parseVoiceCommand('make the car crimson in scene 2')).toEqual({ kind: 'recolor', object: 'car', color: 'red', shotNumber: 2 });
    expect(parseVoiceCommand('recolor the umbrella in shot 3 to gold')).toEqual({ kind: 'recolor', object: 'umbrella', color: 'amber', shotNumber: 3 });
    expect(parseVoiceCommand('uh please change jacket to emerald')).toEqual({ kind: 'recolor', object: 'jacket', color: 'emerald', shotNumber: undefined });
    expect(parseVoiceCommand('turn the cup to teal')).toEqual({ kind: 'recolor', object: 'cup', color: 'cyan', shotNumber: undefined });
  });

  it('treats a short bare colour as a rule update', () => {
    expect(parseVoiceCommand('emerald')).toEqual({ kind: 'rule_update', color: 'emerald' });
  });

  it('keeps story direction as direction even when it mentions colours or "read"', () => {
    const story = 'The courier rides through a red-lit market and reads the address on the package.';
    expect(parseVoiceCommand(story)).toEqual({ kind: 'rebuild', transcript: story.replace(/\.$/, '') });
    expect(parseVoiceCommand('She describes the storm to her brother').kind).toBe('rebuild');
  });
});
