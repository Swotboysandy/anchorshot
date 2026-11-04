import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { createApp } from '../server/app';
import { getCanonicalMetaModels, resolveUpstreamChatModel } from '../server/models';
import { chatPlanner } from '../server/planner';
import { chatAgent } from '../server/agent';
import { openAiTranscriber } from '../server/transcriber';
import { MetaModelClient, getMetaApiEnvConfig } from '../src/services/metaModels';
import {
  classifyVoiceConfirmationReply,
  describeVoiceActionSummary,
  parseVoiceCommand,
  resolveVoiceColor,
  normalizeVoiceObject,
} from '../src/services/voiceCommandParser';
import { describeAgentToolAction, isMutatingAgentTool } from '../src/services/voiceAgent';
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
    expect(resetRes.body).toEqual({
      ok: true,
      requestsUsed: 0,
      requestLimit: 1,
      resetsRemaining: 4,
    });

    expect((await postVideo()).status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('exempts SAM_PROVIDER=local from consuming cloud session requests even when META_API_KEY is set', async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 4, background: '#2255cc' },
    })
      .png()
      .toBuffer();
    const image = `data:image/png;base64,${png.toString('base64')}`;
    const sourceHash = createHash('sha256').update(png).digest('hex');
    const segment = vi.fn().mockResolvedValue({
      requestId: 'local-req',
      concept: 'cup',
      width: 8,
      height: 8,
      sourceHash,
      provenance: 'live-sam-3.1',
      objects: [
        {
          objectId: '0',
          label: 'cup',
          score: 0.96,
          bounds: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
          mask: `data:image/png;base64,${png.toString('base64')}`,
          maskRef: 'sam-3.1:cup:0:v1',
        },
      ],
    });
    const app = createApp({
      settings: () => ({ key: 'cloud-key', samProvider: 'local', requestLimit: 0 }),
      segment,
    });
    const health = (await request(app).get('/api/health')).body;
    expect(health.configured).toBe(true);

    const segRes = await request(app)
      .post('/api/segment')
      .set('X-Anchorshot-Session', health.sessionToken)
      .send({ image, concept: 'cup', sourceHash });
    expect(segRes.status).toBe(200);

    const checkRes = await request(app)
      .post('/api/segment/check')
      .set('X-Anchorshot-Session', health.sessionToken)
      .send({ image, concept: 'cup', sourceHash, shotNumber: 1, ruleRevision: 1 });
    expect(checkRes.status).toBe(200);
    expect(segment).toHaveBeenCalledTimes(2);
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

describe('OpenRouter and canonical Meta model ID consistency', () => {
  it('exposes the 4 canonical Meta model IDs consistently across server and client config', () => {
    const serverModels = getCanonicalMetaModels({
      VITE_MUSE_VOICE_MODEL: 'muse-voice-transcribe-1.0',
      VITE_MUSE_SPARK_MODEL: 'muse-spark-1.3',
      VITE_MUSE_IMAGE_MODEL: 'muse-image-1.0',
      VITE_SAM3_MODEL: 'sam-3.1',
    });
    expect(serverModels).toEqual({
      voice: 'muse-voice-transcribe-1.0',
      spark: 'muse-spark-1.3',
      image: 'muse-image-1.0',
      sam: 'sam-3.1',
    });

    const clientModels = getMetaApiEnvConfig().models;
    expect(clientModels).toEqual({
      voiceTranscribe: 'muse-voice-transcribe-1.0',
      spark: 'muse-spark-1.3',
      image: 'muse-image-1.0',
      sam: 'sam-3.1',
    });
  });

  it('routes OpenRouter requests using the upstream Llama slug while reporting canonical Meta model IDs', async () => {
    expect(
      resolveUpstreamChatModel('https://openrouter.ai/api/v1', 'muse-spark-1.3', {
        OPENROUTER_SPARK_MODEL: 'meta-llama/llama-3.3-70b-instruct',
      })
    ).toBe('meta-llama/llama-3.3-70b-instruct');

    const plannerChat = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"rules":[{"targetObject":"cup","expectedValue":"blue"}]}' } }],
    });
    const planner = chatPlanner({
      model: 'muse-spark-1.3',
      upstreamModel: 'meta-llama/llama-3.3-70b-instruct',
      chat: { create: plannerChat } as never,
    });
    const planRes = await planner.plan('Keep the cup blue.', 1);
    expect(planRes.model).toBe('muse-spark-1.3');
    expect(plannerChat.mock.calls[0][0].model).toBe('meta-llama/llama-3.3-70b-instruct');

    const agentChat = vi.fn().mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'Ready.' } }],
    });
    const agent = chatAgent({
      model: 'muse-spark-1.3',
      upstreamModel: 'meta-llama/llama-3.3-70b-instruct',
      chat: { create: agentChat } as never,
    });
    expect(agent.model).toBe('muse-spark-1.3');
    await agent.turn([{ role: 'user', content: 'Hello' }]);
    expect(agentChat.mock.calls[0][0].model).toBe('meta-llama/llama-3.3-70b-instruct');

    const transcribeCreate = vi.fn().mockResolvedValue({ text: 'change the jacket to red' });
    const transcriber = openAiTranscriber({
      model: 'muse-voice-transcribe-1.0',
      upstreamModel: 'whisper-1',
      transcriptions: { create: transcribeCreate } as never,
    });
    const transRes = await transcriber.transcribe({
      bytes: Buffer.from('fake-webm'),
      mimeType: 'audio/webm',
    });
    expect(transRes.model).toBe('muse-voice-transcribe-1.0');
    expect(transcribeCreate.mock.calls[0][0].model).toBe('whisper-1');
  });
});

