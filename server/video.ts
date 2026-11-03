import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile);
export interface GeneratedVideo {id:string; imageUrl:string; videoUrl:string; seconds:number; fps:number; frames:number; model:string}
export interface VideoProvider {model:string; shots?:number; generate(prompt:string, signal:AbortSignal, start?:{image:Buffer;seed:number}):Promise<GeneratedVideo>}
export function validateVideoProbe(probe:any) {
  const stream=probe.streams?.find((s:any)=>s.codec_type==='video');
  const parts=String(stream?.avg_frame_rate).split('/').map(Number);
  const fps=parts.length===2?parts[0]/parts[1]:parts[0];
  const seconds=Number(stream?.duration??probe.format?.duration),frames=Number(stream?.nb_read_frames);
  if(!stream || !Number.isFinite(fps) || Math.abs(fps-25)>0.001 || !Number.isFinite(seconds) || seconds<0.5 || seconds>15 || !Number.isInteger(frames) || frames<13)
    throw new Error('The video provider did not return a valid 25 fps clip (0.5–15 seconds). No sample or duplicated-frame fallback was used.');
  return {fps,seconds,frames};
}
/** Disabled until a video deployment and a bounded test window are explicitly configured. */
export function videoFromSettings(values:Record<string,string|undefined>, folder:string):VideoProvider|undefined {
  const pick=(name:string)=>(process.env[name]??values[name]??'').trim();
  if(pick('VIDEO_PROVIDER')==='modal')return modalVideo(pick('MODAL_VIDEO_ENDPOINT'),pick('MODAL_VIDEO_KEY'),folder,pick('VIDEO_MODEL')||'Modal video',Number(pick('FILM_SHOTS'))||4,Number(pick('CLIP_FRAMES'))||97);
  if(pick('VIDEO_PROVIDER')!=='baseten')return;
  const endpoint=pick('VIDEO_BASE_URL'),key=pick('VIDEO_API_KEY')||pick('BASETEN_API_KEY');
  if(!endpoint||!key)return;
  const url=new URL(endpoint);
  if(url.protocol!=='https:'||!/^model-[a-z0-9]+\.api\.baseten\.co$/.test(url.hostname)||url.username||url.password||url.search||!/^\/(production|deployment\/[a-z0-9]+)\/predict$/.test(url.pathname))
    throw new Error('Configure a dedicated Baseten video prediction endpoint.');
  const model=pick('VIDEO_MODEL')||'Baseten video';
  return {model,async generate(prompt,signal) {
    const deadline=Date.parse(pick('VIDEO_TEST_EXPIRES_AT'));
    if(!Number.isFinite(deadline)||Date.now()>=deadline)throw new Error('The video test window is not enabled or has expired. No paid request sent.');
    mkdirSync(folder,{recursive:true});
    const ledger=join(folder,'baseten-test-attempts.json');
    const attempts=existsSync(ledger)?JSON.parse(readFileSync(ledger,'utf8')):[];
    if(!Array.isArray(attempts)||attempts.length>=3)throw new Error('The three-clip test allowance is exhausted. No further paid video request sent.');
    attempts.push({at:new Date().toISOString(),model});writeFileSync(ledger,JSON.stringify(attempts));
    const id=randomUUID(),destination=join(folder,id);mkdirSync(destination,{recursive:true});
    const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{Authorization:`Api-Key ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({prompt,size:'832x480',sampling_steps:30,guide_scale:[3,4],seed:42,fps:25}),signal:AbortSignal.any([signal,AbortSignal.timeout(300000)])});
    if(!response.ok)throw new Error(`Baseten video request failed (${response.status}). No automatic retry was sent.`);
    const reader=response.body?.getReader();if(!reader)throw new Error('Empty video response.');
    const chunks:Uint8Array[]=[];let length=0;
    for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>90*1024*1024){await reader.cancel();throw new Error('Video response exceeds 90 MB.');}chunks.push(value);}
    const data=JSON.parse(Buffer.concat(chunks).toString());
    if(typeof data.video!=='string'||!data.video.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(data.video))throw new Error('Baseten returned no valid base64 video.');
    return saveClip(Buffer.from(data.video,'base64'),destination,id,prompt,model,'baseten',signal);
  }};
}
/** Checks a returned clip really is 25 fps, then stores it with the project's media. */
async function saveClip(bytes:Buffer,destination:string,id:string,prompt:string,model:string,provider:string,signal:AbortSignal):Promise<GeneratedVideo> {
  const file=join(destination,'generated-video.mp4');writeFileSync(file,bytes);
  const {stdout}=await exec('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',file],{signal,timeout:30000,windowsHide:true});
  const metadata=validateVideoProbe(JSON.parse(stdout));
  await exec('ffmpeg',['-v','error','-xerror','-i',file,'-f','null','-'],{signal,timeout:30000,windowsHide:true});
  await exec('ffmpeg',['-v','error','-i',file,'-frames:v','1',join(destination,'frame-000.png')],{signal,timeout:30000,windowsHide:true});
  const report={...metadata,model,provider,status:'technical_pass',continuity:'unreviewed'};
  writeFileSync(join(destination,'inference-report.json'),JSON.stringify(report));
  writeFileSync(join(destination,'job.json'),JSON.stringify({id,kind:'video',status:'completed',prompt,seed:42,createdAt:new Date().toISOString(),message:`Generated on ${provider}; continuity unreviewed.`,report}));
  return {id,model,...metadata,imageUrl:`/api/local-ai/jobs/${id}/assets/frame-000.png`,videoUrl:`/api/local-ai/jobs/${id}/assets/generated-video.mp4`};
}
/** VIDEO_PROVIDER=modal: scripts/modal_wan.py, bounded by the session request limit. */
function modalVideo(endpoint:string,key:string,folder:string,model:string,shots:number,frames:number):VideoProvider|undefined {
  if(!endpoint||!key)return;
  const url=new URL(endpoint);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.modal.run')||url.username||url.password||url.search)throw new Error('Configure a dedicated Modal video endpoint.');
  return {model,shots,async generate(prompt,signal,start) {
    const id=randomUUID(),destination=join(folder,id);mkdirSync(destination,{recursive:true});
    // A cold start downloads and loads the model before the first clip.
    // Modal answers requests over 150 seconds with a redirect to the result on the same host.
    const response=await fetch(new URL('/generate',url),{method:'POST',redirect:'follow',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({prompt,image:start?.image.toString('base64'),seed:start?.seed,num_frames:frames}),signal:AbortSignal.any([signal,AbortSignal.timeout(900000)])});
    if(new URL(response.url).hostname!==url.hostname)throw new Error('The video endpoint redirected to another host.');
    if(!response.ok)throw new Error(`Modal video request failed (${response.status}). No automatic retry was sent.`);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length>90*1024*1024)throw new Error('Video response exceeds 90 MB.');
    return saveClip(bytes,destination,id,prompt,model,'modal',signal);
  }};
}
