import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../server/app';
import { cachedNarrator } from '../server/narrator';
import { ffmpegAvailable, formatSmpteTimecode, renderAnimatic } from '../server/animatic';

const frame = (background: string) =>
  sharp({ create: { width: 800, height: 450, channels: 3, background } }).png().toBuffer();
const dataUrl = async (background: string) => `data:image/png;base64,${(await frame(background)).toString('base64')}`;
const hasFfmpeg = await ffmpegAvailable();

describe.skipIf(!hasFfmpeg)('animatic encoding with local ffmpeg', () => {
  it('holds each frame for its duration and produces H.264 video with AAC audio', async () => {
    const video = await renderAnimatic([
      { image: await frame('#2255cc'), seconds: 1 },
      { image: await frame('#cc5522'), seconds: 1.5 },
    ]);
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'animatic-test-')), 'out.mp4');
    writeFileSync(file, video);
    const probe = JSON.parse(
      execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' }),
    );
    expect(probe.streams.map((s: { codec_name: string }) => s.codec_name).sort()).toEqual(['aac', 'h264']);
    expect(probe.streams.find((s: { width?: number }) => s.width)).toMatchObject({ width: 1280, height: 720 });
    expect(Number(probe.format.duration)).toBeCloseTo(2.5, 0);
  }, 60_000);

  it('stretches a shot so its narration is never cut off', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'animatic-test-'));
    const voice = path.join(folder, 'voice.mp3');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', voice]);
    const video = await renderAnimatic([
      { image: await frame('#2255cc'), seconds: 1, narration: readFileSync(voice) },
      { image: await frame('#cc5522'), seconds: 1 },
    ]);
    const file = path.join(folder, 'out.mp4');
    writeFileSync(file, video);
    const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }));
    expect(duration).toBeGreaterThan(4.2);
    expect(duration).toBeLessThan(4.8);
  }, 60_000);
});

describe('/api/export/animatic', () => {
  const post = async (app: ReturnType<typeof createApp>, body: object) => {
    const health = await request(app).get('/api/health');
    return request(app).post('/api/export/animatic').set('X-Anchorshot-Session', health.body.sessionToken).send(body);
  };

  it('validates shots before encoding', async () => {
    const render = vi.fn();
    const app = createApp({ settings: () => ({ key: '', requestLimit: 10 }), renderAnimatic: render, ffmpegAvailable: async () => true });
    expect((await post(app, { shots: [] })).status).toBe(400);
    expect((await post(app, { shots: [{ image: 'data:text/html;base64,AAAA', seconds: 2 }] })).status).toBe(400);
    expect((await post(app, { shots: [{ image: await dataUrl('#000'), seconds: 60 }] })).status).toBe(400);
    expect(render).not.toHaveBeenCalled();
  });

  it('reports 501 when ffmpeg is missing', async () => {
    const app = createApp({ settings: () => ({ key: '', requestLimit: 10 }), ffmpegAvailable: async () => false });
    expect((await post(app, { shots: [{ image: await dataUrl('#000'), seconds: 2 }] })).status).toBe(501);
  });

  it('adds narration within the budget and leaves the rest silent', async () => {
    const render = vi.fn().mockResolvedValue(Buffer.from('mp4'));
    const speak = vi.fn().mockResolvedValue(Buffer.from('mp3'));
    const app = createApp({
      settings: () => ({ key: '', requestLimit: 10 }),
      narrator: cachedNarrator({ model: 'm', voice: 'v', speak }, mkdtempSync(path.join(tmpdir(), 'narr-'))),
      narrationCharLimit: 10,
      renderAnimatic: render,
      ffmpegAvailable: async () => true,
    });
    const res = await post(app, {
      shots: [
        { image: await dataUrl('#111'), seconds: 2, narration: 'Shot one.' },
        { image: await dataUrl('#222'), seconds: 3, narration: 'Shot two is far too long for the budget.' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/video\/mp4/);
    expect(res.headers['x-anchorshot-narrated-shots']).toBe('1');
    const [shots] = render.mock.calls[0];
    expect(shots.map((s: { seconds: number; narration?: Buffer }) => [s.seconds, Boolean(s.narration)])).toEqual([
      [2, true],
      [3, false],
    ]);
  });

  it('formats SMPTE timecode at 30 fps correctly', () => {
    expect(formatSmpteTimecode(0)).toBe('00:00:00:00');
    expect(formatSmpteTimecode(1)).toBe('00:00:01:00');
    expect(formatSmpteTimecode(1.5)).toBe('00:00:01:15');
    expect(formatSmpteTimecode(65.1)).toBe('00:01:05:03');
  });

  it('passes burnInTimecode flag from request body to renderAnimatic', async () => {
    const render = vi.fn().mockResolvedValue(Buffer.from('mp4'));
    const app = createApp({
      settings: () => ({ key: '', requestLimit: 10 }),
      renderAnimatic: render,
      ffmpegAvailable: async () => true,
    });
    const res = await post(app, {
      burnInTimecode: true,
      shots: [{ image: await dataUrl('#333'), seconds: 2 }],
    });
    expect(res.status).toBe(200);
    expect(render).toHaveBeenCalledWith(
      expect.any(Array),
      undefined,
      undefined,
      { burnInTimecode: true }
    );
  });
});
