import { afterEach, describe, expect, it, vi } from 'vitest';
import { DIRECTOR_PRESETS, MetaModelClient } from '../src/services/metaModels';
import { isGeneratedImage } from '../src/services/localGeneration';

afterEach(() => vi.unstubAllGlobals());

const stubServer = (image: (body: { prompt: string; seed: number }) => Response) => {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/health') return Response.json({ sessionToken: 't', imageModel: 'any-image-model' });
    if (url === '/api/muse/image') return image(JSON.parse(String(init?.body)));
    return Response.json({}, { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

describe('storyboard with a connected image model', () => {
  it('uses model frames, injects no discrepancy and leaves every shot unreviewed', async () => {
    const fetch = stubServer(({ seed }) =>
      Response.json({ url: `/api/muse/frames/${String(seed).padStart(64, '0')}.png`, width: 1024, height: 576, sourceHash: 'ab'.repeat(32) }),
    );
    const { shots } = await new MetaModelClient().generateStoryboardFromTranscript(DIRECTOR_PRESETS[0].transcript);
    expect(shots).toHaveLength(4);
    for (const shot of shots) {
      expect(isGeneratedImage(shot.currentImageUrl)).toBe(true);
      expect(shot.status).toBe('uncertain');
      expect(shot.proposedFix).toBeUndefined();
      expect(shot.spokenDescription).toMatch(/continuity unreviewed/);
    }
    const imageCalls = fetch.mock.calls.filter(([url]) => url === '/api/muse/image');
    expect(imageCalls).toHaveLength(4);
    expect(JSON.parse(String(imageCalls[0][1]?.body)).prompt).toMatch(/cup is blue/);
    expect(imageCalls[0][1]?.headers).toMatchObject({ 'X-Framelock-Session': 't' });
  });

  it('surfaces the server error instead of falling back to sample frames', async () => {
    stubServer(() => Response.json({ error: 'The session request limit has been reached.' }, { status: 429 }));
    await expect(
      new MetaModelClient().generateStoryboardFromTranscript(DIRECTOR_PRESETS[0].transcript),
    ).rejects.toThrow(/request limit/);
  });
});
