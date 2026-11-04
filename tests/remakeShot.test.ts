import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetaModelClient } from '../src/services/metaModels';
import { StoryboardShot } from '../src/types';
import { describeAgentToolAction } from '../src/services/voiceAgent';
import { describeVoiceActionSummary, parseVoiceCommand } from '../src/services/voiceCommandParser';

afterEach(() => vi.unstubAllGlobals());

const sampleShot: StoryboardShot = {
  id: 'shot-2',
  shotNumber: 2,
  durationSeconds: 3.5,
  promptDescription: 'Medium shot of the detective holding a blue cup.',
  spokenDescription: 'Scene 2: Medium shot of the detective holding a blue cup.',
  currentImageUrl: 'data:image/svg+xml;utf8,<svg></svg>',
  originalImageUrl: 'data:image/svg+xml;utf8,<svg></svg>',
  mediaSource: 'sample',
  status: 'consistent',
  revisions: [
    {
      revisionId: 'rev-initial-2',
      timestamp: 1000,
      imageUrl: 'data:image/svg+xml;utf8,<svg></svg>',
      mediaSource: 'sample',
      actionApplied: 'Initial shot 2',
    },
  ],
};

describe('remakeSingleShot service', () => {
  it('remakes a single shot using connected video model and adds revision history', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/health') {
        return Response.json({ sessionToken: 'test-token', videoReady: true, imageModel: 'muse-image-1.0' });
      }
      if (url === '/api/muse/image') {
        return Response.json({ url: '/api/muse/frames/frame2.png', width: 1024, height: 576 });
      }
      if (url === '/api/muse/video') {
        return Response.json({
          id: 'job-remake-2',
          videoUrl: '/api/muse/videos/video2_remake.mp4',
          imageUrl: '/api/muse/frames/frame2_remake.png',
          fps: 25,
          seconds: 3.5,
          model: 'muse-video-wan',
        });
      }
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);

    const client = new MetaModelClient();
    const remade = await client.remakeSingleShot(sampleShot, 'A dramatic close up of the coffee cup', [
      { id: 'rule-1', targetObject: 'cup', property: 'color', expectedValue: 'blue', revision: 1 },
    ]);

    expect(remade.shotNumber).toBe(2);
    expect(remade.promptDescription).toBe('A dramatic close up of the coffee cup');
    expect(remade.videoUrl).toBe('/api/muse/videos/video2_remake.mp4');
    expect(remade.currentImageUrl).toBe('/api/muse/frames/frame2_remake.png');
    expect(remade.generatedJobId).toBe('job-remake-2');
    expect(remade.revisions.length).toBe(2);
    expect(remade.revisions[0].revisionId).toBe('rev-job-remake-2');
    expect(remade.revisions[1].revisionId).toBe('rev-initial-2');
  });

  it('remakes a single shot using image model when video model is not connected', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/health') {
        return Response.json({ sessionToken: 'test-token', videoReady: false, imageModel: 'muse-image-1.0' });
      }
      if (url === '/api/muse/image') {
        return Response.json({ url: '/api/muse/frames/image2_remake.png', width: 1024, height: 576 });
      }
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);

    const client = new MetaModelClient();
    const remade = await client.remakeSingleShot(sampleShot, undefined, [
      { id: 'rule-1', targetObject: 'cup', property: 'color', expectedValue: 'blue', revision: 1 },
    ]);

    expect(remade.shotNumber).toBe(2);
    expect(remade.currentImageUrl).toBe('/api/muse/frames/image2_remake.png');
    expect(remade.revisions.length).toBe(2);
  });
});

describe('remake voice parser and agent tool summaries', () => {
  it('parses individual scene remake vs all scenes', () => {
    expect(parseVoiceCommand('remake scene 2')).toEqual({ kind: 'remake_shot', shotNumber: 2, prompt: undefined });
    expect(parseVoiceCommand('redo shot 3 with a high angle')).toEqual({
      kind: 'remake_shot',
      shotNumber: 3,
      prompt: 'a high angle',
    });
    expect(parseVoiceCommand('regenerate this scene')).toEqual({ kind: 'remake_shot', shotNumber: undefined, prompt: undefined });
    expect(parseVoiceCommand('remake all')).toEqual({ kind: 'remake_shot', all: true });
    expect(parseVoiceCommand('remake all scenes')).toEqual({ kind: 'remake_shot', all: true });
  });

  it('provides spoken confirmation descriptions for remake actions', () => {
    expect(describeVoiceActionSummary('remake scene 2', true)).toBe('remake Scene 2 while keeping the other scenes');
    expect(describeVoiceActionSummary('remake this shot', true)).toBe('remake the highlighted scene while keeping the other scenes');
    expect(describeVoiceActionSummary('remake all scenes', true)).toBe('regenerate all 4 storyboard scenes');

    expect(describeAgentToolAction('remake_shot', { shot: 2 })).toBe('remake Scene 2 while keeping the other scenes');
    expect(describeAgentToolAction('remake_shot', { shot: 0 })).toBe('remake the highlighted scene while keeping the other scenes');
    expect(describeAgentToolAction('remake_shot', { shot: 3, direction: 'warm lighting' })).toBe(
      'remake Scene 3 while keeping the other scenes ("warm lighting")'
    );
  });
});
