// Local deterministic compositor. No model/API calls occur in this module.
export const DREAM = {width: 800, height: 450, duration: 12, fps: 24, hold: 2} as const;
export type Pixels = {width: number; height: number; data: Uint8ClampedArray};
export type DreamAssets = {kitchen: Pixels; ocean: Pixels; anchor: Pixels; mask: Uint8Array; anchors?: {id:string;name:string;revision:number;mask:Uint8Array}[]; selectionInfo?: {source: 'local-manual-photo' | 'sam-3.1-photo'; name:string; revision:number; sourceSelectedPixels:number; provenance?: string; confidence?: number; maskRef?: string}};
export const dreamProgress = (seconds: number, reduced = false) => {
  const safeTime = Number.isFinite(seconds) ? seconds : 0;
  const t = Math.max(0, Math.min(1, (safeTime - DREAM.hold) / (DREAM.duration - 2 * DREAM.hold)));
  return reduced ? (t < 0.5 ? 0 : 1) : t;
};
export function validateAssets(a: DreamAssets) {
  const {width, height} = a.kitchen;
  if (width < 1 || height < 1 || !Number.isInteger(width) || !Number.isInteger(height) ||
      a.mask.length !== width * height || !a.mask.some(Boolean) ||
      [a.kitchen, a.ocean, a.anchor].some(p => p.width !== width || p.height !== height || p.data.length !== width * height * 4))
    throw new Error('Dream frames and protected cup mask must have matching dimensions and a nonempty selection.');
}
// Assets are validated once at load; the caller owns the reusable output buffer.
export function renderDreamFrame(a: DreamAssets, output: Uint8ClampedArray, seconds: number, reduced = false) {
  const {width:w,height:h,data:src} = a.kitchen;
  const dst = a.ocean.data, fixed = a.anchor.data;
  if (output.length !== src.length || output === src || output === dst || output === fixed)
    throw new Error('Use a separate, frame-sized output buffer.');
  const p = dreamProgress(seconds, reduced);
  const envelope = Math.sin(Math.PI * p);
  for (let y = 0; y < h; y++) {
    const wave = Math.round(envelope * w * 0.018 * Math.sin(y / h * 24 - p * 8));
    for (let x = 0; x < w; x++) {
      const pixel = y * w + x, i = pixel * 4;
      if (a.mask[pixel]) {
        output[i] = fixed[i];
        output[i + 1] = fixed[i + 1];
        output[i + 2] = fixed[i + 2];
        output[i + 3] = fixed[i + 3];
        continue;
      }
      // A soft doorway-shaped reveal expands into the full world, with a water ripple.
      const distance = Math.max(Math.abs(x / w - 0.52) / 0.53, Math.abs(y / h - 0.43) / 0.58);
      const raw = Math.max(0, Math.min(1, (p * 1.8 - distance) / 0.7));
      const mix = p === 0 ? 0 : p === 1 ? 1 : raw * raw * (3 - 2 * raw);
      const sx = Math.max(0, Math.min(w - 1, x + wave));
      const j = (y * w + sx) * 4;
      for (let c = 0; c < 3; c++) output[i+c] = src[j+c] * (1-mix) + dst[j+c] * mix;
      output[i+3] = 255;
    }
  }
}
export function measureAnchor(a: DreamAssets, frame: Uint8ClampedArray) {
  let pixels = 0, changed = 0, maxChannelDelta = 0;
  const fixed = a.anchor.data;
  const mask = a.mask;
  const len = mask.length;
  for (let p = 0; p < len; p++) {
    if (mask[p]) {
      pixels++;
      const i = p * 4;
      const d0 = Math.abs(frame[i] - fixed[i]);
      const d1 = Math.abs(frame[i + 1] - fixed[i + 1]);
      const d2 = Math.abs(frame[i + 2] - fixed[i + 2]);
      const d3 = Math.abs(frame[i + 3] - fixed[i + 3]);
      const delta = Math.max(d0, d1, d2, d3);
      if (delta) changed++;
      if (delta > maxChannelDelta) maxChannelDelta = delta;
    }
  }
  return {protectedPixels: pixels, changedProtectedPixels: changed, maxChannelDelta};
}
const makeCanvas = () => {
  const c = document.createElement('canvas'); c.width = DREAM.width; c.height = DREAM.height; return c;
};
export async function loadDreamAssets(): Promise<DreamAssets> {
  const load = async (url: string) => {
    const img = new Image(); img.src = url; await img.decode();
    const canvas = makeCanvas(), ctx = canvas.getContext('2d')!;
    const scale = Math.max(canvas.width/img.width, canvas.height/img.height);
    ctx.drawImage(img, (canvas.width-img.width*scale)/2, (canvas.height-img.height*scale)/2, img.width*scale, img.height*scale);
    return ctx.getImageData(0,0,canvas.width,canvas.height);
  };
  const [kitchen, ocean] = await Promise.all([load('/dream/kitchen.png'),load('/dream/ocean.png')]);
  // The cup is an authored layer, not a SAM segmentation or an AI-generated identity.
  const cup = makeCanvas(), c = cup.getContext('2d')!;
  c.fillStyle = '#234254'; c.beginPath(); c.ellipse(275,359,85,11,0,0,Math.PI*2); c.fill();
  c.lineWidth = 18; c.strokeStyle = '#348bad'; c.beginPath(); c.ellipse(322,300,29,33,0,0,Math.PI*2); c.stroke();
  c.lineWidth = 6; c.strokeStyle = '#a5d7de'; c.beginPath(); c.ellipse(322,300,29,33,0,0,Math.PI*2); c.stroke();
  const glaze = c.createLinearGradient(213,0,320,0);
  glaze.addColorStop(0,'#145578'); glaze.addColorStop(0.35,'#55b7d2'); glaze.addColorStop(0.65,'#2886aa'); glaze.addColorStop(1,'#103f61');
  c.fillStyle = glaze; c.beginPath(); c.moveTo(214,264); c.lineTo(221,335); c.bezierCurveTo(221,365,314,365,316,335); c.lineTo(322,264); c.closePath(); c.fill();
  c.fillStyle = '#c4e6e9'; c.beginPath(); c.ellipse(268,264,54,15,0,0,Math.PI*2); c.fill();
  c.fillStyle = '#17415a'; c.beginPath(); c.ellipse(268,265,47,10,0,0,Math.PI*2); c.fill();
  c.fillStyle = '#382b27'; c.beginPath(); c.ellipse(268,267,43,7,0,0,Math.PI*2); c.fill();
  const rgba = c.getImageData(0,0,DREAM.width,DREAM.height);
  const mask = Uint8Array.from({length:DREAM.width*DREAM.height},(_,i)=>rgba.data[i*4+3] > 0 ? 1 : 0);
  const base = makeCanvas(), b = base.getContext('2d')!;
  b.putImageData(kitchen,0,0); b.drawImage(cup,0,0);
  const a = {kitchen,ocean,anchor:b.getImageData(0,0,DREAM.width,DREAM.height),mask};
  validateAssets(a); return a;
}
export async function verifyDream(a: DreamAssets, reduced = false, signal?: AbortSignal) {
  const frame = new Uint8ClampedArray(a.kitchen.data.length);
  const timings:number[] = [];
  let drift = 0, maxDelta = 0;
  const objects=(a.anchors??[]).map(anchor=>({id:anchor.id,name:anchor.name,revision:anchor.revision,protectedPixels:anchor.mask.reduce((n,v)=>n+v,0),changedProtectedPixelsAcrossFrames:0,maxChannelDelta:0}));
  const count = DREAM.duration * DREAM.fps + 1;
  const anchorViews = (a.anchors ?? []).map((anchor) => ({
    ...a,
    mask: anchor.mask,
  }));
  for (let i=0;i<count;i++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const start = performance.now(); renderDreamFrame(a,frame,i/DREAM.fps,reduced); timings.push(performance.now()-start);
    const m = measureAnchor(a,frame); drift += m.changedProtectedPixels; maxDelta=Math.max(maxDelta,m.maxChannelDelta);
    anchorViews.forEach((view,index)=>{const score=measureAnchor(view,frame);objects[index].changedProtectedPixelsAcrossFrames+=score.changedProtectedPixels;objects[index].maxChannelDelta=Math.max(objects[index].maxChannelDelta,score.maxChannelDelta);});
    if (i % 6 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  timings.sort((a,b)=>a-b);
  return {mode:'local-composite',backgrounds:'local SD1.5',mask:a.selectionInfo ? (a.selectionInfo.source === 'sam-3.1-photo' ? 'user-approved SAM photo mask' : 'user-approved photo mask; local manual selection; not SAM') : 'authored cup and shadow; not SAM',
    selection:a.selectionInfo || null, objects,
    framesChecked:count, fps:DREAM.fps, durationSeconds:DREAM.duration, reducedMotion:reduced,
    ...measureAnchor(a,frame), changedProtectedPixelsAcrossFrames:drift, maxChannelDelta:maxDelta,
    renderP95Ms:Number(timings[Math.floor(timings.length*0.95)].toFixed(2)),
    passed:drift===0, scope:'Uncompressed compositor frames; lossy WebM encoding is not pixel-exact.', paidApiCalls:0};
}
export async function exportDream(a: DreamAssets, reduced: boolean, signal: AbortSignal, progress:(t:number)=>void): Promise<Blob> {
  if(signal.aborted)throw new DOMException('Export cancelled','AbortError');
  if(document.hidden)throw new Error('Keep this tab visible for dream export.');
  validateAssets(a);
  if (typeof MediaRecorder === 'undefined') throw new Error('Video export is unavailable in this browser. Save a PNG frame instead.');
  const canvas = makeCanvas(), ctx = canvas.getContext('2d')!;
  const frame = ctx.createImageData(DREAM.width,DREAM.height);
  const mimeType = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
  if (!mimeType || !canvas.captureStream) throw new Error('WebM export is unavailable in this browser.');
  renderDreamFrame(a,frame.data,0,reduced); ctx.putImageData(frame,0,0);
  const stream = canvas.captureStream(DREAM.fps);
  let recorder:MediaRecorder;
  try {recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:8_000_000});}
  catch(error){stream.getTracks().forEach(track=>track.stop());throw error;}
  const chunks:Blob[]=[];
  return new Promise((resolve,reject)=>{
    let timer:ReturnType<typeof setTimeout>|undefined,stopTimer:ReturnType<typeof setTimeout>|undefined;
    let failure:Error|undefined,finishing=false,settled=false;
    const settle=()=>{
      if(settled)return;settled=true;clearTimeout(timer);clearTimeout(stopTimer);
      signal.removeEventListener('abort',abort);document.removeEventListener('visibilitychange',visibility);
      recorder.ondataavailable=null;recorder.onerror=null;recorder.onstop=null;
      stream.getTracks().forEach(track=>track.stop());
      if(failure)reject(failure);
      else if(!chunks.length)reject(new Error('Dream export produced no video. Retry with this tab visible.'));
      else resolve(new Blob(chunks,{type:mimeType}));
    };
    const finish=(error?:Error)=>{
      failure ||= error;if(finishing||settled)return;finishing=true;clearTimeout(timer);
      if(recorder.state==='inactive'){settle();return;}
      stopTimer=setTimeout(()=>{failure ||= new Error('Dream recorder did not finish. No partial video was saved.');settle();},5000);
      try{recorder.stop();}catch(error){failure ||= error instanceof Error?error:new Error('Dream recorder could not stop.');settle();}
    };
    const abort=()=>finish(new DOMException('Export cancelled','AbortError'));
    const visibility=()=>{if(document.hidden)finish(new Error('Export stopped because the tab was hidden. Keep this tab visible and retry.'));};
    recorder.ondataavailable=e=>{if(!settled&&e.data.size)chunks.push(e.data);};
    recorder.onerror=()=>finish(new Error('Video recorder failed.'));
    recorder.onstop=()=>{if(!finishing)failure ||= new Error('Dream recorder stopped before completion. No partial video was saved.');settle();};
    signal.addEventListener('abort',abort,{once:true});document.addEventListener('visibilitychange',visibility);
    try{recorder.start();}catch(error){finish(error instanceof Error?error:new Error('Dream recorder could not start.'));return;}
    if(signal.aborted){abort();return;}if(document.hidden){visibility();return;}
    const start=performance.now();let previous=start;
    const tick=()=>{
      if(finishing||settled)return;
      try{
        if(document.hidden){visibility();return;}
        const now=performance.now();
        if(now-previous>2000){finish(new Error('Dream capture was interrupted for over two seconds. No partial video was saved. Retry with this tab active.'));return;}
        previous=now;
        const t=Math.min(DREAM.duration,(now-start)/1000);
        renderDreamFrame(a,frame.data,t,reduced);ctx.putImageData(frame,0,0);progress(t);
        if(finishing||settled)return;
        if(t>=DREAM.duration){timer=setTimeout(()=>finish(),1000/DREAM.fps);return;}
        const elapsed=performance.now()-start,nextFrame=Math.floor(elapsed*DREAM.fps/1000)+1;
        timer=setTimeout(tick,Math.max(0,nextFrame*1000/DREAM.fps-elapsed));
      }catch(error){finish(error instanceof Error?error:new Error('Dream frame rendering failed.'));}
    };tick();
  });
}
