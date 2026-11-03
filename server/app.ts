import type {VideoProvider} from './video';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { verifyMaskedPixelDiff } from '../src/services/maskIntegrity';
import express, { type ErrorRequestHandler } from 'express';
import sharp from 'sharp';
import {
  checkInput,
  decodeOfflineSamSelection,
  evaluateSamContinuityCheck,
  MaskTrackStore,
  requestSam,
  UserError,
  type CheckedInput,
} from './sam';
import { ImagerOutputError, type Imager } from './imager';
import { readAudioDataUrl, TranscriberOutputError, type Transcriber } from './transcriber';
import type { AgentMessage, VoiceAgent } from './agent';
import { validateAgentMessages } from './agent';
import { AnimaticError, ffmpegAvailable, renderAnimatic, type AnimaticShot, type RenderAnimaticOptions } from './animatic';
import { fixturePlanner, PlannerOutputError, type Planner } from './planner';
import type { ContinuityEvidenceStatus, SegmentationResult } from '../src/types';

// Only app-owned images and embedded image bytes are accepted. Never read arbitrary
// disk paths or fetch a user-supplied URL on the server's behalf.
async function resolveImageBuffer(input: string, frameFolder: string, jobFolder: string): Promise<Buffer> {
  const embedded = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input);
  if (embedded) return Buffer.from(embedded[1], 'base64');
  const frame = /^\/api\/muse\/frames\/([a-f0-9]{64}\.png)$/.exec(input);
  const job = /^\/api\/local-ai\/jobs\/([a-f0-9-]{36})\/assets\/(generated-image\.png|frame-\d{3}\.png)(?:\?rev=\d+)?$/.exec(input);
  const file = frame ? join(frameFolder, frame[1]) : job ? join(jobFolder, job[1], job[2]) : '';
  if (!file || !existsSync(file)) throw new UserError('Select an available project image or upload PNG, JPEG or WebP bytes.', 400);
  return readFileSync(file);
}

interface Settings {
  key: string;
  requestLimit: number;
}
interface Options {
  settings: () => Settings;
  segment?: (
    input: CheckedInput,
    key: string,
    signal: AbortSignal,
    revision?: number,
  ) => Promise<SegmentationResult>;
  planner?: Planner;
  video?: VideoProvider;
  imager?: Imager;
  frameFolder?: string;
  jobFolder?: string;
  transcriber?: Transcriber;
  agent?: VoiceAgent;
  renderAnimatic?: (
    shots: AnimaticShot[],
    ffmpeg?: string,
    ffprobe?: string,
    options?: RenderAnimaticOptions,
  ) => Promise<Buffer>;
  ffmpegAvailable?: () => Promise<boolean>;
}

