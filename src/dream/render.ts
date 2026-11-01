import { expandMask } from '../lib/correction';
import { loadSample, sampleMask } from '../lib/media';
import { DURATION, timelineAt, type DreamPlan } from './timeline';

export const W = 1120,
  H = 700;
export type Assets = { worlds: HTMLCanvasElement[]; anchor: HTMLCanvasElement };
function surface(width = W, height = H) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is unavailable.');
  return { canvas, ctx };
}
function gradient(ctx: CanvasRenderingContext2D, top: string, bottom: string, y = H) {
  const g = ctx.createLinearGradient(0, 0, 0, y);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}
function arch(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + height);
  ctx.lineTo(x, y + width / 2);
  ctx.arc(x + width / 2, y + width / 2, width / 2, Math.PI, 0);
  ctx.lineTo(x + width, y + height);
  ctx.closePath();
}
function world(index: number) {
  const { canvas, ctx } = surface();
  if (index === 0) {
    gradient(ctx, '#353f39', '#162d2a');
    const light = ctx.createRadialGradient(770, 150, 10, 650, 250, 650);
    light.addColorStop(0, '#b8a979');
    light.addColorStop(0.6, '#696c53');
    light.addColorStop(1, '#354b40');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#6b7054';
    ctx.beginPath();
    ctx.moveTo(0, 530);
    ctx.lineTo(W, 480);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.fill();
    ctx.strokeStyle = '#293d2f44';
    ctx.lineWidth = 2;
    for (let x = -1300; x <= 2100; x += 200) {
      ctx.beginPath();
      ctx.moveTo(640, 480);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    arch(ctx, 560, 90, 300, 465);
    ctx.fillStyle = '#253c32';
    ctx.fill();
    arch(ctx, 577, 107, 266, 448);
    ctx.fillStyle = '#c0c5a1';
    ctx.fill();
    ctx.save();
    arch(ctx, 577, 107, 266, 448);
    ctx.clip();
    const sky = ctx.createLinearGradient(0, 150, 0, 550);
    sky.addColorStop(0, '#cecca2');
    sky.addColorStop(1, '#689580');
    ctx.fillStyle = sky;
    ctx.fillRect(577, 107, 266, 448);
    ctx.fillStyle = '#456959';
    ctx.beginPath();
    ctx.moveTo(570, 445);
    ctx.quadraticCurveTo(700, 360, 850, 434);
    ctx.lineTo(850, 560);
    ctx.lineTo(570, 560);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#3e5040';
    ctx.fillRect(80, 150, 340, 18);
    ctx.fillRect(80, 300, 340, 15);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = ['#ad9065', '#c1af84', '#728469', '#d5be92'][i];
      ctx.beginPath();
      ctx.roundRect(110 + i * 73, 96 - (i % 2) * 20, 45, 54 + (i % 2) * 20, 8);
      ctx.fill();
    }
    ctx.fillStyle = '#263e33';
    ctx.fillRect(80, 390, 350, 150);
    ctx.strokeStyle = '#73826a';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.strokeRect(91 + i * 110, 406, 94, 120);
      ctx.fillStyle = '#c0ad7b';
      ctx.fillRect(170 + i * 110, 438, 3, 17);
    }
    ctx.strokeStyle = '#293b30';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(960, 0);
    ctx.lineTo(960, 112);
    ctx.stroke();
    ctx.fillStyle = '#dac894';
    ctx.beginPath();
    ctx.ellipse(960, 147, 75, 36, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#e9d7a5';
    ctx.fillRect(885, 145, 150, 6);
  } else if (index === 1) {
    gradient(ctx, '#767c84', '#e3c292', 390);
    ctx.fillStyle = '#f5ddb0';
    ctx.beginPath();
    ctx.arc(710, 220, 64, 0, Math.PI * 2);
    ctx.fill();
    const sea = ctx.createLinearGradient(0, 325, 0, H);
    sea.addColorStop(0, '#557c7d');
    sea.addColorStop(1, '#163d48');
    ctx.fillStyle = sea;
    ctx.fillRect(0, 325, W, H - 325);
    for (let y = 330; y < H; y += 8) {
      const span = (y - 320) * 0.55;
      ctx.strokeStyle = `rgba(240,211,151,${0.35 * (1 - (y - 330) / 440)})`;
      ctx.lineWidth = 1 + (y - 330) / 140;
      ctx.beginPath();
      ctx.moveTo(710 - span * (0.5 + noise(y)), y);
      ctx.lineTo(710 + span * (0.6 + noise(y + 1)), y);
      ctx.stroke();
    }
    ctx.save();
    arch(ctx, 694, 192, 115, 218);
    ctx.strokeStyle = '#e4cb95';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#304e51';
    ctx.beginPath();
    ctx.moveTo(0, 352);
    ctx.quadraticCurveTo(150, 300, 260, 350);
    ctx.closePath();
    ctx.fill();
  } else {
    gradient(ctx, '#0c1c33', '#34485d');
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = `rgba(230,236,214,${0.25 + noise(i + 4) * 0.65})`;
      ctx.beginPath();
      ctx.arc(noise(i + 11) * W, noise(i + 324) * 500, 0.4 + noise(i + 64) * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    const glow = ctx.createRadialGradient(740, 205, 50, 740, 205, 200);
    glow.addColorStop(0, '#c1d8d733');
    glow.addColorStop(1, '#c1d8d700');
    ctx.fillStyle = glow;
    ctx.fillRect(520, 0, 440, 420);
    const moon = ctx.createRadialGradient(700, 160, 8, 760, 230, 100);
    moon.addColorStop(0, '#e5e5c6');
    moon.addColorStop(1, '#8fa9a9');
    ctx.fillStyle = moon;
    ctx.beginPath();
    ctx.arc(740, 205, 94, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(740, 205, 94, 0, Math.PI * 2);
    ctx.clip();
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = '#597a8822';
      ctx.beginPath();
      ctx.arc(
        655 + noise(i + 44) * 180,
        120 + noise(i + 71) * 180,
        3 + noise(i + 8) * 14,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();
    for (let layer = 0; layer < 3; layer++) {
      ctx.fillStyle = ['#445464', '#617174', '#87908a'][layer];
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 14)
        ctx.lineTo(
          x,
          405 +
            layer * 73 +
            Math.sin(x * 0.006 + layer * 2) * 50 +
            Math.cos(x * 0.012 + layer) * 20,
        );
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    }
    arch(ctx, 690, 337, 72, 144);
    ctx.strokeStyle = '#e3d4ad';
    ctx.lineWidth = 5;
    ctx.stroke();
  }
  return canvas;
}
function noise(seed: number) {
  const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export async function prepareAssets(): Promise<Assets> {
  await document.fonts.ready;
  const frame = await loadSample(),
    mask = expandMask(await sampleMask(frame));
  const { canvas, ctx } = surface(frame.width, frame.height);
  const rgba = frame.pixels.slice();
  for (let i = 0; i < mask.length; i++) if (!mask[i]) rgba[i * 4 + 3] = 0;
  ctx.putImageData(new ImageData(rgba, frame.width, frame.height), 0, 0);
  const cutout = surface(300, 230);
  cutout.ctx.drawImage(canvas, 450, 310, 300, 230, 0, 0, 300, 230);
  return { worlds: [world(0), world(1), world(2)], anchor: cutout.canvas };
}

export function renderDream(
  ctx: CanvasRenderingContext2D,
  assets: Assets,
  seconds: number,
  plan: DreamPlan,
) {
  const { index, next, blend } = timelineAt(seconds);
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(assets.worlds[index], 0, 0);
  if (!plan.reducedMotion && blend > 0) {
    ctx.save();
    if (plan.transition === 'dissolve') {
      ctx.globalAlpha = blend;
    } else {
      // Expand a doorway aperture until it covers the whole frame; the anchor is composited afterward.
      const width = 40 + blend * (W * 2.2),
        height = 100 + blend * (H * 2.3);
      arch(ctx, W * 0.64 - width / 2, H * 0.46 - height / 2, width, height);
      ctx.clip();
    }
    ctx.drawImage(assets.worlds[next], 0, 0);
    ctx.restore();
  }
  if (index === 1 && !plan.images[index] && !plan.reducedMotion && blend === 0) {
    ctx.save();
    ctx.strokeStyle = '#cce1c326';
    ctx.lineWidth = 1;
    for (let i = 0; i < 18; i++) {
      const y = 345 + i * 14;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 12) {
        const yy = y + Math.sin(x * 0.014 + seconds * 0.7 + i) * (0.6 + i * 0.17);
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  // The ledge and cup use fixed source geometry across all worlds, never a regenerated identity.
  if (plan.anchor) {
    const ledge = ctx.createLinearGradient(0, 570, 0, H);
    ledge.addColorStop(0, '#263732');
    ledge.addColorStop(1, '#172725');
    ctx.fillStyle = ledge;
    ctx.beginPath();
    ctx.moveTo(0, 592);
    ctx.lineTo(W, 618);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.fill();
    ctx.strokeStyle = '#9ca68d55';
    ctx.beginPath();
    ctx.moveTo(0, 592);
    ctx.lineTo(W, 618);
    ctx.stroke();
    ctx.save();
    ctx.fillStyle = '#070f0f55';
    ctx.beginPath();
    ctx.ellipse(196, 613, 112, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(assets.anchor, 92, 438, 230, 176.333);
    ctx.restore();
  }
  const caption = plan.captions[blend > 0.5 && !plan.reducedMotion ? next : index];
  if (!plan.anchor) {
    ctx.fillStyle = '#102019d9';
    ctx.fillRect(0, 615, W, 85);
  }
  ctx.font = '18px "DM Sans", sans-serif';
  ctx.fillStyle = '#e5e7d9';
  ctx.textBaseline = 'top';
  const lines: string[] = [];
  let line = '';
  for (const character of caption) {
    if (ctx.measureText(line + character).width > 700) {
      lines.push(line.trim());
      line = '';
    }
    line += character;
  }
  if (line) lines.push(line.trim());
  lines.slice(0, 3).forEach((text, i) => ctx.fillText(text, 360, 628 + i * 22));
  ctx.restore();
}

export async function recordDream(
  assets: Assets,
  plan: DreamPlan,
  signal: AbortSignal,
  onProgress: (value: number) => void,
): Promise<Blob> {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream)
    throw new Error(
      'Video recording is not supported in this browser. Save a frame or the plan instead.',
    );
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
  if (!mime) throw new Error('This browser cannot export WebM. Try Chrome.');
  const { fixWebmDuration } = await import('@fix-webm-duration/fix');
  const { canvas, ctx } = surface();
  renderDream(ctx, assets, 0, plan);
  const stream = canvas.captureStream(30),
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
  return new Promise((resolve, reject) => {
    const chunks: BlobPart[] = [];
    let raf = 0,
      timer: ReturnType<typeof setTimeout>,
      failure: Error | null = null,
      started = 0;
    const clean = () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      document.removeEventListener('visibilitychange', hidden);
      stream.getTracks().forEach((track) => track.stop());
    };
    const fail = (message: string) => {
      failure = new Error(message);
      if (recorder.state !== 'inactive') recorder.stop();
      else {
        clean();
        reject(failure);
      }
    };
    const cancel = () => fail('Export cancelled.');
    const hidden = () => {
      if (document.hidden)
        fail('Export stopped because the tab was hidden. Keep it visible while recording.');
    };
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onerror = () => fail('The browser could not record this preview.');
    recorder.onstop = () => {
      const elapsed = performance.now() - started;
      clean();
      if (failure) reject(failure);
      else if (chunks.length)
        fixWebmDuration(new Blob(chunks, { type: mime }), elapsed, { logger: false }).then(
          resolve,
          reject,
        );
      else reject(new Error('The recording was empty.'));
    };
    signal.addEventListener('abort', cancel);
    document.addEventListener('visibilitychange', hidden);
    if (signal.aborted || document.hidden) {
      clean();
      reject(new Error('Open this tab before exporting.'));
      return;
    }
    try {
      started = performance.now();
      recorder.start(250);
    } catch (error) {
      clean();
      reject(error);
      return;
    }
    timer = setTimeout(
      () => fail('The recording timed out. Try exporting again in an active tab.'),
      30_000,
    );
    function frame(now: number) {
      const seconds = Math.min(DURATION, (now - started) / 1000);
      renderDream(ctx, assets, seconds, plan);
      onProgress(seconds / DURATION);
      if (seconds >= DURATION) recorder.stop();
      else raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  });
}
