import { describe, it, expect } from 'vitest';
import { parseVoiceCommand } from '../src/services/voiceCommandParser';

describe('Voice Command Parser (Parse-Then-Switch)', () => {
  describe('Regression Set (Existing Working Commands)', () => {
    it('parses playback directives', () => {
      expect(parseVoiceCommand('play')).toEqual({ kind: 'playback', action: 'play' });
      expect(parseVoiceCommand('play sequence')).toEqual({ kind: 'playback', action: 'play' });
      expect(parseVoiceCommand('start animatic')).toEqual({ kind: 'playback', action: 'play' });
      expect(parseVoiceCommand('stop')).toEqual({ kind: 'playback', action: 'stop' });
      expect(parseVoiceCommand('pause')).toEqual({ kind: 'playback', action: 'stop' });
    });

    it('parses help and shortcut directives', () => {
      expect(parseVoiceCommand('help')).toEqual({ kind: 'help' });
      expect(parseVoiceCommand('show shortcuts')).toEqual({ kind: 'help' });
      expect(parseVoiceCommand('open hotkeys')).toEqual({ kind: 'help' });
    });

    it('parses audit directives', () => {
      expect(parseVoiceCommand('audit')).toEqual({ kind: 'audit' });
      expect(parseVoiceCommand('check continuity')).toEqual({ kind: 'audit' });
      expect(parseVoiceCommand('verify continuity')).toEqual({ kind: 'audit' });
    });

    it('parses narration directives', () => {
      expect(parseVoiceCommand('narrate')).toEqual({ kind: 'narrate' });
      expect(parseVoiceCommand('read the storyboard')).toEqual({ kind: 'narrate' });
      expect(parseVoiceCommand('read me the storyboard')).toEqual({ kind: 'narrate' });
      expect(parseVoiceCommand('tell me the storyboard')).toEqual({ kind: 'narrate' });
      expect(parseVoiceCommand('describe the sequence')).toEqual({ kind: 'narrate' });
    });

    it('parses legacy fix shot directives', () => {
      expect(parseVoiceCommand('fix shot 2')).toEqual({ kind: 'fix', shotNumber: 2, color: undefined });
      expect(parseVoiceCommand('repair scene 3')).toEqual({ kind: 'fix', shotNumber: 3, color: undefined });
      expect(parseVoiceCommand('fix shot two')).toEqual({ kind: 'fix', shotNumber: 2, color: undefined });
      expect(parseVoiceCommand('fix scene #4')).toEqual({ kind: 'fix', shotNumber: 4, color: undefined });
    });
  });

  describe('SAM Object Detection & Segmentation Directives', () => {
    it('parses segment and detect commands', () => {
      expect(parseVoiceCommand('segment the cup')).toEqual({
        kind: 'segment',
        object: 'cup',
        shotNumber: undefined,
      });

      expect(parseVoiceCommand('detect the car in scene 2')).toEqual({
        kind: 'segment',
        object: 'car',
        shotNumber: 2,
      });

      expect(parseVoiceCommand('select umbrella in shot 1')).toEqual({
        kind: 'segment',
        object: 'umbrella',
        shotNumber: 1,
      });

      expect(parseVoiceCommand('track the coffee cup in scene three')).toEqual({
        kind: 'segment',
        object: 'coffee',
        shotNumber: 3,
      });
    });
  });

  describe('Direct SAM Object Recoloring Directives', () => {
    it('parses recolor commands with object, color and shot', () => {
      expect(parseVoiceCommand('turn the cup to blue')).toEqual({
        kind: 'recolor',
        object: 'cup',
        color: 'blue',
        shotNumber: undefined,
      });

      expect(parseVoiceCommand('make the car red in scene 2')).toEqual({
        kind: 'recolor',
        object: 'car',
        color: 'red',
        shotNumber: 2,
      });

      expect(parseVoiceCommand('recolor the umbrella in shot 3 to amber')).toEqual({
        kind: 'recolor',
        object: 'umbrella',
        color: 'amber',
        shotNumber: 3,
      });

      expect(parseVoiceCommand('change jacket to emerald')).toEqual({
        kind: 'recolor',
        object: 'jacket',
        color: 'emerald',
        shotNumber: undefined,
      });
    });

    it('maps color synonyms to canonical palette', () => {
      expect(parseVoiceCommand('turn the cup to cobalt')).toEqual({
        kind: 'recolor',
        object: 'cup',
        color: 'blue',
        shotNumber: undefined,
      });

      expect(parseVoiceCommand('make the car crimson in scene 2')).toEqual({
        kind: 'recolor',
        object: 'car',
        color: 'red',
        shotNumber: 2,
      });

      expect(parseVoiceCommand('recolor umbrella to gold')).toEqual({
        kind: 'recolor',
        object: 'umbrella',
        color: 'amber',
        shotNumber: undefined,
      });

      expect(parseVoiceCommand('make the car navy in shot 1')).toEqual({
        kind: 'recolor',
        object: 'car',
        color: 'blue',
        shotNumber: 1,
      });
    });
  });

  describe('Video Modification Directives', () => {
    it('parses video frame-by-frame modification commands', () => {
      expect(parseVoiceCommand('recolor video cup to blue')).toEqual({
        kind: 'modify_video',
        object: 'cup',
        color: 'blue',
      });

      expect(parseVoiceCommand('modify video umbrella to amber')).toEqual({
        kind: 'modify_video',
        object: 'umbrella',
        color: 'amber',
      });

      expect(parseVoiceCommand('track video car to emerald')).toEqual({
        kind: 'modify_video',
        object: 'car',
        color: 'emerald',
      });
    });
  });

  describe('Generative Inpainting Directives', () => {
    it('parses generative edit commands with prompt', () => {
      expect(parseVoiceCommand('generative edit: add warm steam rising from the cup')).toEqual({
        kind: 'generative_edit',
        prompt: 'add warm steam rising from the cup',
      });

      expect(parseVoiceCommand('inpaint: yellow wildflowers on the ground')).toEqual({
        kind: 'generative_edit',
        prompt: 'yellow wildflowers on the ground',
      });
    });
  });

  describe('Speech-to-Text Tolerance (Fillers & Punctuation)', () => {
    it('strips filler words like uh, um, please, can you', () => {
      expect(parseVoiceCommand('uh please recolor the cup to blue')).toEqual({
        kind: 'recolor',
        object: 'cup',
        color: 'blue',
        shotNumber: undefined,
      });

      expect(parseVoiceCommand('can you fix shot two, please?')).toEqual({
        kind: 'fix',
        shotNumber: 2,
        color: undefined,
      });
    });

    it('falls through to rebuild for narrative story direction text', () => {
      const story = 'A quiet morning in a sunlit kitchen. A woman drinks from a blue cup';
      expect(parseVoiceCommand(story)).toEqual({
        kind: 'rebuild',
        transcript: story,
      });
    });
  });
});

describe('spoken continuity rules', () => {
  it('treats a stated rule as a rule and a script as story', () => {
    expect(parseVoiceCommand('The jacket must be emerald.')).toEqual({ kind: 'rule_update', object: 'jacket', color: 'emerald' });
    expect(parseVoiceCommand('the cup must stay blue in every shot')).toEqual({ kind: 'rule_update', object: 'cup', color: 'blue' });
    expect(parseVoiceCommand('The jacket must be emerald. A courier rides home.').kind).toBe('rebuild');
  });
});

// Main-only cases: palette, shots 1-8 and story text that mentions commands.
describe('voice command parser on main', () => {
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
