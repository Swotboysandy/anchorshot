import { randomBytes } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
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
import { fixturePlanner, PlannerOutputError, type Planner } from './planner';
import type { ContinuityEvidenceStatus, SegmentationResult } from '../src/types';

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
  imager?: Imager;
}

const MAX_FRAMES = 48;

export function createApp(options: Options) {
  const app = express();
  const sessionToken = randomBytes(24).toString('hex');
  const trackStore = new MaskTrackStore();
  const planner = options.planner ?? fixturePlanner;
  let requestsUsed = 0;
  let active = false;
  let imageActive = false;
  const frames = new Map<string, Buffer>();

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
      requestsUsed,
      requestLimit: settings.requestLimit,
      tracksStored: trackStore.listTracks().length,
      imageModel: options.imager?.model ?? null,
    });
  });

  app.use('/api', express.json({ limit: '12mb' }));

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
      requestsUsed++;
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
        requestsUsed++;
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

      const storedTrack =
        primaryObj && check.maskRef
          ? trackStore.recordTrack({
              maskRef: check.maskRef,
              concept: input.concept,
              shotNumber,
              revision,
              objectId: primaryObj.objectId,
              bounds: primaryObj.bounds,
              confidence: check.confidence,
              sourceHash: input.sourceHash,
              status: check.status,
              evidence: check.explanation,
              provenance: segmentation.provenance ?? 'offline-fixture',
              createdAt: Date.now(),
            })
          : null;

      if (!controller.signal.aborted) {
        res.json({
          ...segmentation,
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
  app.post('/api/muse/transcribe', (req, res) => {
    if (!hasValidSession(req))
      return res.status(403).json({ error: 'Refresh the page before transcribing.' });
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
      res.json(await planner.plan(transcript, previousRevision + 1));
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
    const { prompt, targetObject, seed } = req.body ?? {};
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
      requestsUsed++;
      const frame = await options.imager.generate(
        {
          prompt: prompt.trim(),
          targetObject: targetObject.trim(),
          seed: Number.isInteger(seed) ? seed : 0,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const { image, ...details } = frame;
      // Keep the latest frames by content hash; the browser loads them by URL.
      frames.set(frame.sourceHash, Buffer.from(image.slice(image.indexOf(',') + 1), 'base64'));
      if (frames.size > MAX_FRAMES) frames.delete(frames.keys().next().value!);
      res.json({ ...details, url: `/api/muse/frames/${frame.sourceHash}.png` });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ImagerOutputError) return res.status(502).json({ error: error.message });
      next(error);
    } finally {
      imageActive = false;
    }
  });

  app.get('/api/muse/frames/:file', (req, res) => {
    const frame = frames.get(/^([a-f0-9]{64})\.png$/.exec(req.params.file)?.[1] ?? '');
    if (!frame) return res.status(404).json({ error: 'This generated frame is no longer available.' });
    res.type('png').send(frame);
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
