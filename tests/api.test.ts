import { createHash } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import type { ResponsesEvent } from '@meta-sam/parser';
import { createApp } from '../server/app';
import {
  checkInput,
  decodeSelection,
  evaluateSamContinuityCheck,
  requestSam,
  type CheckedInput,
} from '../server/sam';

let body: { image: string; concept: string; sourceHash: string };
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#cc5533' } })
    .png()
    .toBuffer();
  body = {
    image: `data:image/png;base64,${bytes.toString('base64')}`,
    concept: 'cup',
    sourceHash: createHash('sha256').update(bytes).digest('hex'),
  };
});

describe('local SAM boundary', () => {
  it('validates the actual image and hash before spending a request', async () => {
    expect((await checkInput(body)).width).toBe(2);
    await expect(checkInput({ ...body, image: 'http://127.0.0.1/private' })).rejects.toThrow(
      'Upload',
    );
    await expect(checkInput({ ...body, sourceHash: 'stale' })).rejects.toThrow('changed');
    await expect(checkInput({ ...body, concept: 'cup\nchair' })).rejects.toThrow('short');
  });
  it('reports missing configuration and makes no model call', async () => {
    const segment = vi.fn();
    const app = createApp({ settings: () => ({ key: '', requestLimit: 10 }), segment });
    const health = await request(app).get('/api/health');
    expect(health.body.configured).toBe(false);
    const response = await request(app)
      .post('/api/segment')
      .set('X-Framelock-Session', health.body.sessionToken)
      .send(body);
    expect(response.status).toBe(503);
    expect(segment).not.toHaveBeenCalled();
  });
  it('blocks cross-origin, invalid-host and tokenless paid requests', async () => {
    const segment = vi.fn();
    const app = createApp({ settings: () => ({ key: 'test-key', requestLimit: 10 }), segment });
    expect((await request(app).get('/api/health').set('Host', 'untrusted.example')).status).toBe(
      403,
    );
    expect(
      (await request(app).get('/api/health').set('Origin', 'https://untrusted.example')).status,
    ).toBe(403);
    expect((await request(app).post('/api/segment').send(body)).status).toBe(403);
    expect(segment).not.toHaveBeenCalled();
  });
  it('limits provider attempts and does not return the key', async () => {
    const segment = vi.fn(async () => ({
      requestId: 'test',
      sourceHash: body.sourceHash,
      objects: [],
    }));
    const app = createApp({
      settings: () => ({ key: 'private-test-secret', requestLimit: 1 }),
      segment,
    });
    const health = await request(app).get('/api/health');
    expect(JSON.stringify(health.body)).not.toContain('private-test-secret');
    const send = () =>
      request(app)
        .post('/api/segment')
        .set('X-Framelock-Session', health.body.sessionToken)
        .send(body);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
    expect(segment).toHaveBeenCalledTimes(1);
  });
  it('does not count invalid input and does not leak upstream error text', async () => {
    const segment = vi.fn(async () => {
      throw { status: 401, message: 'private-upstream-secret' };
    });
    const app = createApp({ settings: () => ({ key: 'test-key', requestLimit: 2 }), segment });
    const health = await request(app).get('/api/health');
    const send = (data: object) =>
      request(app)
        .post('/api/segment')
        .set('X-Framelock-Session', health.body.sessionToken)
        .send(data);
    expect((await send({ ...body, sourceHash: 'bad' })).status).toBe(400);
    expect((await request(app).get('/api/health')).body.requestsUsed).toBe(0);
    const result = await send(body);
    expect(result.status).toBe(401);
    expect(result.text).not.toContain('private-upstream-secret');
  });
});

// The tiny wire example is from Meta's published SAM output documentation, not a live project request.
const wire =
  "<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|><|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>";
