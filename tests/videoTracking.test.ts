import {afterEach,expect,it,vi} from 'vitest';
import {correctReviewedVideoObject} from '../src/services/videoTracking';
import request from 'supertest';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {createLocalAi} from '../server/localAi';
import {validateVideoPlan,runVision} from '../server/videoTracks';
import {detectMaskedColor,verifyMaskedPixelDiff} from '../src/services/maskIntegrity';
import {localMeasurementsAsset, type LocalJob} from '../src/services/localGeneration';
import {videoFixture,sha} from './helpers/videoFixture';
const roots:string[]=[];
const root=()=>{const folder=mkdtempSync(path.join(tmpdir(),'anchorshot-video-'));roots.push(folder);return folder;};
afterEach(()=>{for(const folder of roots.splice(0)){if(!folder.startsWith(path.join(tmpdir(),'anchorshot-video-')))throw new Error('Unsafe test path');rmSync(folder,{recursive:true,force:true});}});
const post=(app:ReturnType<typeof createLocalAi>['app'],route:string,body:unknown)=>request(app).post(route).set('Host','127.0.0.1').set('X-Anchorshot-Local','1').send(body);

it('corrects moving cup and umbrella masks, handles absence and re-entry, and retains original media',async()=>{
 const workspace=root(),fixture=await videoFixture(workspace),service=createLocalAi(workspace);
 const originals=new Map(readdirSync(fixture.folder).map(file=>[file,sha(readFileSync(path.join(fixture.folder,file)))]));
 const result=await post(service.app,`/jobs/${fixture.id}/correct`,fixture.plan);
 expect(result.status).toBe(201);
 expect(result.body.id).not.toBe(fixture.id);
 expect(result.body.report).toMatchObject({frames:5,rawChangedOutside:0,review:'human-reviewed-masks',semanticContinuity:'unverified'});
 expect(result.body.report.objects.map((object:any)=>object.visibleFrames)).toEqual([4,5]);
 expect(result.body.report.encodedOutsideMeanError).toBeGreaterThan(0);
 const output=path.join(workspace,'.artifacts/local-ai/ui-jobs',result.body.id);
 for(const frame of fixture.manifest.frames) {
  const file=`frame-${String(frame.index).padStart(3,'0')}.png`;
  const before=new Uint8ClampedArray(await sharp(path.join(fixture.folder,file)).ensureAlpha().raw().toBuffer());
  const after=new Uint8ClampedArray(await sharp(path.join(output,file)).ensureAlpha().raw().toBuffer());
  const union=fixture.masks.cup[frame.index].map((value,i)=>value||fixture.masks.umbrella[frame.index][i]);
  expect(verifyMaskedPixelDiff(before,after,union).changedOutside).toBe(0);
  if(frame.index!==2)expect(detectMaskedColor(after,fixture.masks.cup[frame.index]).colorName).toBe('blue');
  expect(detectMaskedColor(after,fixture.masks.umbrella[frame.index]).colorName).toBe('white');
 }
 for(const [file,hash] of originals) expect(sha(readFileSync(path.join(fixture.folder,file)))).toBe(hash);
 const clip=await request(service.app).get(`/jobs/${result.body.id}/assets/generated-video.mp4`).set('Host','127.0.0.1');
 expect(clip.status).toBe(200);expect(clip.headers['content-type']).toContain('video/mp4');
 const jobs=await request(service.app).get('/jobs').set('Host','127.0.0.1');
 const corrected=jobs.body.find((job:LocalJob)=>job.id===result.body.id);
 const reportUrl=localMeasurementsAsset(corrected).replace('/api/local-ai','');
 const reportResponse=await request(service.app).get(reportUrl).set('Host','127.0.0.1');
 expect(reportResponse.status).toBe(200);
 expect(reportResponse.body).toMatchObject({rawChangedOutside:0,semanticContinuity:'unverified',frames:5});
},20000);

it('rejects unreviewed, stale, missing and overlapping masks before creating output',async()=>{
 const workspace=root(),fixture=await videoFixture(workspace),service=createLocalAi(workspace);
 const variants=[
  (plan:any)=>{plan.tracks[0].frames[1].reviewed=false;},
  (plan:any)=>{plan.fingerprint='stale';},
  (plan:any)=>{plan.tracks[0].frames.pop();},
  (plan:any)=>{plan.tracks[1].frames[0].maskBase64=plan.tracks[0].frames[0].maskBase64;},
  (plan:any)=>{plan.tracks[0].frames[0].sourceHash='other-frame';},
  (plan:any)=>{plan.tracks[0].color='__proto__';},
 ];
 for(const change of variants) {
  const plan=structuredClone(fixture.plan);change(plan);
  expect(()=>validateVideoPlan(fixture.manifest,plan)).toThrow();
  expect((await post(service.app,`/jobs/${fixture.id}/correct`,plan)).status).toBe(422);
 }
 expect(readdirSync(path.dirname(fixture.folder))).toEqual([fixture.id]);
},20000);

