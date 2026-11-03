import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { recolorMaskedPixels, verifyMaskedPixelDiff } from '../src/services/maskIntegrity';
import { VIDEO_COLORS, type VideoManifest, type VideoTrackPlan, type VideoCorrectionReport } from '../src/types/videoTracks';

const MAX_PIXELS = 1024 * 1024;
const MAX_TOTAL_PIXELS = 16 * MAX_PIXELS;
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
export const frameName = (index: number) => `frame-${String(index).padStart(3,'0')}.png`;
export class VideoTrackError extends Error {}

/** Bounded local processes; no shell or network. */
export function runVision(command: string, args: string[], signal?: AbortSignal, maxOutput = 65536, input?: string, timeoutMs = 60000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>300000)return reject(new VideoTrackError('Invalid local process timeout.'));
    if (signal?.aborted) return reject(new VideoTrackError('Video operation cancelled.'));
    const child = spawn(command, args, {windowsHide:true, shell:false});
    const chunks: Buffer[] = []; let size = 0, errors = '', failure: Error | undefined;
    const stop = () => { failure ??= new VideoTrackError('Video operation cancelled.'); child.kill(); };
    signal?.addEventListener('abort', stop, {once:true});
    const timer = setTimeout(() => { failure = new VideoTrackError('Local video operation timed out.'); child.kill(); }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > maxOutput) { failure = new VideoTrackError('Video output exceeded its expected size.'); child.kill(); } else chunks.push(chunk); });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
    child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-2000); });
    const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
    child.on('error', error => { clean(); reject(error); });
    child.on('close', code => { clean(); if (failure || code !== 0) reject(failure ?? new VideoTrackError(errors || 'Video process failed.')); else resolve(Buffer.concat(chunks)); });
  });
}

export async function readVideoManifest(folder: string, jobId: string, signal?: AbortSignal): Promise<VideoManifest> {
  const files = (await readdir(folder)).filter(file => /^frame-\d{3}\.png$/.test(file)).sort();
  if (files.length < 2 || files.length > 64 || files.some((file, index) => file !== frameName(index)))
    throw new VideoTrackError('This clip needs 2–64 consecutive source frames.');
  const probe = JSON.parse((await runVision('ffprobe', ['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=width,height,avg_frame_rate,nb_read_frames','-of','json',path.join(folder,'generated-video.mp4')], signal)).toString());
  const video = probe.streams?.[0];
  const [numerator, denominator] = String(video?.avg_frame_rate ?? '').split('/').map(Number);
  const fps = numerator / denominator;
  if (!(fps > 0 && fps <= 60) || Number(video?.nb_read_frames) !== files.length)
    throw new VideoTrackError('Video timing or decoded frame count does not match the saved frames.');
  const frames = [];
  for (const [index, file] of files.entries()) {
    if (signal?.aborted) throw new VideoTrackError('Video operation cancelled.');
    const bytes = await readFile(path.join(folder,file));
    const meta = await sharp(bytes, {limitInputPixels:MAX_PIXELS}).metadata();
    if (!meta.width || !meta.height || meta.width !== video.width || meta.height !== video.height || meta.width * meta.height * files.length > MAX_TOTAL_PIXELS)
      throw new VideoTrackError('Source frames must match video dimensions and fit the local review limit.');
    frames.push({index,sourceHash:hash(bytes),width:meta.width,height:meta.height,url:`/api/local-ai/jobs/${jobId}/assets/${file}`});
  }
  const fingerprint = hash(JSON.stringify({jobId,fps,frames:frames.map(frame=>frame.sourceHash),video:hash(await readFile(path.join(folder,'generated-video.mp4')))}));
  return {jobId,fingerprint,fps,frames};
}

export function decodeVideoMask(encoded: unknown, pixels: number): Uint8Array {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length !== 4*Math.ceil(pixels/3))
    throw new VideoTrackError('A frame mask is malformed.');
  const mask = Buffer.from(encoded,'base64');
  if (mask.length !== pixels || mask.some(value => value !== 0 && value !== 1)) throw new VideoTrackError('A frame mask must contain exactly one binary value per source pixel.');
  return new Uint8Array(mask);
}

export function validateVideoPlan(manifest: VideoManifest, value: unknown) {
  const plan = value as VideoTrackPlan;
  if (!plan || plan.sourceJobId !== manifest.jobId || plan.fingerprint !== manifest.fingerprint)
    throw new VideoTrackError('The source clip changed. Load it again and review its masks.');
  if (!Array.isArray(plan.tracks) || !plan.tracks.length || plan.tracks.length > 2 || new Set(plan.tracks.map(track=>track?.objectId)).size !== plan.tracks.length)
    throw new VideoTrackError('Choose separate cup and/or umbrella tracks.');
  const decoded = plan.tracks.map(track => {
    if (!['cup','umbrella'].includes(track.objectId) || !Object.hasOwn(VIDEO_COLORS,track.color) || !Array.isArray(track.frames) || track.frames.length !== manifest.frames.length)
      throw new VideoTrackError('Every object needs a valid colour and a selection for every frame.');
    return track.frames.map((entry, index) => {
      const frame = manifest.frames[index];
      if (!entry || entry.frameIndex !== index || entry.sourceHash !== frame.sourceHash || entry.reviewed !== true || !Number.isInteger(entry.revision) || entry.revision < 1 || typeof entry.absent !== 'boolean' || !['manual','optical-flow'].includes(entry.method))
        throw new VideoTrackError(`Review ${track.objectId} in frame ${index+1}. Unreviewed or stale masks cannot be applied.`);
      const mask = decodeVideoMask(entry.maskBase64,frame.width*frame.height);
      const count = mask.reduce((sum,value)=>sum+value,0);
      if (entry.absent ? count !== 0 : count < 16) throw new VideoTrackError(`Mark ${track.objectId} absent or select at least 16 visible pixels in frame ${index+1}.`);
      return mask;
    });
  });
  for (let index=0;index<manifest.frames.length;index++) {
    if (decoded.length > 1 && decoded[0][index].some((value,pixel)=>value && decoded[1][index][pixel]))
      throw new VideoTrackError(`Cup and umbrella overlap in frame ${index+1}. Select only each object's visible pixels.`);
  }
  return decoded;
}

