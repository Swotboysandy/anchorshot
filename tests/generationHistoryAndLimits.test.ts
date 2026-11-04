import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import { MetaModelClient } from '../src/services/metaModels';
import {
  describeGenerationPrompt,
  formatGenerationTimestamp,
  type LocalJob,
} from '../src/services/localGeneration';
import { buildHistoryEntries } from '../src/components/GenerationHistoryPanel';

afterEach(() => vi.unstubAllGlobals());

describe('session request limit handling and reset', () => {
  it('resets requestsUsed via POST /api/session/reset when given a valid session token', async () => {
    const generate = vi.fn().mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      model: 'Wan 2.2',
      fps: 25,
      seconds: 3.8,
      frames: 95,
      imageUrl: '/api/local-ai/jobs/11111111-1111-1111-1111-111111111111/assets/frame-000.png',
      videoUrl: '/api/local-ai/jobs/11111111-1111-1111-1111-111111111111/assets/generated-video.mp4',
    });
    const app = createApp({
      settings: () => ({ key: 'cloud-key', requestLimit: 1 }),
      video: { model: 'Wan 2.2', generate },
    });

    const health = (await request(app).get('/api/health')).body;
    const postVideo = () =>
      request(app)
        .post('/api/muse/video')
        .set('X-Anchorshot-Session', health.sessionToken)
        .send({ prompt: 'Move the scene outdoors' });

    expect((await postVideo()).status).toBe(200);
    expect((await postVideo()).status).toBe(429);

    // Without session token -> 403
    expect((await request(app).post('/api/session/reset')).status).toBe(403);

    // With session token -> resets requestsUsed to 0 and allows the edit to proceed
    const resetRes = await request(app)
      .post('/api/session/reset')
      .set('X-Anchorshot-Session', health.sessionToken);
    expect(resetRes.status).toBe(200);
    expect(resetRes.body).toEqual({ ok: true, requestsUsed: 0, requestLimit: 1 });

    expect((await postVideo()).status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('preserves completed partial shots when a multi-shot film hits the session request limit on a later shot', async () => {
    let videoCall = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/health') {
        return Response.json({
          videoReady: true,
          plannerLive: true,
          sessionToken: 'test-token',
          filmShots: 4,
        });
      }
      if (url === '/api/muse/spark') {
        return Response.json({
          provenance: 'live-model',
          rules: [],
          shots: [
            { subject: 'Jen and the courier outside', seconds: 4 },
            { subject: 'Jen looking at the courier', seconds: 4 },
            { subject: 'The courier handing Jen a package', seconds: 4 },
            { subject: 'Jen opening the package outdoors', seconds: 4 },
          ],
        });
      }
      videoCall++;
      if (videoCall <= 3) {
        return Response.json({
          id: `clip-${videoCall}`,
          model: 'Wan 2.2',
          fps: 25,
          seconds: 3.88,
          frames: 97,
          imageUrl: `/api/local-ai/jobs/clip-${videoCall}/assets/frame-000.png`,
          videoUrl: `/api/local-ai/jobs/clip-${videoCall}/assets/generated-video.mp4`,
        });
      }
      return new Response(
        JSON.stringify({
          error: 'The session request limit has been reached. No further call was sent.',
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new MetaModelClient();
    let caughtError: (Error & { partialShots?: unknown[]; plannedCount?: number }) | undefined;
    try {
      await client.generateFilmFromTranscript('Move the scene outdoors');
    } catch (err) {
      caughtError = err as Error & { partialShots?: unknown[]; plannedCount?: number };
    }

    expect(caughtError).toBeDefined();
    expect(caughtError?.message).toMatch(/session request limit/i);
    expect(caughtError?.partialShots).toHaveLength(3);
    expect(caughtError?.plannedCount).toBe(4);
  });
});

describe('generation history descriptive naming, timestamps, and sequence grouping', () => {
  it('extracts descriptive titles, framing, setting, and cast from structured SHOT prompts', () => {
    const rawPrompt = [
      'IDENTITY LOCK',
      'JEN: 20s, dark hair, wearing a tan trench coat',
      'COURIER: 30s, wearing a dark blue jacket and cap',
      '',
      'SHOT',
      'Medium shot, static camera, eye-level angle. Medium shot of the courier handing Jen a package. Set in a sunlit city street with brick buildings. Natural daylight.',
    ].join('\n');

    const desc = describeGenerationPrompt(rawPrompt, 'video');
    expect(desc.title).toBe('The courier handing Jen a package — Medium shot');
    expect(desc.subject).toBe('The courier handing Jen a package');
    expect(desc.framing).toBe('Medium shot');
    expect(desc.setting).toBe('A sunlit city street with brick buildings');
    expect(desc.cast).toEqual(['Jen', 'Courier']);
  });

  it('formats creation timestamps and groups multi-shot generation sequences', () => {
    const jobs: LocalJob[] = [
      {
        id: '64d44465-a962-4a8f-8a62-bbb8ae90f8c8',
        kind: 'video',
        status: 'completed',
        seed: 42,
        createdAt: '2026-11-03T23:20:15.000Z',
        message: 'Generated on modal',
        prompt:
          'IDENTITY LOCK\nJEN: 20s\nCOURIER: 30s\n\nSHOT\nEstablishing shot, static camera, eye-level angle. Jen and the courier outside. Set in a city street.',
        report: { frames: 97, seconds: 3.88, fps: 25, model: 'Wan 2.2 TI2V-5B' },
      },
      {
        id: '56eed539-a2ba-4734-907b-479676478d96',
        kind: 'video',
        status: 'completed',
        seed: 42,
        createdAt: '2026-11-03T23:21:41.000Z',
        message: 'Generated on modal',
        prompt:
          'IDENTITY LOCK\nJEN: 20s\nCOURIER: 30s\n\nSHOT\nMedium shot, static camera, eye-level angle. Jen looking at the courier. Set in a city street.',
        report: { frames: 97, seconds: 3.88, fps: 25, model: 'Wan 2.2 TI2V-5B' },
      },
      {
        id: '1ed7d002-8c89-4cad-9cc9-e73125e7bddd',
        kind: 'video',
        status: 'completed',
        seed: 42,
        createdAt: '2026-11-03T23:23:06.000Z',
        message: 'Generated on modal',
        prompt:
          'IDENTITY LOCK\nJEN: 20s\nCOURIER: 30s\n\nSHOT\nMedium shot, static camera, eye-level angle. The courier handing Jen a package. Set in a city street.',
        report: { frames: 97, seconds: 3.88, fps: 25, model: 'Wan 2.2 TI2V-5B' },
      },
    ];

    const { entries, sequences } = buildHistoryEntries(jobs);
    expect(entries).toHaveLength(3);
    // Newest first in entries
    expect(entries[0].id).toBe('1ed7d002-8c89-4cad-9cc9-e73125e7bddd');
    expect(entries[0].title).toBe('The courier handing Jen a package — Medium shot');
    expect(entries[0].thumbnailUrl).toBe(
      '/api/local-ai/jobs/1ed7d002-8c89-4cad-9cc9-e73125e7bddd/assets/frame-000.png'
    );
    expect(entries[0].formattedDate).toBe(formatGenerationTimestamp('2026-11-03T23:23:06.000Z'));

    // Grouped into a 3-scene sequence in story order
    expect(sequences).toHaveLength(1);
    expect(sequences[0].entries).toHaveLength(3);
    expect(sequences[0].entries[0].subject).toBe('Jen and the courier outside');
    expect(sequences[0].entries[2].subject).toBe('The courier handing Jen a package');
  });
});
