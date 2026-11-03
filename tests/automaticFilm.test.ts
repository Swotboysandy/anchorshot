import {afterEach,describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import {MetaModelClient} from '../src/services/metaModels';
import {validateVideoProbe,videoFromSettings} from '../server/video';
import {createApp} from '../server/app';
afterEach(()=>vi.unstubAllGlobals());
describe('automatic prompt-to-video',()=>{
 it('fails before planning when video is unavailable, without any sample scene',async()=>{
  const fetch=vi.fn().mockResolvedValue(Response.json({videoReady:false,plannerLive:true}));vi.stubGlobal('fetch',fetch);
  await expect(new MetaModelClient().generateFilmFromTranscript('A snowy observatory')).rejects.toThrow('no cup demo');expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('assembles only videos generated from the planner subjects',async()=>{
  const fetch=vi.fn(async(url:string,options?:RequestInit)=>{
   if(url==='/api/health')return Response.json({videoReady:true,plannerLive:true,sessionToken:'fixture'});
   if(url==='/api/muse/spark')return Response.json({provenance:'live-model',rules:[],shots:[{subject:'A snowy observatory',seconds:4},{subject:'A floating market',seconds:4}]});
   const prompt=JSON.parse(String(options?.body)).prompt;expect(prompt).not.toMatch(/cup|umbrella|kitchen/i);
   return Response.json({id:'fixture-video',model:'fixture',fps:25,seconds:3.24,frames:81,imageUrl:'/api/local-ai/jobs/fixture/frame.png',videoUrl:'/api/local-ai/jobs/fixture/video.mp4'});
  });vi.stubGlobal('fetch',fetch);
  const progress=vi.fn();const result=await new MetaModelClient().generateFilmFromTranscript('Observatory then floating market',progress);
  expect(result.shots).toHaveLength(2);expect(result.shots.every(s=>s.mediaSource==='generated'&&s.videoUrl&&s.status==='uncertain'&&!s.proposedFix)).toBe(true);
  expect(result.shots[0].promptDescription).toBe('A snowy observatory');expect(result.shots[0].durationSeconds).toBe(3.24);expect(progress).toHaveBeenLastCalledWith('Your generated scenes are ready.',100);
 });
 it('rejects low-frame-rate video rather than showing it as 25 fps',()=>{
  const probe=(fps:string)=>({streams:[{codec_type:'video',avg_frame_rate:fps,duration:'3.24',nb_read_frames:'81'}]});
  expect(validateVideoProbe(probe('25/1')).fps).toBe(25);
  expect(()=>validateVideoProbe(probe('8/1'))).toThrow('25 fps');
  expect(()=>validateVideoProbe(probe('0/0'))).toThrow('25 fps');
 });
 it('does not infer video configuration from a planner key',()=>{
  expect(videoFromSettings({PLANNER_API_KEY:'fixture'},'.artifacts/test')).toBeUndefined();
  expect(()=>videoFromSettings({VIDEO_PROVIDER:'baseten',VIDEO_API_KEY:'fixture',VIDEO_BASE_URL:'https://unrelated.example/predict'},'.artifacts/test')).toThrow('dedicated Baseten');
 });
 it('requires a valid session and enforces the app request allowance',async()=>{
  const generate=vi.fn().mockResolvedValue({id:'fixture',fps:25});
  const app=createApp({settings:()=>({key:'',requestLimit:1}),video:{model:'fixture',generate}});
  expect((await request(app).post('/api/muse/video').send({prompt:'snow'})).status).toBe(403);
  const health=(await request(app).get('/api/health')).body;
  const post=()=>request(app).post('/api/muse/video').set('X-Anchorshot-Session',health.sessionToken).send({prompt:'snow'});
  expect((await post()).status).toBe(200);expect((await post()).status).toBe(429);expect(generate).toHaveBeenCalledTimes(1);
 });
});
