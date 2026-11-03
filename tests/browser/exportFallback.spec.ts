import {test,expect} from '@playwright/test';
import sharp from 'sharp';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

for(const movement of ['Locked','Push in','Pan','Pull out','Dolly','Tilt']) test(`actual browser fallback preserves framing, duration and ${movement}`,async({page})=>{
 const png=await sharp({create:{width:100,height:200,channels:4,background:'#ffffff'}}).composite([{input:await sharp({create:{width:15,height:15,channels:4,background:'#555555'}}).png().toBuffer(),left:10,top:25}]).png().toBuffer();
 await page.goto('/');
 const base64=await page.evaluate(async({image,movement})=>{
  const modulePath='/src/services/canvasEngine.ts';
  const module=await import(modulePath);
  const blob=await module.exportStoryboardAnimaticVideo([{currentImageUrl:image,durationSeconds:1,movement,shotNumber:1,status:'uncertain',promptDescription:'This caption must not be painted over the image'}],'Test');
  if(!blob)throw new Error('Recorder unavailable');
  const bytes=new Uint8Array(await blob.arrayBuffer());let text='';for(const byte of bytes)text+=String.fromCharCode(byte);return btoa(text);
 },{image:`data:image/png;base64,${png.toString('base64')}`,movement});
 const folder=mkdtempSync(path.join(tmpdir(),'anchorshot-fallback-'));
 try {
  const file=path.join(folder,'film.webm');writeFileSync(file,Buffer.from(base64,'base64'));
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-show_entries','format=duration:stream=nb_read_frames','-of','json',file],{windowsHide:true}).toString());
  expect(Number(probe.format.duration)).toBeGreaterThan(.9);expect(Number(probe.format.duration)).toBeLessThan(1.5);
  expect(Number(probe.streams[0].nb_read_frames)).toBeGreaterThan(15);
  const raw=execFileSync('ffmpeg',['-v','error','-ss','0.3','-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:4<<20,windowsHide:true});
  expect(raw.length).toBe(800*450*3);
  const pixel=(x:number,y:number)=>Array.from(raw.subarray((y*800+x)*3,(y*800+x)*3+3));
  expect(pixel(30,225).every(v=>v<8)).toBe(true);
  expect(pixel(400,225).every(v=>v>245)).toBe(true);
  expect(pixel(400,430).every(v=>v>245)).toBe(true);
  if(movement!=='Locked'){
   const late=execFileSync('ffmpeg',['-v','error','-ss','0.8','-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:4<<20,windowsHide:true});
   expect(late.length).toBe(raw.length);expect(late.equals(raw)).toBe(false);
  }
  if(movement==='Locked')expect(pixel(280,225).every(v=>v<8)).toBe(true);
  expect(pixel(300,225).every(v=>v>245)).toBe(true);
 } finally {if(!folder.startsWith(path.join(tmpdir(),'anchorshot-fallback-')))throw new Error('Unsafe cleanup');rmSync(folder,{recursive:true,force:true});}
});


test('browser fallback rejects hidden-tab interruption and permits a fresh retry',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const modulePath='/src/services/canvasEngine.ts';const {exportStoryboardAnimaticVideo}=await import(modulePath);
  const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
  const shot={currentImageUrl:canvas.toDataURL(),durationSeconds:.5,movement:'Locked',shotNumber:1,status:'uncertain',promptDescription:'Test'};
  let hidden=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
  const original=MediaRecorder.prototype.start;
  MediaRecorder.prototype.start=function(...args:any[]){original.apply(this,args);setTimeout(()=>{hidden=true;document.dispatchEvent(new Event('visibilitychange'));},60);};
  let failure='';
  try{await exportStoryboardAnimaticVideo([shot],'Hidden');}catch(error){failure=String(error);}
  finally{MediaRecorder.prototype.start=original;hidden=false;document.dispatchEvent(new Event('visibilitychange'));}
  const retry=await exportStoryboardAnimaticVideo([shot],'Retry');
  delete (document as any).hidden;
  return {failure,bytes:retry?.size};
 });
 expect(result.failure).toContain('tab was hidden');expect(result.bytes).toBeGreaterThan(0);
});

test('preview pauses on visibility loss without jumping forward or auto-resuming',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Kitchen to ocean',exact:true}).click();
 await page.getByRole('button',{name:'Apply direction',exact:true}).click();
 await page.getByRole('button',{name:'Play timeline',exact:true}).click();
 const slider=page.getByRole('slider',{name:'Preview time',exact:true});
 await expect.poll(async()=>Number(await slider.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await expect(page.getByRole('button',{name:'Play timeline',exact:true})).toBeVisible();
 const paused=await slider.getAttribute('aria-valuenow');
 await page.waitForTimeout(350);
 await expect(slider).toHaveAttribute('aria-valuenow',paused!);
 await page.evaluate(()=>{delete (document as any).hidden;document.dispatchEvent(new Event('visibilitychange'));});
 await expect(page.getByRole('button',{name:'Play timeline',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Play timeline',exact:true}).click();
 await expect.poll(async()=>Number(await slider.getAttribute('aria-valuenow'))).toBeGreaterThan(Number(paused));
});


test('browser fallback preserves ordered scene holds in the decoded exported film',async({page})=>{
 await page.goto('/');
 const encoded=await page.evaluate(async()=>{
  const modulePath='/src/services/canvasEngine.ts';const {exportStoryboardAnimaticVideo}=await import(modulePath);
  const shots=['#ffffff','#000000'].map((color,index)=>{
   const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const ctx=canvas.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,32,32);
   return {currentImageUrl:canvas.toDataURL(),durationSeconds:index?0.8:0.5,movement:'Locked',shotNumber:index+1,status:'uncertain',promptDescription:'Timing fixture'};
  });
  const blob=await exportStoryboardAnimaticVideo(shots,'Timing');
  const bytes=new Uint8Array(await blob.arrayBuffer());let text='';for(const byte of bytes)text+=String.fromCharCode(byte);return btoa(text);
 });
 const folder=mkdtempSync(path.join(tmpdir(),'anchorshot-fallback-'));
 try{
  const file=path.join(folder,'sequence.webm');writeFileSync(file,Buffer.from(encoded,'base64'));
  const duration=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file],{windowsHide:true}).toString());
  expect(duration).toBeGreaterThanOrEqual(1.2);expect(duration).toBeLessThan(1.65);
  for(const [time,white] of [[0.2,true],[0.75,false],[1.1,false]] as const){
   const frame=execFileSync('ffmpeg',['-v','error','-ss',String(time),'-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{windowsHide:true,maxBuffer:4<<20});
   expect(frame.length).toBe(800*450*3);const center=frame.subarray((225*800+400)*3,(225*800+400)*3+3);
   expect([...center].every(v=>white?v>245:v<8)).toBe(true);
  }
 }finally{if(!folder.startsWith(path.join(tmpdir(),'anchorshot-fallback-')))throw Error('Unsafe cleanup');rmSync(folder,{recursive:true,force:true});}
});

for(const mode of ['constructor','start','early-stop','draw','capture-gap'])test(`film fallback releases tracks after ${mode} failure`,async({page})=>{
 await page.goto('/');const result=await page.evaluate(async(mode)=>{
  const path='/src/services/canvasEngine.ts';const {exportStoryboardAnimaticVideo}=await import(path);
  const c=document.createElement('canvas');c.width=32;c.height=32;const shot={currentImageUrl:c.toDataURL(),durationSeconds:.5,movement:'Locked',shotNumber:1,status:'uncertain',promptDescription:'Test'};
  const Native=window.MediaRecorder,start=Native.prototype.start,capture=HTMLCanvasElement.prototype.captureStream,draw=CanvasRenderingContext2D.prototype.drawImage,now=performance.now.bind(performance);
  const tracks:MediaStreamTrack[]=[];let offset=0,message='',bytes=0,drawCount=0;
  HTMLCanvasElement.prototype.captureStream=function(...args:Parameters<typeof capture>){const stream=capture.apply(this,args);tracks.push(...stream.getTracks());return stream;};
  try{
   if(mode==='constructor')window.MediaRecorder=class extends Native{constructor(stream:MediaStream,options?:MediaRecorderOptions){super(stream,options);throw new Error('Injected constructor failure');}};
   if(mode==='start')Native.prototype.start=function(){throw new Error('Injected start failure');};
   if(mode==='early-stop')Native.prototype.start=function(...args:Parameters<typeof start>){start.apply(this,args);setTimeout(()=>this.stop(),50);};
   if(mode==='draw')CanvasRenderingContext2D.prototype.drawImage=function(...args:any[]){if(++drawCount>2)throw new Error('Injected draw failure');return (draw as any).apply(this,args);};
   if(mode==='capture-gap'){Object.defineProperty(performance,'now',{configurable:true,value:()=>now()+offset});Native.prototype.start=function(...args:Parameters<typeof start>){start.apply(this,args);setTimeout(()=>{offset=5000;},50);};}
   bytes=(await exportStoryboardAnimaticVideo([shot],'Failure test'))?.size??0;
  }catch(error){message=(error as Error).message;}
  finally{window.MediaRecorder=Native;Native.prototype.start=start;HTMLCanvasElement.prototype.captureStream=capture;CanvasRenderingContext2D.prototype.drawImage=draw;delete (performance as any).now;}
  return {message,bytes,tracks:tracks.map(t=>t.readyState)};
 },mode);
 expect(result.message).toMatch(/Injected|before completion|interrupted/);expect(result.bytes).toBe(0);expect(result.tracks.length).toBeGreaterThan(0);expect(result.tracks.every(t=>t==='ended')).toBe(true);
});