const vision=process.env.ANCHORSHOT_TRACKING_PYTHON||path.join(process.env.LOCALAPPDATA||'','AnchorShot/vision/Scripts/python.exe');
it.skipIf(!existsSync(vision))('actual optical flow follows translation, retains reviewed occlusion seeds, and requires review of proposals',async()=>{
 const fixture=await videoFixture(root());
 const track=structuredClone(fixture.plan.tracks[0]);
 track.frames=track.frames.filter(frame=>[0,2,3].includes(frame.frameIndex));
 const output=JSON.parse((await runVision(vision,[path.resolve('scripts/track_video_masks.py'),fixture.folder],undefined,1024*1024,JSON.stringify({manifest:fixture.manifest,track}))).toString());
 expect(output.frames).toHaveLength(5);
 expect(output.frames[2]).toMatchObject({absent:true,reviewed:true,method:'manual'});
 for(const index of [1,4]) {
  const mask=Buffer.from(output.frames[index].maskBase64,'base64'),truth=fixture.masks.cup[index];
  let intersection=0,union=0;
  for(let p=0;p<mask.length;p++){if(mask[p]&&truth[p])intersection++;if(mask[p]||truth[p])union++;}
  expect(intersection/union).toBeGreaterThan(.75);
  expect(output.frames[index]).toMatchObject({reviewed:false,method:'optical-flow',sourceHash:fixture.manifest.frames[index].sourceHash});
 }
},20000);


it('routes a cup command through reviewed correction without changing the umbrella or source plan',async()=>{
 const workspace=root(),fixture=await videoFixture(workspace),service=createLocalAi(workspace);
 const saved=structuredClone(fixture.plan),routes:string[]=[];
 vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{
  const route=url.replace('/api/local-ai','');routes.push(route);
  const response=init?.method==='POST'
   ? await post(service.app,route,JSON.parse(init.body as string))
   : await request(service.app).get(route).set('Host','127.0.0.1');
  return new Response(JSON.stringify(response.body),{status:response.status,headers:{'Content-Type':'application/json'}});
 });
 try{
  const result=await correctReviewedVideoObject(fixture.id,fixture.plan,'mug','purple',new AbortController().signal);
  expect(result.id).not.toBe(fixture.id);
  expect(routes).toEqual([`/jobs/${fixture.id}/frames`,`/jobs/${fixture.id}/correct`]);
  expect(fixture.plan).toEqual(saved);
  const output=path.join(workspace,'.artifacts/local-ai/ui-jobs',result.id);
  for(const frame of fixture.manifest.frames){
   const file=`frame-${String(frame.index).padStart(3,'0')}.png`;
   const before=new Uint8ClampedArray(await sharp(path.join(fixture.folder,file)).ensureAlpha().raw().toBuffer());
   const after=new Uint8ClampedArray(await sharp(path.join(output,file)).ensureAlpha().raw().toBuffer());
   expect(verifyMaskedPixelDiff(before,after,fixture.masks.cup[frame.index]).changedOutside).toBe(0);
   if(frame.index!==2)expect(detectMaskedColor(after,fixture.masks.cup[frame.index]).colorName).toBe('purple');
  }
 }finally{vi.unstubAllGlobals();}
},20000);

it('blocks unsupported, stale and unapproved video commands without posting correction',async()=>{
 const fixture=await videoFixture(root());
 const fetchMock=vi.fn(async(_url:string,_init?:RequestInit)=>new Response(JSON.stringify(fixture.manifest),{headers:{'Content-Type':'application/json'}}));
 vi.stubGlobal('fetch',fetchMock);
 try{
  const signal=new AbortController().signal;
  await expect(correctReviewedVideoObject(fixture.id,fixture.plan,'car','blue',signal)).rejects.toThrow('cup and umbrella');
  await expect(correctReviewedVideoObject(fixture.id,fixture.plan,'cup','__proto__',signal)).rejects.toThrow('Choose blue');
  await expect(correctReviewedVideoObject(fixture.id,undefined,'cup','blue',signal)).rejects.toThrow('approve');
  expect(fetchMock).not.toHaveBeenCalled();
  for(const mutate of [(p:typeof fixture.plan)=>{p.fingerprint='stale';},(p:typeof fixture.plan)=>{p.tracks[0].frames[1].reviewed=false;}]){
   const plan=structuredClone(fixture.plan);mutate(plan);
   await expect(correctReviewedVideoObject(fixture.id,plan,'cup','blue',signal)).rejects.toThrow();
  }
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.every(call=>call.length===2 && !(call[1] as RequestInit)?.method)).toBe(true);
 }finally{vi.unstubAllGlobals();}
},20000);
