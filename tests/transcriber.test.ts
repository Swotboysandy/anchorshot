import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import {
  elevenLabsTranscriber,
  metaTranscriber,
  openAiTranscriber,
  readAudioDataUrl,
  transcriberFromSettings,
  TranscriberOutputError,
} from '../server/transcriber';

const clip = { bytes: Buffer.from('fake-webm'), mimeType: 'audio/webm' };
const audioUrl = `data:audio/webm;codecs=opus;base64,${Buffer.from('fake-webm').toString('base64')}`;

describe('transcription providers', () => {
  it('accepts browser recordings and rejects anything else before a call', () => {
    expect(readAudioDataUrl(audioUrl)).toMatchObject({ mimeType: 'audio/webm' });
    expect(readAudioDataUrl('data:video/webm;base64,AAAA')).toMatch(/Record WebM/);
    expect(readAudioDataUrl('data:audio/webm;base64,')).toMatch(/Record WebM/);
    expect(readAudioDataUrl(42)).toMatch(/Record WebM/);
  });

  it('sends audio to an OpenAI-compatible endpoint and tidies the text', async () => {
    const create = vi.fn().mockResolvedValue({ text: '  Keep the cup\n blue. ' });
    const result = await openAiTranscriber({ model: 'whisper-x', transcriptions: { create } as never }).transcribe(clip);
    expect(result).toEqual({ transcript: 'Keep the cup blue.', model: 'whisper-x', provenance: 'live-model', timestamps: [] });
    expect(create.mock.calls[0][0].file.name).toBe('director.webm');
  });

  it('calls ElevenLabs Scribe with the key header and keeps word timings', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        text: 'Cup blue',
        words: [
          { text: 'Cup', start: 0, end: 0.3, type: 'word' },
          { text: ' ', start: 0.3, end: 0.31, type: 'spacing' },
          { text: 'blue', start: 0.31, end: 0.6, type: 'word' },
        ],
      }),
    );
    const result = await elevenLabsTranscriber({ model: 'scribe_v2', apiKey: 'test', fetch }).transcribe(clip);
    expect(result.timestamps).toEqual([
      { word: 'Cup', start: 0, end: 0.3 },
      { word: 'blue', start: 0.31, end: 0.6 },
    ]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect(init.headers).toEqual({ 'xi-api-key': 'test' });
    expect((init.body as FormData).get('model_id')).toBe('scribe_v2');
  });

  it('treats silence as a model error and surfaces HTTP failures', async () => {
    const silent = openAiTranscriber({ model: 'm', transcriptions: { create: vi.fn().mockResolvedValue({ text: ' ' }) } as never });
    await expect(silent.transcribe(clip)).rejects.toThrow(TranscriberOutputError);
    const failing = elevenLabsTranscriber({ model: 's', apiKey: 'k', fetch: vi.fn().mockResolvedValue(new Response('', { status: 401 })) });
    await expect(failing.transcribe(clip)).rejects.toThrow(/status 401/);
  });

  it('keeps browser speech recognition unless a provider is fully configured', () => {
    expect(transcriberFromSettings({})).toBeUndefined();
    expect(transcriberFromSettings({ TRANSCRIBE_PROVIDER: 'elevenlabs' })).toBeUndefined();
    expect(transcriberFromSettings({ TRANSCRIBE_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'k' })?.model).toBe('scribe_v2');
    expect(
      transcriberFromSettings({ TRANSCRIBE_PROVIDER: 'openai-compatible', TRANSCRIBE_BASE_URL: 'http://127.0.0.1:1/v1', TRANSCRIBE_API_KEY: 'k', TRANSCRIBE_MODEL: 'w' })?.model,
    ).toBe('w');
  });
});

describe('/api/muse/transcribe with audio', () => {
  const post = async (app: ReturnType<typeof createApp>, body: object) => {
    const health = await request(app).get('/api/health');
    return request(app).post('/api/muse/transcribe').set('X-Anchorshot-Session', health.body.sessionToken).send(body);
  };

  it('keeps the text fixture and reports 501 for audio when no model is connected', async () => {
    const app = createApp({ settings: () => ({ key: '', requestLimit: 10 }) });
    expect((await post(app, { text: 'Keep the cup blue.' })).body.provenance).toBe('offline-fixture');
    expect((await post(app, { audio: audioUrl })).status).toBe(501);
  });

  it('transcribes with the connected model and counts it against the session limit', async () => {
    const create = vi.fn().mockResolvedValue({ text: 'Keep the umbrella red.' });
    const app = createApp({
      settings: () => ({ key: '', requestLimit: 1 }),
      transcriber: openAiTranscriber({ model: 'w', transcriptions: { create } as never }),
    });
    expect((await request(app).get('/api/health')).body.transcribeModel).toBe('w');
    expect((await post(app, { audio: 'data:audio/webm;base64,' })).status).toBe(400);
    const ok = await post(app, { audio: audioUrl });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ transcript: 'Keep the umbrella red.', model: 'w', provenance: 'live-model' });
    expect((await post(app, { audio: audioUrl })).status).toBe(429);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('maps empty speech to 502', async () => {
    const app = createApp({
      settings: () => ({ key: '', requestLimit: 10 }),
      transcriber: openAiTranscriber({ model: 'w', transcriptions: { create: vi.fn().mockResolvedValue({ text: '' }) } as never }),
    });
    const res = await post(app, { audio: audioUrl });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/heard no speech/);
  });
});

describe('Meta transcription', () => {
  it('sends WAV and the documented request fields to /asr/transcribe', async () => {
    const send = vi.fn().mockResolvedValue(Response.json({ transcript: 'Keep the cup blue.', turns: [] }));
    const convert = vi.fn().mockResolvedValue(Buffer.from('wav'));
    const result = await metaTranscriber({ apiKey: 'k', baseURL: 'https://api.meta.ai/v1', model: 'muse-voice-transcribe-1.0', fetch: send, convert }).transcribe(clip);
    expect(result.transcript).toBe('Keep the cup blue.');
    const [url, init] = send.mock.calls[0];
    expect(url).toBe('https://api.meta.ai/v1/asr/transcribe');
    expect(JSON.parse(await ((init.body as FormData).get('request') as Blob).text())).toEqual({ model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' });
    expect(transcriberFromSettings({ TRANSCRIBE_PROVIDER: 'meta', META_API_KEY: 'k' })?.model).toBe('muse-voice-transcribe-1.0');
  });
});
