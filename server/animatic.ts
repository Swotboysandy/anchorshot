import { spawn } from 'node:child_process';
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
  seconds: number;
  narration?: Buffer;
}

export interface RenderAnimaticOptions {
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
        <text x="44" y="${HEIGHT - 30}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" fill="#94A3B8" letter-spacing="0.5">${shotLabel} &bull; ${durLabel} &bull; 30 FPS</text>
      </g>
    </svg>
  `);
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let errors = '';
    child.stderr.on('data', (chunk) => (errors = (errors + chunk).slice(-4000)));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(errors) : reject(new AnimaticError(errors.trim() || `${command} exited with ${code}`))));
  });
}

async function mediaSeconds(file: string, ffprobe: string): Promise<number> {
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { windowsHide: true });
    let text = '';
    child.stdout.on('data', (chunk) => (text += chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(text) : reject(new AnimaticError('Narration audio could not be read.'))));
  });
  const seconds = Number.parseFloat(out);
  if (!(seconds > 0)) throw new AnimaticError('Narration audio has no duration.');
  return seconds;
}

/** True when ffmpeg can be started; export is unavailable otherwise. */
export async function ffmpegAvailable(ffmpeg = 'ffmpeg'): Promise<boolean> {
  try {
    await run(ffmpeg, ['-hide_banner', '-version']);
    return true;
  } catch {
    return false;
  }
}

export async function renderAnimatic(
  shots: AnimaticShot[],
  ffmpeg = 'ffmpeg',
  ffprobe = 'ffprobe',
  options?: RenderAnimaticOptions,
): Promise<Buffer> {
  if (!shots.length) throw new AnimaticError('There are no shots to export.');
  const folder = mkdtempSync(path.join(tmpdir(), 'anchorshot-animatic-'));
  try {
    const args = ['-hide_banner', '-v', 'error', '-y'];
    const filters: string[] = [];
    let cumulativeSeconds = 0;
    for (const [i, shot] of shots.entries()) {
      const frame = path.join(folder, `shot-${i}.png`);
      let pipeline = sharp(shot.image).resize(WIDTH, HEIGHT, {
        fit: 'contain',
        background: '#000000',
      });
      if (options?.burnInTimecode) {
        const overlaySvg = createTimecodeOverlaySvg(i, shots.length, cumulativeSeconds, shot.seconds);
        pipeline = pipeline.composite([{ input: overlaySvg }]);
      }
      // Normalise every source (PNG, JPEG, WebP) before ffmpeg sees it.
      await pipeline.png().toFile(frame);
      let seconds = shot.seconds;
      let audio = '';
      if (shot.narration) {
        audio = path.join(folder, `shot-${i}.mp3`);
        writeFileSync(audio, shot.narration);
        // Hold the frame until its narration finishes, plus a short breath.
        seconds = Math.max(seconds, (await mediaSeconds(audio, ffprobe)) + NARRATION_TAIL);
      }
      cumulativeSeconds += seconds;
      args.push('-loop', '1', '-t', String(seconds), '-i', frame);
      if (audio) args.push('-i', audio);
      else args.push('-f', 'lavfi', '-t', String(seconds), '-i', 'anullsrc=r=44100:cl=stereo');
      const v = i * 2;
      filters.push(
        `[${v}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`,
        `[${v + 1}:a]aresample=44100,aformat=channel_layouts=stereo,apad,atrim=0:${seconds},asetpts=PTS-STARTPTS[a${i}]`,
      );
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
    await run(ffmpeg, args);
    return readFileSync(output);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
