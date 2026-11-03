import {assertVideoPlanSource} from '../src/services/videoTracking';
import {validateProjectLibrary} from '../src/services/projectStorage';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CupMaskEditor} from '../src/components/CupMaskEditor';
import {expect,it,vi,afterEach} from 'vitest';
import {emptyVideoTrack,reviewVideoFrame,videoReviewProblem,encodeVideoMask,decodeVideoMask,loadVideoFrame,getVideoManifest} from '../src/services/videoTracking';
import type {VideoManifest} from '../src/types/videoTracks';
const manifest:VideoManifest={jobId:'test',fingerprint:'source',fps:8,frames:[0,1].map(index=>({index,width:8,height:8,sourceHash:'hash'+index,url:`/api/local-ai/jobs/test/assets/frame-${String(index).padStart(3,'0')}.png`}))};
afterEach(()=>vi.unstubAllGlobals());
it('requires separate reviewed masks for every frame and rejects stale sources and overlap',()=>{
 const cupMask=new Uint8Array(64);cupMask.fill(1,0,16);
 const umbrellaMask=new Uint8Array(64);umbrellaMask.fill(1,32,48);
 let cup=emptyVideoTrack(manifest,'cup'),umbrella=emptyVideoTrack(manifest,'umbrella');
 const plan=()=>({sourceJobId:'test',fingerprint:'source',tracks:[cup,umbrella]});
 expect(videoReviewProblem(manifest,plan())).toContain('Review cup');
 cup=reviewVideoFrame(manifest,cup,0,cupMask);
 cup=reviewVideoFrame(manifest,cup,1,new Uint8Array(64),true);
 umbrella=reviewVideoFrame(manifest,umbrella,0,umbrellaMask);
 umbrella=reviewVideoFrame(manifest,umbrella,1,umbrellaMask);
 expect(videoReviewProblem(manifest,plan())).toBeNull();
 expect(videoReviewProblem({...manifest,fingerprint:'replaced'},plan())).toContain('video changed');
 umbrella=reviewVideoFrame(manifest,umbrella,0,cupMask);
 expect(videoReviewProblem(manifest,plan())).toContain('overlap');
 expect(cup.frames[0].revision).toBe(2);
 expect(cup.frames[1].absent).toBe(true);
});
it('round trips full-sized binary masks without argument overflow and rejects malformed data',()=>{
 const mask=new Uint8Array(1024*1024);mask.fill(1,500,1024);
 const decoded=decodeVideoMask(encodeVideoMask(mask),mask.length);
 expect(decoded.length).toBe(mask.length);
 expect(decoded.every((value,index)=>value===mask[index])).toBe(true);
 expect(()=>encodeVideoMask(Uint8Array.of(2))).toThrow();
 expect(()=>decodeVideoMask('AA==',64)).toThrow();
 expect(()=>reviewVideoFrame(manifest,emptyVideoTrack(manifest,'cup'),0,new Uint8Array(64))).toThrow();
});
it('rejects changed frame bytes before decoding or opening a bitmap',async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(new Blob(['changed']),{status:200}));
 const bitmap=vi.fn();vi.stubGlobal('fetch',fetcher);vi.stubGlobal('createImageBitmap',bitmap);
 await expect(loadVideoFrame(manifest,0,new AbortController().signal)).rejects.toThrow('source frame changed');
 expect(bitmap).not.toHaveBeenCalled();
});
it('cancels an in-flight manifest request when leaving the video',async()=>{
 vi.stubGlobal('fetch',vi.fn((_url,options)=>new Promise((_resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});})));
 const controller=new AbortController(),pending=getVideoManifest('test',controller.signal);
 controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});
});

it('fixed video frames expose real mask tools without replacing the source or synthetic cutouts',()=>{
 const html=renderToStaticMarkup(createElement(CupMaskEditor,{fixedFrame:true,objectKind:'cup',initial:{photo:{width:8,height:8,data:new Uint8ClampedArray(256)},mask:new Uint8Array(64),name:'Frame 1',revision:1},onApply:()=>{},onCancel:()=>{}}));
 expect(html).toContain('Approve cup in this frame');
 expect(html).toContain('Erase brush');
 expect(html).not.toContain('Upload cup photo');
 expect(html).not.toContain('Preview cutout (offline)');
 expect(html).not.toContain('Apply cup to dream');
});

it('rejects corrupt binary masks before library restoration and mismatched dimensions before display',()=>{
 const plan={sourceJobId:'test',fingerprint:'source',tracks:[emptyVideoTrack(manifest,'cup')]};
 const library:any={active:'p',projects:[{projectId:'p',title:'Test',transcript:'',statusAnnouncement:'',activeShotId:'s',rules:[],shots:[{id:'s',promptDescription:'',spokenDescription:'',currentImageUrl:'',originalImageUrl:'',durationSeconds:1,shotNumber:1,status:'uncertain',revisions:[],generatedJobId:'test',videoMaskPlan:plan}]}]};
 expect(()=>validateProjectLibrary(library)).not.toThrow();
 for(const raster of ['====','Ag==','A===','AAAA====']){
  plan.tracks[0].frames[0].maskBase64=raster;
  expect(()=>validateProjectLibrary(library)).toThrow('damaged');
 }
 plan.tracks[0]=emptyVideoTrack(manifest,'cup');
 plan.tracks[0].frames[0].maskBase64='AA==';
 expect(()=>assertVideoPlanSource(manifest,plan)).toThrow('dimensions');
 plan.tracks[0]=emptyVideoTrack(manifest,'cup');
 plan.tracks[0].frames[1].sourceHash='other';
 expect(()=>assertVideoPlanSource(manifest,plan)).toThrow('different source frame');
});
