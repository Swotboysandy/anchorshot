import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeOfflineSamSelection } from '../server/sam';
import { createApp } from '../server/app';
import { chatPlanner } from '../server/planner';
import { acceptFrame, openAiImager } from '../server/imager';
import { updateShotDetails, restoreShotTake } from '../src/lib/shotEdits';
import { exportAnimaticMp4, toDataUrl } from '../src/services/animaticExport';
import { isGeneratedShot } from '../src/services/localGeneration';
import type { StoryboardShot } from '../src/types/framelock';

const folders: string[] = [];
const folder = () => { const path = mkdtempSync(join(tmpdir(), 'anchorshot-audit-')); folders.push(path); return path; };
afterEach(() => { vi.unstubAllGlobals(); folders.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });
const png = (color: string, width = 4, height = 4) => sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
const url = (bytes: Buffer) => `data:image/png;base64,${bytes.toString('base64')}`;
const post = async (app: ReturnType<typeof createApp>, path: string, body: object) => {
  const health = await request(app).get('/api/health');
  return request(app).post(path).set('X-Anchorshot-Session', health.body.sessionToken).send(body);
};

describe('audit: every model attempt respects the shared budget', () => {
  it('counts planner retries and stops before the next provider call', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'invalid JSON' } }] });
    const app = createApp({ settings: () => ({ key: '', requestLimit: 1 }), planner: chatPlanner({ model: 'test', chat: { create } as never }) });
    expect((await post(app, '/api/muse/spark', { transcript: 'A blue cup.' })).status).toBe(429);
    expect(create).toHaveBeenCalledTimes(1);
    expect((await post(app, '/api/muse/spark', { transcript: 'Again.' })).status).toBe(429);
    expect(create).toHaveBeenCalledTimes(1);
    expect((await request(app).get('/api/health')).body.requestsUsed).toBe(1);
  });
  it('counts image-edit fallback as another provider attempt', async () => {
    const generate = vi.fn();
    const edit = vi.fn().mockResolvedValue(undefined);
    const imager = openAiImager({ model: 'test', images: { generate } as never, edit });
    const image = url(await png('#123456'));
    const frameFolder = folder();
    const filename = `${'a'.repeat(64)}.png`;
    writeFileSync(join(frameFolder, filename), await png('#123456'));
    const app = createApp({ settings: () => ({ key: '', requestLimit: 1 }), imager, frameFolder });
    const result = await post(app, '/api/muse/image', { prompt: 'Make it striped', targetObject: 'cup', references: [`/api/muse/frames/${filename}`] });
    expect(result.status).toBe(429);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });
  it('cannot spend through legacy hard-coded endpoints', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const app = createApp({ settings: () => ({ key: 'test-only', requestLimit: 0 }) });
    expect((await post(app, '/api/meta/generate-frame', { prompt: 'scene' })).status).toBe(410);
    expect((await post(app, '/api/meta/direct-video', { prompt: 'scene' })).status).toBe(501);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('audit: edits use measured pixels and never fabricated success', () => {
  it('requires a session, a real mask and a connected provider', async () => {
    const app = createApp({ settings: () => ({ key: '', requestLimit: 10 }) });
    const body = { imageBase64: url(await png('#123456')), prompt: 'stripes', maskBase64: url(await png('#fff')) };
    expect((await request(app).post('/api/meta/edit-frame').send(body)).status).toBe(403);
    expect((await post(app, '/api/meta/edit-frame', { ...body, maskBase64: undefined })).status).toBe(400);
    expect((await post(app, '/api/meta/edit-frame', body)).status).toBe(501);
  });
  it('measures the changed pixels and preserves every unselected RGBA byte', async () => {
    const source = await png('#123456');
    const generated = await acceptFrame(await png('#ff0000'), 'cup');
    const generate = vi.fn().mockResolvedValue({ ...generated, model: 'test-image', provenance: 'live-model', seed: 0 });
    const app = createApp({ settings: () => ({ key: '', requestLimit: 10 }), imager: { model: 'test-image', generate } });
    const mask = Buffer.alloc(4 * 4 * 4); mask.set([56, 189, 248, 255], 4 * 5);
    const maskBase64 = url(await sharp(mask, { raw: { width: 4, height: 4, channels: 4 } }).png().toBuffer());
    const result = await post(app, '/api/meta/edit-frame', { imageBase64: url(source), maskBase64, prompt: 'red stripe' });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ changedInside: 1, selectedPixels: 1, totalPixels: 16, outsideDrift: 0, verified: true, continuityStatus: 'uncertain' });
    const before = await sharp(source).ensureAlpha().raw().toBuffer();
    const after = await sharp(Buffer.from(result.body.editedImageUrl.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer();
    for (let i = 0; i < 16; i++) if (i !== 5) expect(after.subarray(i * 4, i * 4 + 4)).toEqual(before.subarray(i * 4, i * 4 + 4));
    const bad = await post(app, '/api/meta/edit-frame', { imageBase64: 'C:/private/image.png', maskBase64, prompt: 'edit' });
    expect(bad.status).toBe(400);
    const remote = await post(app, '/api/meta/edit-frame', { imageBase64: 'http://127.0.0.1/private', maskBase64, prompt: 'edit' });
    expect(remote.status).toBe(400);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('rejects mismatched and empty masks before spending', async () => {
    const generate = vi.fn();
    const app = createApp({ settings: () => ({ key: '', requestLimit: 10 }), imager: { model: 'test', generate } });
    const body = { imageBase64: url(await png('#123456')), prompt: 'edit' };
    expect((await post(app, '/api/meta/edit-frame', { ...body, maskBase64: url(await png('#fff', 2, 2)) })).status).toBe(400);
    expect((await post(app, '/api/meta/edit-frame', { ...body, maskBase64: url(await png('#00000000')) })).status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('audit: local video evidence is source-specific and honest', () => {
  it('does not invent scenes, speech, SAM confidence or checked continuity', async () => {
    const jobFolder = folder(); const id = '00000000-0000-0000-0000-000000000001'; const job = join(jobFolder, id); mkdirSync(job);
    writeFileSync(join(job, 'job.json'), JSON.stringify({ kind: 'video', status: 'completed', prompt: 'Ocean' }));
    writeFileSync(join(job, 'objects.json'), JSON.stringify([{ objectId: '0', label: 'cup', provenance: 'local-sam-3.1', confidence: 0.97 }]));
    const app = createApp({ settings: () => ({ key: '', requestLimit: 0 }), jobFolder });
    const result = await post(app, '/api/meta/video-understand', { jobId: id, shotIndex: 2, rules: [{ id: 'r', targetObject: 'cup', expectedValue: 'blue' }] });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ model: null, provenance: 'local-unverified', scenes: [], audioTranscription: null });
    expect(result.body.detectedObjects[0]).toMatchObject({ confidence: 0, requiresReview: true, provenance: 'unverified-proposal' });
    expect(result.body.findings[0]).toMatchObject({ status: 'uncertain', shotIndex: 2 });
    expect((await post(app, '/api/video/ingest-shots', { jobId: '../outside' })).status).toBe(400);
    expect((await post(app, '/api/video/ingest-shots', { jobId: id })).status).toBe(409);
    for (const index of [0, 4, 8, 12]) writeFileSync(join(job, `frame-${String(index).padStart(3, '0')}.png`), await png('#2255aa'));
    const ingested = await post(app, '/api/video/ingest-shots', { jobId: id });
    expect(ingested.status).toBe(200);
    expect(ingested.body.shots.every((shot: StoryboardShot) => shot.status === 'uncertain' && shot.promptDescription === 'Ocean')).toBe(true);
  });
});

describe('audit: metadata edits do not destroy selected media', () => {
  const shot: StoryboardShot = { id: 'shot-1', shotNumber: 1, promptDescription: 'Original', durationSeconds: 4,
    spokenDescription: 'Original', currentImageUrl: 'data:image/png;base64,edited', originalImageUrl: '/api/muse/frames/original.png',
    status: 'mismatch', revisions: [], proposedFix: { action: 'recolor', targetObject: 'cup', targetColor: 'blue' } };
  it('preserves the frame, masks and takes, while invalidating the prompt verdict', () => {
    const updated = updateShotDetails(shot, 'A new direction', 6);
    expect(updated.currentImageUrl).toBe(shot.currentImageUrl);
    expect(updated.proposedFix).toBe(shot.proposedFix);
    expect(updated.revisions).toBe(shot.revisions);
    expect(updated.status).toBe('uncertain');
    expect(updateShotDetails(shot, 'Original', 6).status).toBe('mismatch');
    expect(isGeneratedShot(updated)).toBe(true);
  });
  it.each([0, -1, NaN, Infinity, 16])('rejects duration %s', seconds => {
    expect(() => updateShotDetails(shot, 'valid', seconds)).toThrow();
  });
});

describe('audit: export errors cannot silently lose media', () => {
  const shot = { currentImageUrl: 'data:image/png;base64,AAAA', durationSeconds: 2 } as StoryboardShot;
  it('reports missing frames before encoding', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('missing', { status: 404 })));
    await expect(toDataUrl('/missing.png')).rejects.toThrow('missing');
  });
  it('does not fall back to still WebM when video or BITC would be lost', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path === '/api/health'
      ? Response.json({ sessionToken: 't' }) : Response.json({ error: 'ffmpeg unavailable' }, { status: 501 })));
    await expect(exportAnimaticMp4([shot])).resolves.toBeNull();
    await expect(exportAnimaticMp4([{ ...shot, videoUrl: '/local.mp4' }])).rejects.toThrow('ffmpeg unavailable');
    await expect(exportAnimaticMp4([shot], { burnInTimecode: true })).rejects.toThrow('ffmpeg unavailable');
  });
  it('reports an encoding failure instead of hiding it behind a fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path === '/api/health'
      ? Response.json({ sessionToken: 't' }) : Response.json({ error: 'encoding failed' }, { status: 500 })));
    await expect(exportAnimaticMp4([shot])).rejects.toThrow('encoding failed');
  });
});


