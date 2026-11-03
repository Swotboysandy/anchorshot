import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../server/app';
import { ffmpegAvailable, formatSmpteTimecode, renderAnimatic } from '../server/animatic';

const frame = (background: string) =>
  sharp({ create: { width: 800, height: 450, channels: 3, background } }).png().toBuffer();
const dataUrl = async (background: string) => `data:image/png;base64,${(await frame(background)).toString('base64')}`;
const hasFfmpeg = await ffmpegAvailable();

describe.skipIf(!hasFfmpeg)('animatic encoding with local ffmpeg', () => {
  it('holds each frame for its duration and produces H.264 video with AAC audio', async () => {
    const video = await renderAnimatic([
      { image: await frame('#2255cc'), seconds: 1 },
      { image: await frame('#cc5522'), seconds: 1.5 },
    ]);
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'animatic-test-')), 'out.mp4');
    writeFileSync(file, video);
    const probe = JSON.parse(
      execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,avg_frame_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' }),
    );
    expect(probe.streams.map((s: { codec_name: string }) => s.codec_name).sort()).toEqual(['aac', 'h264']);
    expect(probe.streams.find((s: { width?: number }) => s.width)).toMatchObject({ width: 1280, height: 720 });
    expect(probe.streams.find((s: { width?: number }) => s.width).avg_frame_rate).toBe('25/1');
    expect(Number(probe.format.duration)).toBeCloseTo(2.5, 0);
  }, 60_000);

  it('moves the camera across a still for a planned move', async () => {
    const image = await sharp({ create: { width: 800, height: 450, channels: 3, background: '#2255cc' } })
      .composite([{ input: await sharp({ create: { width: 80, height: 80, channels: 3, background: '#ffffff' } }).png().toBuffer(), left: 100, top: 100 }])
      .png()
      .toBuffer();
    const folder = mkdtempSync(path.join(tmpdir(), 'animatic-test-'));
    const file = path.join(folder, 'out.mp4');
    writeFileSync(file, await renderAnimatic([{ image, seconds: 2, movement: 'Push in' }]));
    const grab = (at: string) => execFileSync('ffmpeg', ['-v', 'error', '-ss', at, '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 24 });
    const white = (b: Buffer) => b.reduce((n, v) => n + (v > 200 ? 1 : 0), 0);
    // The white square grows on screen as the camera pushes in.
    expect(white(grab('1.8'))).toBeGreaterThan(white(grab('0.1')) * 1.1);
  }, 60_000);

  it('stretches a shot so its narration is never cut off', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'animatic-test-'));
    const voice = path.join(folder, 'voice.mp3');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', voice]);
    const video = await renderAnimatic([
      { image: await frame('#2255cc'), seconds: 1, narration: readFileSync(voice) },
      { image: await frame('#cc5522'), seconds: 1 },
    ]);
    const file = path.join(folder, 'out.mp4');
    writeFileSync(file, video);
    const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }));
    expect(duration).toBeGreaterThan(4.2);
    expect(duration).toBeLessThan(4.8);
    const rms=(at:string)=>{
      const pcm=execFileSync('ffmpeg',['-v','error','-ss',at,'-i',file,'-t','0.1','-vn','-ac','1','-f','s16le','-'],{windowsHide:true});
      let sum=0;for(let i=0;i<pcm.length;i+=2)sum+=(pcm.readInt16LE(i)/32768)**2;
      return Math.sqrt(sum/(pcm.length/2));
    };
    expect(rms('1.0')).toBeGreaterThan(.03);
    expect(rms('4.0')).toBeLessThan(.002);

  }, 60_000);
});

describe('/api/export/animatic', () => {
  const post = async (app: ReturnType<typeof createApp>, body: object) => {
    const health = await request(app).get('/api/health');
    return request(app).post('/api/export/animatic').set('X-Anchorshot-Session', health.body.sessionToken).send(body);
  };

  it('validates shots before encoding', async () => {
    const render = vi.fn();
    const app = createApp({ settings: () => ({ key: '', requestLimit: 10 }), renderAnimatic: render, ffmpegAvailable: async () => true });
    expect((await post(app, { shots: [] })).status).toBe(400);
    expect((await post(app, { shots: [{ image: 'data:text/html;base64,AAAA', seconds: 2 }] })).status).toBe(400);
    expect((await post(app, { shots: [{ image: await dataUrl('#000'), seconds: 60 }] })).status).toBe(400);
    expect(render).not.toHaveBeenCalled();
  });

  it('reports 501 when ffmpeg is missing', async () => {
    const app = createApp({ settings: () => ({ key: '', requestLimit: 10 }), ffmpegAvailable: async () => false });
    expect((await post(app, { shots: [{ image: await dataUrl('#000'), seconds: 2 }] })).status).toBe(501);
  });

  it('accepts a film larger than the normal request limit', async () => {
    const render = vi.fn().mockResolvedValue(Buffer.from('mp4'));
    const app = createApp({ settings: () => ({ key: '', requestLimit: 10 }), renderAnimatic: render, ffmpegAvailable: async () => true });
    const image = `data:image/png;base64,${Buffer.alloc(14 * 1024 * 1024).toString('base64')}`;
    expect((await post(app, { shots: [{ image, seconds: 2 }] })).status).toBe(200);
  });

  it('formats SMPTE timecode at 25 fps correctly', () => {
    expect(formatSmpteTimecode(0)).toBe('00:00:00:00');
    expect(formatSmpteTimecode(1)).toBe('00:00:01:00');
    expect(formatSmpteTimecode(1.5)).toBe('00:00:01:13');
    expect(formatSmpteTimecode(65.2)).toBe('00:01:05:05');
  });

  it('passes burnInTimecode flag from request body to renderAnimatic', async () => {
    const render = vi.fn().mockResolvedValue(Buffer.from('mp4'));
    const app = createApp({
      settings: () => ({ key: '', requestLimit: 10 }),
      renderAnimatic: render,
      ffmpegAvailable: async () => true,
    });
    const res = await post(app, {
      burnInTimecode: true,
      shots: [{ image: await dataUrl('#333'), seconds: 2 }],
    });
    expect(res.status).toBe(200);
    expect(render).toHaveBeenCalledWith(
      expect.any(Array),
      undefined,
      undefined,
      { burnInTimecode: true, signal: expect.any(AbortSignal) }
    );
  });
});