export function createApp(options: Options) {
  const app = express();
  const sessionToken = randomBytes(24).toString('hex');
  const trackStore = new MaskTrackStore();
  const maskSessionId = randomBytes(16).toString('hex');
  const planner = options.planner ?? fixturePlanner;
  let requestsUsed = 0;
  let active = false;
  let imageActive = false;
  let videoActive = false;
  let transcribeActive = false;
  let exportActive = false;
  const frameFolder = options.frameFolder ?? resolve('.artifacts/frames');
  const jobFolder = options.jobFolder ?? resolve('.artifacts/local-ai/ui-jobs');

  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['127.0.0.1', 'localhost'].includes(req.hostname))
      return res.status(403).json({ error: 'This prototype accepts local requests only.' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`)
      return res.status(403).json({ error: 'Open this app on its local address.' });
    next();
  });

  app.get('/api/health', (_req, res) => {
    const settings = options.settings();
    res.json({
      configured: Boolean(settings.key),
      model: 'sam-3.1',
      models: ['sam-3.1', 'muse-spark-1.3', 'muse-voice-transcribe-1.0', 'muse-image-1.0'],
      sessionToken,
      maskSessionId,
      requestsUsed,
      requestLimit: settings.requestLimit,
      tracksStored: trackStore.listTracks().length,
      plannerLive: planner !== fixturePlanner,
      videoReady: Boolean(options.video),
      filmShots: options.video?.shots,
      videoModel: options.video?.model ?? null,
      imageModel: options.imager?.model ?? null,
      transcribeModel: options.transcriber?.model ?? null,
      agentReady: Boolean(options.agent),
    });
  });

  // A film carries every full-size frame; other routes keep the smaller limit.
  app.use('/api/export/animatic', express.json({ limit: '128mb' }));
  app.use('/api', express.json({ limit: '12mb' }));

  const reserveRequest = () => {
    if (requestsUsed >= options.settings().requestLimit)
      throw new UserError('The session request limit has been reached. No further call was sent.', 429);
    requestsUsed++;
  };

  const hasValidSession = (req: express.Request) => {
    const token =
      req.headers['x-framelock-session'] ?? req.headers['x-anchorshot-session'];
    return token === sessionToken;
  };

  app.post('/api/segment', async (req, res, next) => {
    if (!hasValidSession(req))
      return res.status(403).json({ error: 'Refresh the page before selecting an object.' });
    const settings = options.settings();
    if (!settings.key)
      return res.status(503).json({
        error: 'SAM is not connected. Add META_API_KEY to .env.local, or use the offline sample.',
      });
    if (active)
      return res
        .status(409)
        .json({ error: 'A selection is already running. Wait for it to finish.' });
    if (requestsUsed >= settings.requestLimit)
      return res
        .status(429)
        .json({ error: 'The session request limit has been reached. No further call was sent.' });
    active = true;
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const input = await checkInput(req.body);
      if (controller.signal.aborted) return;
      const rawRuleRevision = req.body?.ruleRevision;
      const revision =
        typeof rawRuleRevision === 'number' &&
        Number.isFinite(rawRuleRevision) &&
        rawRuleRevision >= 1
          ? Math.floor(rawRuleRevision)
          : 1;
      reserveRequest();
      const result = await (options.segment ?? requestSam)(
        input,
        settings.key,
        controller.signal,
        revision,
      );
      if (!controller.signal.aborted) res.json(result);
    } catch (error) {
      if (!controller.signal.aborted) next(error);
    } finally {
      active = false;
    }
  });

  /**
   * Role 2 Deliverable Endpoint: `POST /api/segment/check`
   * Produces versioned masks (`maskRef`), neutral object selection, mask/track storage,
   * and `consistent` / `mismatch` / `uncertain` continuity evidence.
   * Uses live `sam-3.1` when `META_API_KEY` is configured or `@meta-sam/parser` wire-stream
   * fallback in local mode.
   */
  app.post('/api/segment/check', async (req, res, next) => {
    if (!hasValidSession(req))
      return res.status(403).json({ error: 'Refresh the page before running a continuity check.' });
    const settings = options.settings();
    if (active)
      return res
        .status(409)
        .json({ error: 'A selection is already running. Wait for it to finish.' });
    if (settings.key && requestsUsed >= settings.requestLimit)
      return res
        .status(429)
        .json({ error: 'The session request limit has been reached. No further call was sent.' });
    active = true;
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const input = await checkInput(req.body);
      if (controller.signal.aborted) return;

      const rawShotNumber = Number(req.body?.shotNumber);
      const shotNumber =
        Number.isFinite(rawShotNumber) && rawShotNumber >= 1 ? Math.floor(rawShotNumber) : 1;
      const rawRuleRevision = req.body?.ruleRevision;
      const revision =
        typeof rawRuleRevision === 'number' &&
        Number.isFinite(rawRuleRevision) &&
        rawRuleRevision >= 1
          ? Math.floor(rawRuleRevision)
          : trackStore.nextRevision(shotNumber, input.concept);
      trackStore.syncRevision(shotNumber, input.concept, revision);

      const simulatedConfidence =
        typeof req.body?.confidence === 'number' && Number.isFinite(req.body.confidence)
          ? Math.max(0, Math.min(1, req.body.confidence))
          : 0.984;

      let segmentation: SegmentationResult;
      if (settings.key) {
        reserveRequest();
        segmentation = await (options.segment ?? requestSam)(
          input,
          settings.key,
          controller.signal,
          revision,
        );
      } else {
        segmentation = await decodeOfflineSamSelection(input, revision, simulatedConfidence);
      }

      const sanitizeString = (v: unknown) =>
        typeof v === 'string' && v.trim() ? v.trim() : undefined;
      const sanitizeFiniteNumber = (v: unknown) =>
        typeof v === 'number' && Number.isFinite(v) ? v : undefined;

      const check = evaluateSamContinuityCheck(segmentation.objects, input.concept, {
        expectedValue: sanitizeString(req.body?.expectedValue),
        observedValue: sanitizeString(req.body?.observedValue),
        minConfidence: sanitizeFiniteNumber(req.body?.minConfidence),
        ambiguityMargin: sanitizeFiniteNumber(req.body?.ambiguityMargin),
        revision,
      });

      const primaryObj =
        segmentation.objects.find((o) => o.objectId === check.selectedObjectId) ??
        segmentation.objects[0];

      // Invalidate stale selections/proposals for this shot/concept if sourceHash or ruleRevision changed
      trackStore.invalidateBySourceOrRule(shotNumber, input.sourceHash, revision, input.concept);

      // Retain each returned candidate with its own pixels/bounds identity.
      const storedCandidates = segmentation.objects.map(object => trackStore.recordTrack({
        segmentationId:segmentation.requestId, maskRef: object.maskRef!, concept:input.concept, shotNumber, revision, objectId:object.objectId,
        bounds:object.bounds, confidence:object.confidence ?? 0, sourceHash:input.sourceHash,
        status:check.status, evidence:check.explanation, provenance:segmentation.provenance ?? 'offline-fixture', createdAt:Date.now(),
      }));
      const storedTrack = storedCandidates.find(track => track.objectId === primaryObj?.objectId) ?? null;

      if (!controller.signal.aborted) {
        res.json({
          ...segmentation,
          maskSessionId,
          maskRef: check.maskRef ?? undefined,
          selectedObjectId: check.selectedObjectId,
          ambiguityStatus: check.status,
          evidence: check.explanation,
          check,
          track: storedTrack,
        });
      }
    } catch (error) {
      if (!controller.signal.aborted) next(error);
    } finally {
      active = false;
    }
  });

  /**
   * Role 2 Deliverable Endpoint: `GET /api/masks`
   * Lists stored versioned masks (`maskRef`) and cross-shot tracks.
   */
  app.get('/api/masks', (req, res) => {
    const concept = typeof req.query.concept === 'string' ? req.query.concept : undefined;
    const rawShot =
      typeof req.query.shotNumber === 'string' ? Number(req.query.shotNumber) : undefined;
    const shotNumber =
      rawShot !== undefined && Number.isFinite(rawShot) && rawShot >= 1
        ? Math.floor(rawShot)
        : undefined;
    res.json({
      tracks: trackStore.listTracks(concept, shotNumber),
    });
  });

  /**
   * Role 2 Deliverable Endpoint: `POST /api/masks/disambiguate`
   * Resolves an `uncertain` SAM 3.1 detection by locking a chosen candidate `objectId`
   * for a versioned `maskRef`.
   */
  app.post('/api/masks/disambiguate', (req, res) => {
    if (!hasValidSession(req))
      return res.status(403).json({ error: 'Refresh the page before disambiguating a mask.' });
    if(req.body?.maskSessionId!==maskSessionId)return res.status(409).json({error:'This mask belongs to an earlier server session. Its saved raster can still be selected locally.',code:'MASK_SESSION_EXPIRED'});
    const { maskRef, selectedObjectId, status, shotNumber, bounds, confidence } = req.body as {
      maskRef?: string;
      selectedObjectId?: string;
      status?: ContinuityEvidenceStatus;
      shotNumber?: number;
      bounds?: { left: number; top: number; right: number; bottom: number };
      confidence?: number;
    };
    if (
      typeof maskRef !== 'string' ||
      !maskRef.trim() ||
      (typeof selectedObjectId !== 'string' && typeof selectedObjectId !== 'number') ||
      !String(selectedObjectId).trim()
    ) {
      return res.status(400).json({ error: 'Provide both maskRef and selectedObjectId.' });
    }
    const resolvedStatus: ContinuityEvidenceStatus =
      status === 'mismatch' || status === 'uncertain' ? status : 'consistent';
    const validShotNumber =
      typeof shotNumber === 'number' && Number.isFinite(shotNumber) && shotNumber >= 1
        ? Math.floor(shotNumber)
        : undefined;
    const validBounds =
      bounds &&
      typeof bounds === 'object' &&
      typeof bounds.left === 'number' &&
      Number.isFinite(bounds.left) &&
      typeof bounds.top === 'number' &&
      Number.isFinite(bounds.top) &&
      typeof bounds.right === 'number' &&
      Number.isFinite(bounds.right) &&
      typeof bounds.bottom === 'number' &&
      Number.isFinite(bounds.bottom) &&
      bounds.left >= 0 &&
      bounds.top >= 0 &&
      bounds.right > bounds.left &&
      bounds.bottom > bounds.top
        ? {
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
          }
        : undefined;
    const sourceHash=req.body?.sourceHash;
    if(typeof sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(sourceHash)||!Number.isSafeInteger(shotNumber)||!validShotNumber)
      return res.status(400).json({error:'Provide the source image hash and exact shot number for this selection.'});
    const sourceTrack=trackStore.getTrack(maskRef.trim(),validShotNumber);
    if(!sourceTrack)return res.status(404).json({error:'This stored track is no longer available.',code:'MASK_TRACK_EXPIRED'});
    if(sourceTrack.sourceHash!==sourceHash)return res.status(409).json({error:'This track now belongs to another source image.',code:'MASK_SOURCE_CHANGED'});
    if(!sourceTrack.segmentationId||req.body?.segmentationId!==sourceTrack.segmentationId)return res.status(409).json({error:'This selection belongs to an earlier segmentation result. Its saved raster remains available locally.',code:'MASK_RESULT_CHANGED'});
    const updated = trackStore.disambiguate(
      maskRef.trim(),
      String(selectedObjectId).trim(),
      resolvedStatus,
      {
        shotNumber: validShotNumber,
        bounds: validBounds,
        confidence,
      },
    );
    if (!updated) {
      return res.status(404).json({ error: `Mask reference ${maskRef} was not found.` });
    }
    res.json({ track: updated });
  });

  /**
   * Meta Muse Voice Transcribe Endpoint: `POST /api/muse/transcribe`
   * Server-side gateway for `muse-voice-transcribe-1.0` with explicit offline fixture provenance.
   */
  app.post('/api/muse/transcribe', async (req, res, next) => {
    if (!hasValidSession(req))
      return res.status(403).json({ error: 'Refresh the page before transcribing.' });
    if (req.body?.audio !== undefined) {
      if (!options.transcriber)
        return res.status(501).json({
          error: 'No transcription model is connected. Set TRANSCRIBE_PROVIDER in .env.local.',
        });
      const clip = readAudioDataUrl(req.body.audio);
      if (typeof clip === 'string') return res.status(400).json({ error: clip });
      if (transcribeActive)
        return res.status(409).json({ error: 'A recording is already being transcribed.' });
      if (requestsUsed >= options.settings().requestLimit)
        return res
          .status(429)
          .json({ error: 'The session request limit has been reached. No further call was sent.' });
      transcribeActive = true;
      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) controller.abort();
      });
      try {
        reserveRequest();
        const result = await options.transcriber.transcribe(clip, controller.signal);
        if (!controller.signal.aborted) res.json(result);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof TranscriberOutputError)
          return res.status(502).json({ error: error.message });
        next(error);
      } finally {
        transcribeActive = false;
      }
      return;
    }
    const text =
      typeof req.body?.text === 'string' && req.body.text.trim()
        ? req.body.text.trim()
        : 'Continuity Rule across all shots: the ceramic coffee cup must be blue.';
    const words = text.split(/\s+/).filter(Boolean);
    const timestamps = words.map((word, i) => ({
      word,
      start: +(i * 0.32).toFixed(2),
      end: +((i + 1) * 0.32 - 0.04).toFixed(2),
      confidence: 0.99,
    }));
    res.json({
      transcript: text,
      confidence: 0.992,
      model: 'muse-voice-transcribe-1.0',
      provenance: 'offline-fixture',
      timestamps,
    });
  });

  /**
   * Meta Muse Spark Continuity Rule & Shot Planner Endpoint: `POST /api/muse/spark`
   * Extracts versioned `ContinuityRule` records (`ruleRevision`) from transcript text.
   */
  app.post('/api/muse/spark', async (req, res, next) => {
    if (!hasValidSession(req))
      return res.status(403).json({ error: 'Refresh the page before running shot planning.' });
    const transcript = typeof req.body?.transcript === 'string' ? req.body.transcript : '';
    if (!transcript.trim()) {
      return res.status(400).json({ error: 'Provide a non-empty director transcript.' });
    }
    const previousRevision =
      typeof req.body?.previousRevision === 'number' &&
      Number.isFinite(req.body.previousRevision) &&
      req.body.previousRevision >= 0
        ? Math.floor(req.body.previousRevision)
        : 0;
    try {
      if (transcript.length > 12000) return res.status(400).json({ error: 'Keep the script under 12000 characters.' });
      const controller = new AbortController();
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      if (planner !== fixturePlanner) reserveRequest();
      res.json(await planner.plan(transcript, previousRevision + 1, controller.signal, reserveRequest));
    } catch (error) {
      if (error instanceof PlannerOutputError) return res.status(502).json({ error: error.message });
      next(error);
    }
  });

  /**
   * Storyboard frame endpoint: `POST /api/muse/image`
   * Uses the configured imager; each frame is checked as SAM input before it is returned.
   * Shares the session request limit with SAM, so paid calls stay bounded.
   */
  app.post('/api/muse/image', async (req, res, next) => {
    if (!hasValidSession(req))
      return res.status(403).json({ error: 'Refresh the page before generating a frame.' });
    if (!options.imager)
      return res.status(501).json({
        error: 'No image model is connected. Set IMAGE_PROVIDER in .env.local, or keep the offline frames.',
      });
    const { prompt, targetObject, seed, references } = req.body ?? {};
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000)
      return res.status(400).json({ error: 'Describe the shot in up to 2000 characters.' });
    if (typeof targetObject !== 'string' || !targetObject.trim() || targetObject.length > 100)
      return res.status(400).json({ error: 'Name the object to keep continuous, such as cup.' });
    if (imageActive)
      return res.status(409).json({ error: 'A frame is already generating. Wait for it to finish.' });
    if (requestsUsed >= options.settings().requestLimit)
      return res
        .status(429)
        .json({ error: 'The session request limit has been reached. No further call was sent.' });
    imageActive = true;
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      reserveRequest();
      const frame = await options.imager.generate(
        {
          prompt: prompt.trim(),
          targetObject: targetObject.trim(),
          seed: Number.isInteger(seed) ? seed : 0,
          // Only frames this server saved can be references.
          references: (Array.isArray(references) ? references : [])
            .slice(0, 3)
            .map((url) => /^\/api\/muse\/frames\/([a-f0-9]{64}\.png)$/.exec(String(url))?.[1])
            .filter((file): file is string => Boolean(file) && existsSync(join(frameFolder, file!)))
            .map((file) => `data:image/png;base64,${readFileSync(join(frameFolder, file)).toString('base64')}`),
        },
        controller.signal,
        reserveRequest,
      );
      if (controller.signal.aborted) return;
      const { image, ...details } = frame;
      // Saved by content hash so projects keep their frames across server restarts.
      mkdirSync(frameFolder, { recursive: true });
      writeFileSync(join(frameFolder, `${frame.sourceHash}.png`), Buffer.from(image.slice(image.indexOf(',') + 1), 'base64'));
      res.json({ ...details, url: `/api/muse/frames/${frame.sourceHash}.png` });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ImagerOutputError) return res.status(502).json({ error: error.message });
      next(error);
    } finally {
      imageActive = false;
    }
  });

  app.post('/api/muse/video', async (req,res,next) => {
    if(!hasValidSession(req))return res.status(403).json({error:'Refresh the page before generating video.'});
    if(!options.video)return res.status(503).json({error:'No video model is connected. Your prompt is saved; no demo scenes were created.'});
    const prompt=req.body?.prompt;
    if(typeof prompt!=='string'||!prompt.trim()||prompt.length>4000)return res.status(400).json({error:'Provide a scene prompt of 1–4000 characters.'});
    if(videoActive)return res.status(409).json({error:'A video is already rendering. Wait for it to finish.'});
    const controller=new AbortController();res.once('close',()=>{if(!res.writableEnded)controller.abort();});
    const frame=req.body?.image;
    if(frame!==undefined&&(typeof frame!=='string'||!/^\/api\/muse\/frames\/[a-f0-9]{64}\.png$/.test(frame)||!existsSync(join(frameFolder,frame.split('/').pop()!))))
      return res.status(400).json({error:'The start frame is no longer available.'});
    videoActive=true;
    try {reserveRequest();const clip=await options.video.generate(prompt.trim(),controller.signal,frame?{image:readFileSync(join(frameFolder,frame.split('/').pop()!)),seed:Number.isInteger(req.body?.seed)?req.body.seed:7}:undefined);if(!res.destroyed)res.json(clip);}
    catch(error){if(!res.destroyed){if(error instanceof UserError)next(error);else res.status(502).json({error:`The video could not be rendered. ${(error as Error).message}`});}}
    finally {videoActive=false;}
  });

  app.get('/api/muse/frames/:file', (req, res) => {
    const file = /^[a-f0-9]{64}\.png$/.test(req.params.file) ? join(frameFolder, req.params.file) : '';
    if (!file || !existsSync(file)) return res.status(404).json({ error: 'This generated frame is no longer available.' });
    res.type('png').send(readFileSync(file));
  });

  /**
   * Voice agent endpoint: `POST /api/agent/turn` runs one model turn. The browser
   * runs any requested studio tools and sends the results in the next turn.
   */
  app.post('/api/agent/turn', async (req, res, next) => {
    if (!hasValidSession(req))
      return res.status(403).json({ error: 'Refresh the page before talking to the agent.' });
    if (!options.agent)
      return res.status(501).json({ error: 'No voice agent is connected. Set AGENT_PROVIDER in .env.local.' });
    let messages: AgentMessage[];
    try { messages = validateAgentMessages(req.body?.messages); }
    catch (error) { return res.status(400).json({ error: (error as Error).message }); }
    if (requestsUsed >= options.settings().requestLimit)
      return res
        .status(429)
        .json({ error: 'The session request limit has been reached. No further call was sent.' });
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', abort);
    try {
      reserveRequest();
      const message = await options.agent.turn(messages, controller.signal);
      if (!controller.signal.aborted) res.json({ message });
    } catch (error) {
      if (!controller.signal.aborted) next(error);
    } finally { res.off('close', abort); }
  });

  /**
   * Animatic export: `POST /api/export/animatic` with shots of
   * `{image: data URL, seconds, movement?}` returns a silent H.264/AAC MP4.
   */
  app.post('/api/export/animatic', async (req, res, next) => {
    if (!hasValidSession(req))
      return res.status(403).json({ error: 'Refresh the page before exporting.' });
    const shots = Array.isArray(req.body?.shots) ? req.body.shots : [];
    if (!shots.length || shots.length > 12)
      return res.status(400).json({ error: 'Export between 1 and 12 shots.' });
    const parsed: AnimaticShot[] = [];
    for (const shot of shots) {
      const image =
        typeof shot?.image === 'string'
          ? /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(shot.image)?.[1]
          : undefined;
      const seconds = Number(shot?.seconds);
      if (!image || !(seconds >= 0.5 && seconds <= 15))
        return res.status(400).json({ error: 'Each shot needs a PNG, JPEG or WebP frame and 0.5 to 15 seconds.' });
      let video: Buffer | undefined;
      const startSeconds = Number(shot.startSeconds ?? 0);
      if (!Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds > 3600)
        return res.status(400).json({ error: 'The video start time is invalid.' });
      if (shot.video !== undefined) {
        const match = typeof shot.video === 'string' && /^\/api\/local-ai\/jobs\/([a-f0-9-]{36})\/assets\/generated-video\.mp4(?:\?rev=\d+)?$/.exec(shot.video);
        if (!match) return res.status(400).json({ error: 'Export supports saved local video clips only.' });
        const file = join(jobFolder, match[1], 'generated-video.mp4');
        if (!existsSync(file)) return res.status(404).json({ error: 'A video clip is missing. Restore it before exporting.' });
        if (statSync(file).size > 64 * 1024 * 1024) return res.status(413).json({ error: 'This video clip exceeds the 64 MB export limit.' });
        video = readFileSync(file);
      }
      let narration: Buffer | undefined;
      if (shot.narration !== undefined) {
        const match=typeof shot.narration==='string' && /^data:audio\/(?:mpeg|wav|x-wav|webm|ogg|mp4);base64,([A-Za-z0-9+/]+={0,2})$/.exec(shot.narration);
        if(!match || match[1].length>6990508) return res.status(400).json({error:'Narration must be a local audio file of at most 5 MB.'});
        narration=Buffer.from(match[1],'base64');
        if(!narration.length||narration.length>5*1024*1024)return res.status(400).json({error:'Narration audio is empty or too large.'});
      }
      parsed.push({ image: Buffer.from(image, 'base64'), seconds, video, startSeconds, narration,
        movement: typeof shot.movement === 'string' ? shot.movement : undefined });
    }
    if (!(await (options.ffmpegAvailable ?? ffmpegAvailable)()))
      return res.status(501).json({ error: 'MP4 export needs ffmpeg on this computer.' });
    if(res.destroyed)return; // The client may leave while the availability probe runs.
    if (exportActive) return res.status(409).json({ error: 'An export is already running.' });
    exportActive = true;
    const exportController=new AbortController();
    const cancelExport=()=>{if(!res.writableEnded)exportController.abort();};
    res.once('close',cancelExport);
    try {
      const burnInTimecode = Boolean(req.body?.burnInTimecode);
      const video = await (options.renderAnimatic ?? renderAnimatic)(parsed, undefined, undefined, { burnInTimecode,signal:exportController.signal });
      if(!exportController.signal.aborted)res.type('video/mp4').send(video);
    } catch (error) {
      if(exportController.signal.aborted)return;
      if (error instanceof AnimaticError) return res.status(500).json({ error: 'The MP4 could not be encoded.' });
      next(error);
    } finally {
      res.removeListener('close',cancelExport);
      exportActive = false;
    }
  });

  // Obsolete prototype routes must not bypass the configured providers or budget.
  app.post('/api/meta/generate-frame', (_req, res) => res.status(410).json({
    error: 'Use /api/muse/image with the configured image provider and session token.',
  }));
  app.post('/api/meta/direct-video', (_req, res) => res.status(501).json({
    error: 'A video-directing provider is not connected. Local video generation is available separately.',
  }));

  // This local inspection is not a video-language model or a temporal tracker.
  // Only persisted candidates are returned; neither scenes nor speech are invented.
  app.post('/api/meta/video-understand', async (req, res, next) => {
    if (!hasValidSession(req)) return res.status(403).json({ error: 'Refresh the page before reviewing video.' });
    const { jobId, shotIndex = 0 } = req.body ?? {};
    if (typeof jobId !== 'string' || !/^[a-f0-9-]{36}$/.test(jobId) || !Number.isInteger(shotIndex) || shotIndex < 0 || shotIndex > 11)
      return res.status(400).json({ error: 'Choose a saved local video and its shot.' });
    try {
      const folder = join(jobFolder, jobId);
      const jobFile = join(folder, 'job.json');
      if (!existsSync(jobFile)) return res.status(404).json({ error: 'This video job is unavailable.' });
      const job = JSON.parse(readFileSync(jobFile, 'utf8'));
      if (job.kind !== 'video' || job.status !== 'completed') return res.status(409).json({ error: 'Wait for this video to finish.' });
      const objectFile = join(folder, 'objects.json');
      const savedObjects = existsSync(objectFile) ? JSON.parse(readFileSync(objectFile, 'utf8')) : [];
      // Older saliency files claimed SAM provenance and fabricated confidence. Do not trust it.
      const detectedObjects = (Array.isArray(savedObjects) ? savedObjects : []).map(object => ({
        ...object, source: 'local-saliency', provenance: 'unverified-proposal', confidence: 0,
        maskRef: `proposal:${jobId}:${object.objectId}`, requiresReview: true,
      }));
      const rules = (Array.isArray(req.body?.rules) ? req.body.rules : []).slice(0, 32);
      const findings = rules.filter(rule => typeof rule?.targetObject === 'string' && typeof rule?.expectedValue === 'string').map(rule => ({
        shotIndex, status: 'uncertain', ruleId: rule.id, targetObject: rule.targetObject,
        expectedValue: rule.expectedValue, confidence: 0,
        explanation: `Video continuity for ${rule.targetObject} is unverified. Region proposals are not tracked object masks.`,
        proposedAction: 'recolor',
      }));
      res.json({ model: null, provenance: 'local-unverified', summary: 'Local video loaded. Object identity, movement and continuity need review.',
        audioTranscription: null, findings, detectedObjects, scenes: [] });
    } catch (error) { next(error); }
  });

  // Generate a replacement region, then measure the actual pixel diff. A colour
  // tint is not a generative edit, and a bounding box is not an object mask.
  app.post('/api/meta/edit-frame', async (req, res, next) => {
    if (!hasValidSession(req)) return res.status(403).json({ error: 'Refresh the page before editing.' });
    const { imageBase64, maskBase64, prompt } = req.body ?? {};
    if (typeof imageBase64 !== 'string' || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000)
      return res.status(400).json({ error: 'Choose a project image and an edit of 1 to 2000 characters.' });
    if (typeof maskBase64 !== 'string' || !maskBase64.startsWith('data:image/png;base64,'))
      return res.status(400).json({ error: 'Select and confirm an object mask before editing. No full-frame fallback is applied.' });
    if (!options.imager) return res.status(501).json({ error: 'No image model is connected. Offline mask recolouring is available separately.' });
    if (imageActive) return res.status(409).json({ error: 'A frame is already generating.' });
    imageActive = true;
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const rawImage = await resolveImageBuffer(imageBase64, frameFolder, jobFolder);
      const base = await sharp(rawImage, { limitInputPixels: 1600 * 1600 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const mask = await sharp(Buffer.from(maskBase64.split(',')[1], 'base64'), { limitInputPixels: 1600 * 1600 })
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (mask.info.width !== base.info.width || mask.info.height !== base.info.height)
        throw new UserError('The mask dimensions do not match this frame. Select the object again.', 400);
      const binary = new Uint8Array(base.info.width * base.info.height);
      const transparent = binary.some((_, i) => mask.data[i * 4 + 3] < 255);
      for (let i = 0; i < binary.length; i++) binary[i] = transparent ? (mask.data[i * 4 + 3] > 0 ? 1 : 0) : (mask.data[i * 4] > 128 ? 1 : 0);
      if (!binary.some(Boolean)) throw new UserError('The selected mask is empty.', 400);
      const image = await sharp(rawImage).png().toBuffer();
      reserveRequest();
      const generated = await options.imager.generate({
        prompt: prompt.trim(), targetObject: 'selected object', seed: 0, requireReference: true,
        references: [`data:image/png;base64,${image.toString('base64')}`],
      }, controller.signal, reserveRequest);
      if (controller.signal.aborted) return;
      const edit = await sharp(Buffer.from(generated.image.split(',')[1], 'base64'))
        .resize(base.info.width, base.info.height).ensureAlpha().raw().toBuffer();
      const output = Buffer.from(base.data);
      for (let i = 0; i < binary.length; i++) if (binary[i]) edit.copy(output, i * 4, i * 4, i * 4 + 4);
      const report = verifyMaskedPixelDiff(new Uint8ClampedArray(base.data), new Uint8ClampedArray(output), binary);
      if (!report.changedInside) throw new UserError('The generated edit did not change the selected pixels. No correction was applied.', 422);
      const png = await sharp(output, { raw: { width: base.info.width, height: base.info.height, channels: 4 } }).png().toBuffer();
      res.json({
        editedImageUrl: `data:image/png;base64,${png.toString('base64')}`,
        ...report, totalPixels: binary.length, outsideDrift: report.changedOutside, outsideDriftPercent: '0.00',
        verified: report.passed, model: generated.model, provenance: generated.provenance, promptApplied: prompt,
        // Pixel preservation does not establish semantic continuity or prompt adherence.
        continuityStatus: 'uncertain',
      });
    } catch (error) { next(error); }
    finally { imageActive = false; }
  });

  app.post('/api/video/ingest-shots', async (req, res, next) => {
    if (!hasValidSession(req)) return res.status(403).json({ error: 'Refresh the page before importing video.' });
    const jobId = req.body?.jobId;
    if (typeof jobId !== 'string' || !/^[a-f0-9-]{36}$/.test(jobId))
      return res.status(400).json({ error: 'Choose a saved local video job.' });
    try {
      const folder = join(jobFolder, jobId);
      if (!existsSync(join(folder, 'job.json'))) return res.status(404).json({ error: 'Video job not found.' });
      const job = JSON.parse(readFileSync(join(folder, 'job.json'), 'utf8'));
      const indices = [0, 4, 8, 12];
      if (job.status !== 'completed' || job.kind !== 'video' || !indices.every(i => existsSync(join(folder, `frame-${String(i).padStart(3, '0')}.png`))))
        return res.status(409).json({ error: 'This video does not have the required local keyframes.' });
      const shots = indices.map((frame, index) => {
        const imageUrl = `/api/local-ai/jobs/${jobId}/assets/frame-${String(frame).padStart(3, '0')}.png`;
        return { id: `video-${jobId}-${index}`, shotNumber: index + 1, durationSeconds: 0.5, timestamp: frame / 8,
          promptDescription: job.prompt, spokenDescription: `Video keyframe ${index + 1}. Continuity unreviewed.`,
          currentImageUrl: imageUrl, originalImageUrl: imageUrl,
          videoUrl: `/api/local-ai/jobs/${jobId}/assets/generated-video.mp4`, generatedJobId: jobId, status: 'uncertain',
          revisions: [{ revisionId: `video-${jobId}-${index}-initial`, timestamp: Date.now(), imageUrl, actionApplied: 'Imported local keyframe; unreviewed' }] };
      });
      res.json({ shots });
    } catch (error) { next(error); }
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));

  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof UserError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    const status =
      typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 500;
    const message =
      status === 401 || status === 403
        ? 'Meta could not authorize this key. Check its SAM access.'
        : status === 429
          ? 'Meta is rate limiting requests. Wait before trying again.'
          : status === 413
            ? 'The image is too large. Upload an image under 8 MB.'
            : status === 400
              ? 'The request could not be read. Try loading the frame again.'
              : 'The selection service did not complete. No correction was applied. Try again when connected.';
    res.status([400, 401, 403, 413, 429].includes(status) ? status : 502).json({ error: message });
  };
  app.use(errorHandler);
  return app;
}
