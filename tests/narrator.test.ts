import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import { cachedNarrator, elevenLabsNarrator, narratorFromSettings, NarratorOutputError } from '../server/narrator';

const mp3 = (bytes = 'ID3-fake') => new Response(bytes, { headers: { 'content-type': 'audio/mpeg' } });
const folder = () => mkdtempSync(path.join(tmpdir(), 'narration-'));

describe('narration providers', () => {
  it('calls ElevenLabs text-to-speech with the voice, model and key', async () => {
    const fetch = vi.fn().mockResolvedValue(mp3());
    const audio = await elevenLabsNarrator({ apiKey: 'k', voice: 'v1', model: 'eleven_flash_v2_5', fetch }).speak('Shot one.');
    expect(audio.toString()).toBe('ID3-fake');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/v1?output_format=mp3_44100_128');
    expect(init.headers).toMatchObject({ 'xi-api-key': 'k' });
    expect(JSON.parse(init.body)).toEqual({ text: 'Shot one.', model_id: 'eleven_flash_v2_5' });
  });

  it('rejects non-audio replies and surfaces HTTP failures', async () => {
    const json = vi.fn().mockResolvedValue(Response.json({ detail: 'x' }));
    await expect(elevenLabsNarrator({ apiKey: 'k', voice: 'v', model: 'm', fetch: json }).speak('a')).rejects.toThrow(NarratorOutputError);
    const denied = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    await expect(elevenLabsNarrator({ apiKey: 'k', voice: 'v', model: 'm', fetch: denied }).speak('a')).rejects.toThrow(/status 401/);
  });

  it('pays for each sentence once and replays it from disk', async () => {
    const speak = vi.fn().mockResolvedValue(Buffer.from('clip'));
    const narrator = cachedNarrator({ model: 'm', voice: 'v', speak }, folder());
    expect(narrator.cached('Shot two.')).toBe(false);
    await narrator.speak('Shot two.');
    expect(narrator.cached('Shot two.')).toBe(true);
    expect((await narrator.speak('Shot two.')).toString()).toBe('clip');
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it('keeps the browser voice unless ElevenLabs narration is fully configured', () => {
    expect(narratorFromSettings({}, folder())).toBeUndefined();
    expect(narratorFromSettings({ NARRATION_PROVIDER: 'elevenlabs' }, folder())).toBeUndefined();
    const narrator = narratorFromSettings({ NARRATION_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'k' }, folder());
    expect(narrator).toMatchObject({ model: 'eleven_flash_v2_5', voice: 'JBFqnCBsd6RMkjVDRZzb' });
  });
});

describe('/api/muse/speak', () => {
  const post = async (app: ReturnType<typeof createApp>, text: string) => {
    const health = await request(app).get('/api/health');
    return request(app).post('/api/muse/speak').set('X-Anchorshot-Session', health.body.sessionToken).send({ text });
  };

  it('returns 501 without a narration voice', async () => {
    expect((await post(createApp({ settings: () => ({ key: '', requestLimit: 10 }) }), 'Hi.')).status).toBe(501);
  });

  it('serves MP3, replays cached text free and stops new text at the budget', async () => {
    const speak = vi.fn().mockResolvedValue(Buffer.from('clip'));
    const app = createApp({
      settings: () => ({ key: '', requestLimit: 10 }),
      narrator: cachedNarrator({ model: 'm', voice: 'v', speak }, folder()),
      narrationCharLimit: 12,
    });
    expect((await request(app).get('/api/health')).body.narrationModel).toBe('m');
    const first = await post(app, 'Shot one.');
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toMatch(/audio\/mpeg/);
    expect((await post(app, 'Shot one.')).status).toBe(200);
    expect((await post(app, 'Shot four.')).status).toBe(429);
    expect((await post(app, '')).status).toBe(400);
    expect(speak).toHaveBeenCalledTimes(1);
  });
});