describe.skipIf(!hasFfmpeg)('audit: actual video and timecode exports', () => {
  it('keeps moving video rather than exporting its placeholder image, with BITC enabled', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'anchorshot-video-export-'));
    const input = path.join(folder, 'input.mp4');
    const output = path.join(folder, 'output.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=8:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input]);
    writeFileSync(output, await renderAnimatic([{ image: await frame('#000000'), video: readFileSync(input), seconds: 1.5 }], undefined, undefined, { burnInTimecode: true }));
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', output], { encoding: 'utf8' }));
    expect(Number(probe.format.duration)).toBeCloseTo(1.5, 1);
    const pixels = (at: string) => execFileSync('ffmpeg', ['-v', 'error', '-ss', at, '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 4 << 20 });
    const first = pixels('0.1'); const later = pixels('0.7');
    expect(first.equals(later)).toBe(false);
    expect(first.some(value => value > 200)).toBe(true);
  }, 60_000);
});


it('routes bounded local narration to the encoder and rejects remote or non-audio payloads',async()=>{
 const render=vi.fn().mockResolvedValue(Buffer.from('mp4'));
 const app=createApp({settings:()=>({key:'',requestLimit:10}),renderAnimatic:render,ffmpegAvailable:async()=>true});
 const health=await request(app).get('/api/health');
 const image=await dataUrl('#000');
 const post=(narration:string)=>request(app).post('/api/export/animatic').set('X-Anchorshot-Session',health.body.sessionToken).send({shots:[{image,seconds:1,narration}]});
 expect((await post('https://example.test/voice.mp3')).status).toBe(400);
 expect((await post('data:text/html;base64,AAAA')).status).toBe(400);
 expect(render).not.toHaveBeenCalled();
 expect((await post('data:audio/wav;base64,AQIDBA==')).status).toBe(200);
 expect(render.mock.calls[0][0][0].narration).toEqual(Buffer.from([1,2,3,4]));
});


it.skipIf(!hasFfmpeg)('preserves source audio through looping and uses attached narration instead of the source soundtrack',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anchorshot-audio-export-'));
 try {
  const clip=path.join(folder,'source.mp4'),voice=path.join(folder,'narration.wav'),output=path.join(folder,'export.mp4');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=128x96:r=8:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',clip],{windowsHide:true});
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=880:duration=0.8',voice],{windowsHide:true});
  const sample=(at:string)=>{
   const bytes=execFileSync('ffmpeg',['-v','error','-ss',at,'-i',output,'-t','0.1','-vn','-ar','44100','-ac','1','-f','s16le','-'],{windowsHide:true});
   let sum=0,crossings=0,previous=0;for(let i=0;i<bytes.length;i+=2){const value=bytes.readInt16LE(i)/32768;sum+=value*value;if(i&&value*previous<0)crossings++;previous=value;}
   return {rms:Math.sqrt(sum/(bytes.length/2)),crossings};
  };
  writeFileSync(output,await renderAnimatic([{image:await frame('#000'),video:readFileSync(clip),startSeconds:0.2,seconds:2},{image:await frame('#000'),seconds:1}]));
  expect(sample('0.2').rms).toBeGreaterThan(.03);
  expect(sample('1.2').rms).toBeGreaterThan(.03);
  expect(sample('0.2').crossings).toBeGreaterThan(75);expect(sample('0.2').crossings).toBeLessThan(100);
  expect(sample('2.4').rms).toBeLessThan(.002);
  writeFileSync(output,await renderAnimatic([{image:await frame('#000'),video:readFileSync(clip),seconds:1.2,narration:readFileSync(voice)}]));
  expect(sample('0.2').rms).toBeGreaterThan(.03);
  expect(sample('0.2').crossings).toBeGreaterThan(160);expect(sample('0.2').crossings).toBeLessThan(190);
  expect(sample('1.0').rms).toBeLessThan(.002);
 }finally{if(!folder.startsWith(path.join(tmpdir(),'anchorshot-audio-export-')))throw new Error('Unsafe cleanup');rmSync(folder,{recursive:true,force:true});}
},60000);