describe('voice object editing in the scene', () => {
  it('parses natural spoken commands to change or replace objects in a scene', () => {
    expect(parseVoiceCommand('change the coffee cup to red in shot 2')).toEqual({
      kind: 'recolor',
      object: 'cup',
      color: 'red',
      shotNumber: 2,
    });
    expect(parseVoiceCommand('in shot 3 change the courier jacket to emerald')).toEqual({
      kind: 'recolor',
      object: 'jacket',
      color: 'emerald',
      shotNumber: 3,
    });
    expect(parseVoiceCommand('replace the cup with a glowing lantern in shot 2')).toEqual({
      kind: 'generative_edit',
      object: 'cup',
      prompt: 'a glowing lantern',
      shotNumber: 2,
    });
    expect(parseVoiceCommand('edit the jacket to a leather trench coat')).toEqual({
      kind: 'generative_edit',
      object: 'jacket',
      prompt: 'a leather trench coat',
      shotNumber: undefined,
    });
    expect(resolveVoiceColor('make it crimson red')).toBe('red');
    expect(normalizeVoiceObject('the courier jacket')).toBe('jacket');
  });

  it('classifies spoken confirmation vs repeat/cancel replies and summarizes pending voice actions', () => {
    expect(classifyVoiceConfirmationReply('yes')).toBe('confirm');
    expect(classifyVoiceConfirmationReply('uh please confirm')).toBe('confirm');
    expect(classifyVoiceConfirmationReply('go ahead')).toBe('confirm');
    expect(classifyVoiceConfirmationReply('repeat')).toBe('repeat');
    expect(classifyVoiceConfirmationReply('no, try again')).toBe(null);
    expect(classifyVoiceConfirmationReply('try again')).toBe('repeat');
    expect(classifyVoiceConfirmationReply('mistake')).toBe('repeat');
    expect(classifyVoiceConfirmationReply('cancel')).toBe('cancel');
    expect(classifyVoiceConfirmationReply('change the cup to blue')).toBe(null);

    expect(describeVoiceActionSummary('change the coffee cup to red in shot 2', true)).toBe(
      'change the cup to red in Shot 2'
    );
    expect(describeVoiceActionSummary('A rainy street at night', false)).toBe(
      'generate a 4-scene storyboard from your spoken description'
    );

    expect(isMutatingAgentTool('describe_storyboard')).toBe(false);
    expect(isMutatingAgentTool('select_shot', { number: 2 })).toBe(false);
    expect(isMutatingAgentTool('run_command', { command: 'play' })).toBe(false);
    expect(isMutatingAgentTool('run_command', { command: 'change the cup to red' })).toBe(true);
    expect(isMutatingAgentTool('generate_storyboard')).toBe(true);
    expect(isMutatingAgentTool('edit_object', { object: 'jacket', instruction: 'red', shot: 2 })).toBe(true);
    expect(describeAgentToolAction('edit_object', { object: 'jacket', instruction: 'red', shot: 2 })).toBe(
      'change the jacket (red) in Shot 2'
    );
  });
});