it('restores video takes with their source offset and clears video when restoring a still', () => {
  const shot = {id:'s',shotNumber:1,durationSeconds:2,promptDescription:'',spokenDescription:'',originalImageUrl:'still',currentImageUrl:'video-poster',status:'consistent',videoUrl:'video',generatedJobId:'job',timestamp:0,
    revisions:[{revisionId:'still',timestamp:0,imageUrl:'still',actionApplied:'Still'}, {revisionId:'video',timestamp:1,imageUrl:'video-poster',videoUrl:'video',generatedJobId:'job',sourceTime:0.5,actionApplied:'Video'}]} as StoryboardShot;
  const still = restoreShotTake(shot,'still');
  expect(still.videoUrl).toBeUndefined();
  expect(still.generatedJobId).toBeUndefined();
  expect(still.status).toBe('uncertain');
  const video = restoreShotTake(still,'video');
  expect(video).toMatchObject({videoUrl:'video',generatedJobId:'job',timestamp:0.5,currentImageUrl:'video-poster',status:'uncertain'});
});


it('selects the actual alternate candidate without copying primary bounds or accepting invented confidence', async () => {
  const image = await png('#335577');
  const hash = (await import('node:crypto')).createHash('sha256').update(image).digest('hex');
  const app = createApp({settings:()=>({key:'test-only',requestLimit:2}),segment:async input=>{
    const fixture=await decodeOfflineSamSelection(input,1,0.92);
    const first=fixture.objects[0];
    return {...fixture,provenance:'live-sam-3.1',objects:[first,{...first,id:'second',objectId:'1',maskRef:'sam-3.1:cup:1:v1',bounds:{left:2,top:2,right:4,bottom:4},confidence:0.91}]};
  }});
  const checked=await post(app,'/api/segment/check',{image:url(image),sourceHash:hash,concept:'cup',shotNumber:2,ruleRevision:1});
  expect(checked.status).toBe(200);
  expect((await request(app).get('/api/masks?shotNumber=2')).body.tracks).toHaveLength(2);
  const selected=await post(app,'/api/masks/disambiguate',{sourceHash:hash,segmentationId:checked.body.requestId,maskSessionId:checked.body.maskSessionId,maskRef:checked.body.maskRef,selectedObjectId:'1',shotNumber:2,status:'consistent',confidence:1,bounds:{left:0,top:0,right:4,bottom:4}});
  expect(selected.status).toBe(200);
  expect(selected.body.track).toMatchObject({objectId:'1',maskRef:'sam-3.1:cup:1:v1',confidence:0.91,status:'uncertain',bounds:{left:2,top:2,right:4,bottom:4}});
  expect((await post(app,'/api/masks/disambiguate',{sourceHash:hash,segmentationId:checked.body.requestId,maskSessionId:checked.body.maskSessionId,maskRef:checked.body.maskRef,selectedObjectId:'missing',shotNumber:2})).status).toBe(404);
});

it('duration edits cannot shorten attached narration and preserve its source on valid edits',()=>{
 const shot:StoryboardShot={id:'audio',shotNumber:1,durationSeconds:4.4,promptDescription:'Story',spokenDescription:'Story',currentImageUrl:'frame.png',originalImageUrl:'frame.png',status:'uncertain',revisions:[],narrationDataUrl:'data:audio/wav;base64,AQID',narrationDurationSeconds:4,narrationName:'Story.wav'};
 expect(()=>updateShotDetails(shot,'Story',4)).toThrow('narration');
 expect(updateShotDetails(shot,'Edited story',5)).toMatchObject({durationSeconds:5,narrationDataUrl:shot.narrationDataUrl});
 expect(updateShotDetails({...shot,narrationDurationSeconds:undefined,narrationDataUrl:undefined},'Story',1).durationSeconds).toBe(1);
});
