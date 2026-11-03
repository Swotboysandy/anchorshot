import {runVision} from './videoTracks';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

/**
 * Animatic export: each storyboard frame held for its shot duration, or longer
 * when its narration needs more time, with that narration underneath, encoded
 * once by ffmpeg as H.264/AAC MP4 so it plays everywhere (the browser recorder
 * only makes silent WebM).
 */
export interface AnimaticShot {
  image: Buffer;
  video?: Buffer;
  startSeconds?: number;
  seconds: number;
  /** Planned camera move, drawn as a slow move across the still. */
  movement?: string;
  narration?: Buffer;
}

export interface RenderAnimaticOptions {
  signal?: AbortSignal;
  burnInTimecode?: boolean;
}

export class AnimaticError extends Error {}

const WIDTH = 1280;
const HEIGHT = 720;
const NARRATION_TAIL = 0.4;

export function formatSmpteTimecode(seconds: number, fps = 30): string {
  const totalFrames = Math.max(0, Math.round(seconds * fps));
  const frames = totalFrames % fps;
  const totalSec = Math.floor(totalFrames / fps);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

export function createTimecodeOverlaySvg(
  shotIndex: number,
  totalShots: number,
  startTimeSec: number,
  shotDurationSec: number,
): Buffer {
  const tcStr = formatSmpteTimecode(startTimeSec);
  const shotLabel = `SHOT ${String(shotIndex + 1).padStart(2, '0')}/${String(totalShots).padStart(2, '0')}`;
  const durLabel = `${shotDurationSec.toFixed(1)}s`;
  return Buffer.from(`
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="bgShadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.8"/>
        </filter>
      </defs>
      <g filter="url(#bgShadow)">
        <rect x="28" y="${HEIGHT - 72}" width="400" height="48" rx="6" fill="#0A0D12" fill-opacity="0.88" stroke="#323A46" stroke-width="1.5"/>
        <text x="44" y="${HEIGHT - 44}" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="16" font-weight="700" fill="#38BDF8" letter-spacing="1.5">TC ${tcStr}</text>
        <text x="44" y="${HEIGHT - 30}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" fill="#94A3B8" letter-spacing="0.5">${shotLabel} &#8226; ${durLabel} &#8226; 30 FPS</text>
      </g>
    </svg>
  `);
}

async function mediaSeconds(file: string, ffprobe: string, signal?: AbortSignal): Promise<number> {
  const out=(await runVision(ffprobe,['-v','error','-show_entries','format=duration','-of','csv=p=0',file],signal)).toString();
  const seconds = Number.parseFloat(out);
  if (!(seconds > 0) || seconds > 60) throw new AnimaticError('Narration must have a duration of at most 60 seconds.');
  return seconds;
}

/** True when ffmpeg can be started; export is unavailable otherwise. */
export async function ffmpegAvailable(ffmpeg = 'ffmpeg'): Promise<boolean> {
  try {
    await runVision(ffmpeg, ['-hide_banner', '-version'],undefined,65536,undefined,10000);
    return true;
  } catch {
    return false;
  }
}

/** A gentle Ken Burns move for a planned camera move; locked and unknown moves stay still. */
export function cameraMove(movement: string | undefined, seconds: number): string {
  const total = Math.max(1, Math.round(seconds * 30));
  const t = `min(on/${total},1)`;
  const centre = { x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' };
  const moves: Record<string, { z: string; x: string; y: string }> = {
    'Push in': { z: `1+0.12*${t}`, ...centre },
    Dolly: { z: `1+0.08*${t}`, ...centre },
    'Pull out': { z: `1.12-0.12*${t}`, ...centre },
    Pan: { z: '1.12', x: `(iw-iw/zoom)*${t}`, y: centre.y },
    Tilt: { z: '1.12', x: centre.x, y: `(ih-ih/zoom)*${t}` },
  };
  const move = movement ? moves[movement] : undefined;
  if (!move) return '';
  // Upscale first so the slow move does not jitter from whole-pixel steps.
  return `,scale=${WIDTH * 2}:${HEIGHT * 2},zoompan=z='${move.z}':x='${move.x}':y='${move.y}':d=1:s=${WIDTH}x${HEIGHT}:fps=30`;
}

export async function renderAnimatic(
  shots: AnimaticShot[],
  ffmpeg = 'ffmpeg',
  ffprobe = 'ffprobe',
  options?: RenderAnimaticOptions,
): Promise<Buffer> {
  options?.signal?.throwIfAborted();
  if (!shots.length) throw new AnimaticError('There are no shots to export.');
  const folder = mkdtempSync(path.join(tmpdir(), 'anchorshot-animatic-'));
  try {
    const args = ['-hide_banner', '-v', 'error', '-y'];
    const filters: string[] = [];
    let cumulativeSeconds = 0;
    let inputIndex = 0;
    for (const [i, shot] of shots.entries()) {
      options?.signal?.throwIfAborted();
      const frame = path.join(folder, `shot-${i}.png`);
      let pipeline = sharp(shot.image).resize(WIDTH, HEIGHT, {
        fit: 'contain',
        background: '#000000',
      });

      // Normalise every source (PNG, JPEG, WebP) before ffmpeg sees it.
      await pipeline.png().toFile(frame);
      let seconds = shot.seconds;
      let audio = '';
      if (shot.narration) {
        audio = path.join(folder, `shot-${i}.mp3`);
        writeFileSync(audio, shot.narration);
        // Hold the frame until its narration finishes, plus a short breath.
        seconds = Math.max(seconds, (await mediaSeconds(audio, ffprobe, options?.signal)) + NARRATION_TAIL);
      }
      const v = inputIndex++;
      let sourceHasAudio=false;
      if (shot.video) {
        const clip = path.join(folder, `clip-${i}.mp4`);
        writeFileSync(clip, shot.video);
        if(!audio){
          const streams=JSON.parse((await runVision(ffprobe,['-v','error','-select_streams','a:0','-show_entries','stream=index','-of','json',clip],options?.signal)).toString());
          sourceHasAudio=Array.isArray(streams.streams)&&streams.streams.length>0;
        }
        args.push('-stream_loop', '-1', '-ss', String(shot.startSeconds ?? 0), '-t', String(seconds), '-i', clip);
      } else args.push('-framerate', '30', '-loop', '1', '-t', String(seconds), '-i', frame);
      // An attached narration replaces source audio; otherwise preserve the clip's soundtrack.
      const a = sourceHasAudio ? v : inputIndex++;
      if (audio) args.push('-i', audio);
      else if(!sourceHasAudio) args.push('-f', 'lavfi', '-t', String(seconds), '-i', 'anullsrc=r=44100:cl=stereo');
      const videoLabel = options?.burnInTimecode ? `base${i}` : `v${i}`;
      filters.push(
        `[${v}:v]trim=duration=${seconds},setpts=PTS-STARTPTS,scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30${shot.video ? '' : cameraMove(shot.movement, seconds)},format=yuv420p[${videoLabel}]`,
        `[${a}:a]aresample=44100,aformat=channel_layouts=stereo,apad,atrim=0:${seconds},asetpts=PTS-STARTPTS[a${i}]`,
      );
      if (options?.burnInTimecode) {
        const overlay = path.join(folder, `timecode-${i}.png`);
        await sharp(createTimecodeOverlaySvg(i, shots.length, cumulativeSeconds, seconds)).png().toFile(overlay);
        const overlayIndex = inputIndex++;
        args.push('-framerate', '30', '-loop', '1', '-t', String(seconds), '-i', overlay);
        filters.push(`[${videoLabel}][${overlayIndex}:v]overlay=0:0:shortest=1[v${i}]`);
      }
      cumulativeSeconds += seconds;
    }
    const pairs = shots.map((_, i) => `[v${i}][a${i}]`).join('');
    filters.push(`${pairs}concat=n=${shots.length}:v=1:a=1[v][a]`);
    const output = path.join(folder, 'animatic.mp4');
    args.push(
      '-filter_complex', filters.join(';'),
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart', output,
    );
    await runVision(ffmpeg, args, options?.signal,65536,undefined,300000);
    options?.signal?.throwIfAborted();
    return readFileSync(output);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