const input: CheckedInput = {
  image: '',
  concept: 'button',
  sourceHash: 'test-source',
  width: 320,
  height: 334,
};
async function* events(text: string, complete = true): AsyncGenerator<ResponsesEvent> {
  const lane = { item_id: 'msg-test', output_index: 0, content_index: 0 };
  if (text) {
    yield { type: 'response.output_text.delta', delta: text.slice(0, 47), ...lane };
    yield { type: 'response.output_text.delta', delta: text.slice(47), ...lane };
  }
  // An empty match set has no deltas, but still finalizes the output-text lane.
  yield { type: 'response.output_text.done', text, ...lane };
  if (complete) yield { type: 'response.completed' };
}
describe('actual Meta parser integration using a documented fixture', () => {
  it('decodes a fragmented stream into a cropped binary mask with source coordinates', async () => {
    const result = await decodeSelection(events(wire), input);
    expect(result.objects).toHaveLength(1);
    const mask = result.objects[0];
    expect(mask.bounds).toEqual({ left: 211, top: 228, right: 271, bottom: 255 });
    const raster = Buffer.from(mask.rasterBase64, 'base64');
    expect(raster.length).toBe(60 * 27);
    expect([...raster].every((value) => value === 0 || value === 1)).toBe(true);
    expect(mask.sourceHash).toBe('test-source');
  });
  it('accepts a completed zero-match response', async () => {
    expect((await decodeSelection(events(''), input)).objects).toEqual([]);
  });
  it('rejects truncated or malformed output rather than calling it success', async () => {
    await expect(decodeSelection(events(wire, false), input)).rejects.toThrow('incomplete');
    await expect(decodeSelection(events('<0f>invalid'), input)).rejects.toThrow();
  });
});

