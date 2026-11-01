import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../server/app';
import { acceptFrame, imagerFromSettings, ImagerOutputError, openAiImager } from '../server/imager';

const solid = (format: 'png' | 'webp', width = 64, height = 36) =>
  sharp({ create: { width, height, channels: 3, background: '#2255cc' } })[format]().toBuffer();
const imagesReturning = async (bytes?: Buffer) => ({
  generate: vi.fn().mockResolvedValue({ data: bytes ? [{ b64_json: bytes.toString('base64') }] : [] }),
});

describe('image providers', () => {
  it('normalises any model output to a hashed PNG that SAM accepts', async () => {
    const frame = await acceptFrame(await solid('webp'), 'cup');
    expect(frame.image).toMatch(/^data:image\/png;base64,/);
    expect(frame).toMatchObject({ concept: 'cup', width: 64, height: 36 });
    expect(frame.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects unreadable or oversized output instead of passing it on', async () => {
    await expect(acceptFrame(Buffer.from('not an image'), 'cup')).rejects.toThrow(ImagerOutputError);
    await expect(acceptFrame(await solid('png', 1700, 100), 'cup')).rejects.toThrow(ImagerOutputError);
  });

  it('calls an OpenAI-compatible endpoint and tags the frame with model and seed', async () => {
    const images = await imagesReturning(await solid('png'));
    const frame = await openAiImager({ model: 'any-image-model', images: images as never }).generate({
      prompt: 'Wide shot, blue cup on the counter',
      targetObject: 'cup',
      seed: 17,
    });
    expect(frame).toMatchObject({ model: 'any-image-model', provenance: 'live-model', seed: 17 });
    expect(images.generate.mock.calls[0][0]).toMatchObject({ response_format: 'b64_json', size: '1024x576' });
  });

  it('reports an empty reply as a model error', async () => {
    const images = await imagesReturning();
    await expect(
      openAiImager({ model: 'm', images: images as never }).generate({ prompt: 'x', targetObject: 'cup', seed: 0 }),
    ).rejects.toThrow(/returned no image data/);
  });

  it('stays offline unless a provider is fully configured', () => {
    expect(imagerFromSettings({})).toBeUndefined();
    expect(imagerFromSettings({ IMAGE_PROVIDER: 'openai-compatible', IMAGE_MODEL: 'm' })).toBeUndefined();
    expect(
      imagerFromSettings({ IMAGE_PROVIDER: 'openai-compatible', IMAGE_BASE_URL: 'http://127.0.0.1:1/v1', IMAGE_API_KEY: 'test', IMAGE_MODEL: 'm' }),
    ).toBeDefined();
  });
});

describe('/api/muse/image', () => {
  const post = async (app: ReturnType<typeof createApp>, body: object) => {
    const health = await request(app).get('/api/health');
    return request(app).post('/api/muse/image').set('X-Anchorshot-Session', health.body.sessionToken).send(body);
  };
  const shot = { prompt: 'Close-up of the blue cup', targetObject: 'cup', seed: 3 };

  it('returns 501 when no image model is connected', async () => {
    const res = await post(createApp({ settings: () => ({ key: '', requestLimit: 10 }) }), shot);
    expect(res.status).toBe(501);
  });

  it('serves a checked frame and counts it against the session limit', async () => {
    const images = await imagesReturning(await solid('png'));
    const app = createApp({
      settings: () => ({ key: '', requestLimit: 1 }),
      imager: openAiImager({ model: 'm', images: images as never }),
    });
    expect((await request(app).get('/api/health')).body.imageModel).toBe('m');
    const first = await post(app, shot);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ model: 'm', concept: 'cup', seed: 3 });
    expect(first.body.image).toBeUndefined();
    expect(first.body.url).toBe(`/api/muse/frames/${first.body.sourceHash}.png`);
    const served = await request(app).get(first.body.url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toMatch(/image\/png/);
    expect((await request(app).get('/api/muse/frames/../secret.png')).status).toBe(404);
    expect((await post(app, shot)).status).toBe(429);
    expect(images.generate).toHaveBeenCalledTimes(1);
  });

  it('rejects bad input before any call and maps bad output to 502', async () => {
    const images = await imagesReturning(Buffer.from('junk'));
    const app = createApp({
      settings: () => ({ key: '', requestLimit: 10 }),
      imager: openAiImager({ model: 'm', images: images as never }),
    });
    expect((await post(app, { ...shot, prompt: '' })).status).toBe(400);
    expect(images.generate).not.toHaveBeenCalled();
    expect((await post(app, shot)).status).toBe(502);
  });
});