export async function correctVideoFrames(sourceFolder: string, destination: string, manifest: VideoManifest, plan: VideoTrackPlan, signal?: AbortSignal): Promise<VideoCorrectionReport> {
  const decoded = validateVideoPlan(manifest,plan);
  const report: VideoCorrectionReport = {sourceJobId:manifest.jobId,sourceFingerprint:manifest.fingerprint,frames:manifest.frames.length,fps:manifest.fps,rawChangedOutside:0,rawChangedInside:0,encodedOutsideMeanError:0,encodedOutsideMaxError:0,objects:plan.tracks.map(track=>({objectId:track.objectId,visibleFrames:0,selectedPixels:0,changedPixels:0})),review:'human-reviewed-masks',semanticContinuity:'unverified'};
  const references: Uint8ClampedArray[] = [];
  const unions: Uint8Array[] = [];
  for (const frame of manifest.frames) {
    if (signal?.aborted) throw new VideoTrackError('Video operation cancelled.');
    const bytes = await readFile(path.join(sourceFolder,frameName(frame.index)));
    if (hash(bytes) !== frame.sourceHash) throw new VideoTrackError('A source frame changed during correction.');
    const raw = await sharp(bytes).ensureAlpha().raw().toBuffer();
    const before = new Uint8ClampedArray(raw);
    let after: Uint8ClampedArray = before.slice();
    const union = new Uint8Array(frame.width*frame.height);
    for (const [i,track] of plan.tracks.entries()) {
      const mask = decoded[i][frame.index];
      if (track.frames[frame.index].absent) continue;
      const result = recolorMaskedPixels(after,mask,VIDEO_COLORS[track.color],{allowUnchanged:true});
      after = result.pixels;
      union.forEach((_,pixel)=>{union[pixel] ||= mask[pixel];});
      report.objects[i].visibleFrames++;
      report.objects[i].selectedPixels += result.verification.selectedPixels;
      report.objects[i].changedPixels += result.verification.changedInside;
    }
    const check = verifyMaskedPixelDiff(before,after,union);
    if (check.changedOutside) throw new VideoTrackError('Outside-mask pixels changed; correction was not accepted.');
    report.rawChangedOutside += check.changedOutside; report.rawChangedInside += check.changedInside;
    await sharp(Buffer.from(after), {raw:{width:frame.width,height:frame.height,channels:4}}).png().toFile(path.join(destination,frameName(frame.index)));
    references.push(after); unions.push(union);
  }
  if (!report.rawChangedInside) throw new VideoTrackError('The reviewed masks produced no pixel changes.');
  await runVision('ffmpeg',['-v','error','-y','-framerate',String(manifest.fps),'-i',path.join(destination,'frame-%03d.png'),'-i',path.join(sourceFolder,'generated-video.mp4'),'-map','0:v:0','-map','1:a?','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-t',String(manifest.frames.length/manifest.fps),'-movflags','+faststart',path.join(destination,'generated-video.mp4')],signal);
  const {width,height} = manifest.frames[0];
  const decodedVideo = await runVision('ffmpeg',['-v','error','-i',path.join(destination,'generated-video.mp4'),'-an','-f','rawvideo','-pix_fmt','rgba','pipe:1'],signal,width*height*4*manifest.frames.length);
  if (decodedVideo.length !== width*height*4*manifest.frames.length) throw new VideoTrackError('The encoded clip is missing frames.');
  let total = 0, samples = 0;
  references.forEach((reference,index)=>{
    for (let pixel=0;pixel<unions[index].length;pixel++) if (!unions[index][pixel]) {
      for (let channel=0;channel<3;channel++) {
        const difference = Math.abs(reference[pixel*4+channel]-decodedVideo[index*width*height*4+pixel*4+channel]);
        total += difference; samples++; report.encodedOutsideMaxError = Math.max(report.encodedOutsideMaxError,difference);
      }
    }
  });
  report.encodedOutsideMeanError = samples ? total/samples : 0;
  if ((await readVideoManifest(sourceFolder,manifest.jobId,signal)).fingerprint !== manifest.fingerprint) throw new VideoTrackError('The source video changed during correction.');
  await writeFile(path.join(destination,'modification-report.json'),JSON.stringify(report,null,2));
  await writeFile(path.join(destination,'reviewed-tracks.json'),JSON.stringify(plan));
  return report;
}