describe('SDK request contract with a stubbed HTTP transport; no live API', () => {
  it('sends SAM to the documented endpoint and consumes its streamed mask', async () => {
    const chunks: ResponsesEvent[] = [];
    for await (const event of events(wire)) chunks.push(event);
    const fetchStub = vi.fn(
      async () =>
        new Response(
          chunks.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
    );
    vi.stubGlobal('fetch', fetchStub);
    const result = await requestSam(input, 'test-key', new AbortController().signal);
    expect(result.objects).toHaveLength(1);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe('https://api.meta.ai/v1/responses');
    const payload = JSON.parse(init.body as string);
    expect(payload.model).toBe('sam-3.1');
    expect(payload.stream).toBe(true);
    expect(payload.metadata).toEqual({ mask_encoding: 'one_bit', include_confidence: 'true' });
    expect(payload.input[0].content[0]).toEqual({ type: 'input_text', text: 'button' });
  });
  it('does not retry a provider rate limit automatically', async () => {
    const fetchStub = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'test rate limit' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchStub);
    await expect(requestSam(input, 'test-key', new AbortController().signal)).rejects.toThrow();
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});

describe('Role 2: SAM 3.1 maskRef, neutral object selection, track storage & ambiguity handling', () => {
  it('produces versioned maskRef and consistent / mismatch / uncertain evidence', async () => {
    const decoded = await decodeSelection(events(wire), input, 3);
    expect(decoded.maskRef).toBe('sam-3.1:button:0:v3');
    expect(decoded.objects[0].maskRef).toBe('sam-3.1:button:0:v3');
    expect(decoded.ambiguityStatus).toBe('consistent');

    // Mismatch when observedValue differs from expectedValue
    const mismatchCheck = evaluateSamContinuityCheck(decoded.objects, 'button', {
      expectedValue: 'blue',
      observedValue: 'red',
    });
    expect(mismatchCheck.status).toBe('mismatch');
    expect(mismatchCheck.maskRef).toBe('sam-3.1:button:0:v3');

    // Uncertain when 0 candidate masks exist
    const zeroMatchCheck = evaluateSamContinuityCheck([], 'button');
    expect(zeroMatchCheck.status).toBe('uncertain');
    expect(zeroMatchCheck.isAmbiguous).toBe(true);

    // Uncertain when multiple candidate objects have competing confidence
    const competingObjects = [
      { ...decoded.objects[0], objectId: '0', confidence: 0.91 },
      { ...decoded.objects[0], objectId: '1', confidence: 0.88 },
    ];
    const multiCandidateCheck = evaluateSamContinuityCheck(competingObjects, 'button');
    expect(multiCandidateCheck.status).toBe('uncertain');
    expect(multiCandidateCheck.isAmbiguous).toBe(true);
  });

  it('stores versioned mask tracks via /api/segment/check and resolves ambiguity via /api/masks/disambiguate', async () => {
    const app = createApp({ settings: () => ({ key: '', requestLimit: 10 }) });
    const health = await request(app).get('/api/health');

    // 1. Run a low-confidence check that flags "uncertain" ambiguity
    const checkRes = await request(app)
      .post('/api/segment/check')
      .set('X-Anchorshot-Session', health.body.sessionToken)
      .send({
        ...body,
        shotNumber: 4,
        ruleRevision: 2,
        confidence: 0.72,
        expectedValue: 'emerald',
        observedValue: 'emerald',
      });

    expect(checkRes.status).toBe(200);
    expect(checkRes.body.maskRef).toBe('sam-3.1:cup:0:v2');
    expect(checkRes.body.ambiguityStatus).toBe('uncertain');
    expect(checkRes.body.track.status).toBe('uncertain');

    // 2. Verify track is stored in GET /api/masks
    const listRes = await request(app).get('/api/masks?concept=cup&shotNumber=4');
    expect(listRes.status).toBe(200);
    expect(listRes.body.tracks).toHaveLength(1);
    expect(listRes.body.tracks[0].maskRef).toBe('sam-3.1:cup:0:v2');

    // 3. Disambiguate via POST /api/masks/disambiguate
    const resolveRes = await request(app)
      .post('/api/masks/disambiguate')
      .set('X-Anchorshot-Session', health.body.sessionToken)
      .send({
        sourceHash:body.sourceHash, segmentationId:checkRes.body.requestId, maskSessionId: health.body.maskSessionId, maskRef: 'sam-3.1:cup:0:v2',
        selectedObjectId: '0',
        shotNumber:4,
        status: 'consistent',
      });

    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.track.status).toBe('uncertain');

    // 4. Verify stale track invalidation when ruleRevision increments
    const nextRevRes = await request(app)
      .post('/api/segment/check')
      .set('X-Anchorshot-Session', health.body.sessionToken)
      .send({
        ...body,
        shotNumber: 4,
        ruleRevision: 3,
        confidence: 0.96,
        expectedValue: 'emerald',
        observedValue: 'emerald',
      });
    expect(nextRevRes.status).toBe(200);
    expect(nextRevRes.body.maskRef).toBe('sam-3.1:cup:0:v3');
    expect(nextRevRes.body.provenance).toBe('offline-fixture');

    const tracksAfterRev = await request(app).get('/api/masks?concept=cup&shotNumber=4');
    expect(tracksAfterRev.body.tracks).toHaveLength(1);
    expect(tracksAfterRev.body.tracks[0].maskRef).toBe('sam-3.1:cup:0:v3');
  });

  it('serves /api/muse/transcribe and /api/muse/spark with ruleRevision increments and provenance', async () => {
    const app = createApp({ settings: () => ({ key: '', requestLimit: 10 }) });
    const health = await request(app).get('/api/health');

    const transRes = await request(app)
      .post('/api/muse/transcribe')
      .set('X-Anchorshot-Session', health.body.sessionToken)
      .send({ text: 'The courier jacket must remain emerald.' });
    expect(transRes.status).toBe(200);
    expect(transRes.body.model).toBe('muse-voice-transcribe-1.0');
    expect(transRes.body.provenance).toBe('offline-fixture');

    const sparkRes = await request(app)
      .post('/api/muse/spark')
      .set('X-Anchorshot-Session', health.body.sessionToken)
      .send({ transcript: transRes.body.transcript, previousRevision: 2 });
    expect(sparkRes.status).toBe(200);
    expect(sparkRes.body.model).toBe('muse-spark-1.3');
    expect(sparkRes.body.ruleRevision).toBe(3);
    expect(sparkRes.body.rules[0]).toMatchObject({
      targetObject: 'jacket',
      expectedValue: 'emerald',
      revision: 3,
    });
  });

  it('preserves tracks across multiple shots, scopes invalidation by concept, and enforces rate limits on /api/segment/check', async () => {
    const app = createApp({ settings: () => ({ key: '', requestLimit: 10 }) });
    const health = await request(app).get('/api/health');

    // Shot 1 and Shot 2 with identical concept/revision do not overwrite each other
    await request(app)
      .post('/api/segment/check')
      .set('X-Anchorshot-Session', health.body.sessionToken)
      .send({ ...body, concept: 'cup', shotNumber: 1, ruleRevision: 1 });
    await request(app)
      .post('/api/segment/check')
      .set('X-Anchorshot-Session', health.body.sessionToken)
      .send({ ...body, concept: 'cup', shotNumber: 2, ruleRevision: 1 });
    await request(app)
      .post('/api/segment/check')
      .set('X-Anchorshot-Session', health.body.sessionToken)
      .send({ ...body, concept: 'jacket', shotNumber: 2, ruleRevision: 1 });

    const allCupTracks = await request(app).get('/api/masks?concept=cup');
    expect(allCupTracks.body.tracks).toHaveLength(2);

    // Updating 'cup' on Shot 2 to revision 2 leaves 'jacket' on Shot 2 intact, and handles non-string expectedValue safely
    const rev2Check = await request(app)
      .post('/api/segment/check')
      .set('X-Anchorshot-Session', health.body.sessionToken)
      .send({
        ...body,
        concept: 'cup',
        shotNumber: 2,
        ruleRevision: 2,
        expectedValue: 12345,
        observedValue: null,
      });
    expect(rev2Check.status).toBe(200);

    const shot2JacketTracks = await request(app).get('/api/masks?concept=jacket&shotNumber=2');
    expect(shot2JacketTracks.body.tracks).toHaveLength(1);

    // Rate-limit guard when live key is configured and requestLimit is 0
    const limitedApp = createApp({ settings: () => ({ key: 'live-key', requestLimit: 0 }) });
    const limitedHealth = await request(limitedApp).get('/api/health');
    const rateLimitedRes = await request(limitedApp)
      .post('/api/segment/check')
      .set('X-Anchorshot-Session', limitedHealth.body.sessionToken)
      .send(body);
    expect(rateLimitedRes.status).toBe(429);

    // A wrong shot or an object that was never returned cannot be selected.
    const wrongShot = await request(app)
      .post('/api/masks/disambiguate')
      .set('X-Anchorshot-Session', health.body.sessionToken)
      .send({ sourceHash:body.sourceHash, segmentationId:rev2Check.body.requestId, maskSessionId: health.body.maskSessionId, maskRef: 'sam-3.1:cup:0:v2', selectedObjectId: '1', shotNumber: 9 });
    expect(wrongShot.status).toBe(404);

    const rightShot = await request(app)
      .post('/api/masks/disambiguate')
      .set('X-Anchorshot-Session', health.body.sessionToken)
      .send({ sourceHash:body.sourceHash, segmentationId:rev2Check.body.requestId, maskSessionId: health.body.maskSessionId, maskRef: 'sam-3.1:cup:0:v2', selectedObjectId: '1', shotNumber: 2 });
    expect(rightShot.status).toBe(404);
  });
});


it('rejects an old mask session even when a restarted server recreates the same mask reference',async()=>{
 const first=createApp({settings:()=>({key:'',requestLimit:10})});
 const second=createApp({settings:()=>({key:'',requestLimit:10})});
 const h1=(await request(first).get('/api/health')).body,h2=(await request(second).get('/api/health')).body;
 expect(h1.maskSessionId).not.toBe(h2.maskSessionId);
 const segment=async(app:ReturnType<typeof createApp>,health:any)=>(await request(app).post('/api/segment/check').set('X-Anchorshot-Session',health.sessionToken).send({...body,shotNumber:1,ruleRevision:1})).body;
 const old=await segment(first,h1),current=await segment(second,h2);
 expect(old.maskRef).toBe(current.maskRef);
 const before=(await request(second).get('/api/masks')).body;
 const response=await request(second).post('/api/masks/disambiguate').set('X-Anchorshot-Session',h2.sessionToken).send({maskSessionId:old.maskSessionId,maskRef:old.maskRef,selectedObjectId:'0',shotNumber:1});
 expect(response.status).toBe(409);expect(response.body.code).toBe('MASK_SESSION_EXPIRED');
 expect((await request(second).get('/api/masks')).body).toEqual(before);
});


it('rejects stale image identity when the same shot and mask reference are reused within one server session',async()=>{
 const app=createApp({settings:()=>({key:'',requestLimit:10})});
 const health=(await request(app).get('/api/health')).body;
 const post=(route:string,value:unknown)=>request(app).post(route).set('X-Anchorshot-Session',health.sessionToken).send(value);
 const first=await post('/api/segment/check',{...body,shotNumber:1,ruleRevision:1});
 const bytes=await sharp({create:{width:2,height:2,channels:4,background:'#3355ff'}}).png().toBuffer();
 const replacement={...body,image:`data:image/png;base64,${bytes.toString('base64')}`,sourceHash:createHash('sha256').update(bytes).digest('hex'),shotNumber:1,ruleRevision:1};
 const second=await post('/api/segment/check',replacement);
 expect(second.body.maskRef).toBe(first.body.maskRef);
 const before=(await request(app).get('/api/masks')).body;
 const selection={maskSessionId:health.maskSessionId,maskRef:first.body.maskRef,selectedObjectId:'0',shotNumber:1,sourceHash:body.sourceHash};
 const stale=await post('/api/masks/disambiguate',selection);
 expect(stale.status).toBe(409);expect(stale.body.code).toBe('MASK_SOURCE_CHANGED');
 expect((await request(app).get('/api/masks')).body).toEqual(before);
 expect((await post('/api/masks/disambiguate',{...selection,sourceHash:replacement.sourceHash,shotNumber:undefined})).status).toBe(400);
 expect((await post('/api/masks/disambiguate',{...selection,sourceHash:replacement.sourceHash,segmentationId:second.body.requestId})).status).toBe(200);
});


it('rejects confirmation from an older segmentation of the identical image and revision',async()=>{
 const app=createApp({settings:()=>({key:'',requestLimit:10})});
 const health=(await request(app).get('/api/health')).body;
 const post=(route:string,value:unknown)=>request(app).post(route).set('X-Anchorshot-Session',health.sessionToken).send(value);
 const input={...body,shotNumber:1,ruleRevision:1};
 const first=(await post('/api/segment/check',input)).body;
 const second=(await post('/api/segment/check',input)).body;
 expect(first.maskRef).toBe(second.maskRef);expect(first.requestId).not.toBe(second.requestId);
 const selection={maskSessionId:health.maskSessionId,sourceHash:body.sourceHash,maskRef:first.maskRef,shotNumber:1,selectedObjectId:'0',segmentationId:first.requestId};
 const before=(await request(app).get('/api/masks')).body;
 const stale=await post('/api/masks/disambiguate',selection);
 expect(stale.status).toBe(409);expect(stale.body.code).toBe('MASK_RESULT_CHANGED');
 expect((await request(app).get('/api/masks')).body).toEqual(before);
 expect((await post('/api/masks/disambiguate',{...selection,segmentationId:undefined})).status).toBe(409);
 const current=await post('/api/masks/disambiguate',{...selection,segmentationId:second.requestId});
 expect(current.status).toBe(200);expect(current.body.track.segmentationId).toBe(second.requestId);
});
