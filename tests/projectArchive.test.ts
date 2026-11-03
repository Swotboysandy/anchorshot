import {metaModelClient} from '../src/services/metaModels';
import {createHash} from 'node:crypto';
import {expect, it, vi, afterEach} from 'vitest';
import {collectProjectArchive, parseProjectArchive, prepareRestoredProject, serializeProjectArchive, type ProjectArchive} from '../src/services/projectArchive';
const oldId = '11111111-1111-4111-8111-111111111111';
const newId = '22222222-2222-4222-8222-222222222222';
const image = 'data:image/png;base64,AQID';
const source = `/api/local-ai/jobs/${oldId}/assets/`;
function fixture(): ProjectArchive {
 const plan = {sourceJobId:oldId, fingerprint:'old-fingerprint', tracks:[{objectId:'cup' as const,color:'blue' as const,frames:[0,1].map(frameIndex=>({frameIndex, sourceHash:`hash-${frameIndex}`, maskBase64:'AQA=', revision:1, reviewed:true, absent:false, method:'manual' as const}))}]};
 return {format:'anchorshot-project',version:1, images:{'/api/muse/frames/prior.png':image},
  media:[{version:1,sourceJobId:oldId,kind:'video',prompt:'Keep the cup',seed:42,files:['frame-000.png','generated-video.mp4'].map(name=>({name,sha256:'hash',base64:'AQID'}))}],
  dream:{selection:{name:'Cup',revision:1,photo:{width:4,height:4,data:new Uint8ClampedArray(64).fill(255)},mask:new Uint8Array(16).fill(1)},umbrella:null},
  project:{projectId:'original',title:'Ocean',transcript:source+'not-a-media-reference',statusAnnouncement:'',isRecording:false,isProcessing:false,isPlayingAnimatic:false,activeShotId:'shot',rules:[],shots:[{
   id:'shot',shotNumber:1,promptDescription:source+'frame-000.png',spokenDescription:'A cup',durationSeconds:4,status:'consistent',
   originalImageUrl:'/api/muse/frames/prior.png',currentImageUrl:source+'frame-000.png?rev=1',videoUrl:source+'generated-video.mp4',generatedJobId:oldId,videoMaskPlan:plan,
   revisions:[{revisionId:'take',timestamp:1,actionApplied:'Original',imageUrl:source+'frame-000.png',videoUrl:source+'generated-video.mp4',generatedJobId:oldId,videoMaskPlan:structuredClone(plan)}]
  }]}};
}
const mapping = () => [{sourceJobId:oldId,job:{id:newId},manifest:{jobId:newId,fingerprint:'new-fingerprint',fps:2,frames:[0,1].map(index=>({index,sourceHash:`hash-${index}`,url:'frame',width:2,height:1}))}}];
it('roundtrips project masks and remaps current and historical video sources without altering story text or originals',()=>{
 const original=fixture();
 const before=serializeProjectArchive(original);
 const archive=parseProjectArchive(before);
 const result=prepareRestoredProject(archive,mapping(),'restored');
 const shot=result.project.shots[0];
 expect(shot.currentImageUrl).toBe(`/api/local-ai/jobs/${newId}/assets/frame-000.png`);
 expect(shot.originalImageUrl).toBe(image);
 expect(shot.generatedJobId).toBe(newId);
 expect(shot.videoMaskPlan?.sourceJobId).toBe(newId);
 expect(shot.videoMaskPlan?.fingerprint).toBe('new-fingerprint');
 expect(shot.revisions[0].videoMaskPlan).toEqual(shot.videoMaskPlan);
 expect(shot.revisions[0].videoUrl).toContain(newId);
 expect(shot.status).toBe('uncertain');
 expect(shot.promptDescription).toBe(original.project.shots[0].promptDescription);
 expect(result.project.transcript).toBe(original.project.transcript);
 expect(result.dream).toEqual(original.dream);
 expect(serializeProjectArchive(original)).toBe(before);
 expect(serializeProjectArchive(archive)).toBe(before);
});
it('rejects incomplete backups, old-project replacement and missing or changed imported frames',()=>{
 const absent=fixture();absent.media=[];
 expect(()=>serializeProjectArchive(absent)).toThrow('missing');
 const missingImage=fixture();missingImage.images={};
 expect(()=>serializeProjectArchive(missingImage)).toThrow('embedded');
 expect(()=>prepareRestoredProject(fixture(),mapping(),'original')).toThrow('new project ID');
 expect(()=>prepareRestoredProject(fixture(),[],'new')).toThrow('mapping');
 const changed=mapping();changed[0].manifest.frames[1].sourceHash='different';
 expect(()=>prepareRestoredProject(fixture(),changed,'new')).toThrow('different source frame');
 const resized=mapping();resized[0].manifest.frames[0].width=3;
 expect(()=>prepareRestoredProject(fixture(),resized,'new')).toThrow();
 const bad=fixture();(bad.dream as any).selection.mask=Uint8Array.of(2,0);
 expect(()=>serializeProjectArchive(bad)).toThrow('masks');
});


afterEach(()=>vi.unstubAllGlobals());
it('collects each referenced job once, embeds server images and keeps a frozen snapshot',async()=>{
 const source=fixture();
 const frame='/api/muse/frames/'+createHash('sha256').update(Uint8Array.of(1,2,3)).digest('hex')+'.png';
 source.project.shots[0].originalImageUrl=frame;
 const fetcher=vi.fn(async(input: string)=>{
  if(input.endsWith('/archive')) {
   source.project.title='Edited while backing up';
   return new Response(JSON.stringify(source.media[0]),{headers:{'Content-Type':'application/json'}});
  }
  if(input===frame)return new Response(Uint8Array.of(1,2,3),{headers:{'Content-Type':'image/png'}});
  throw new Error('Unexpected network request');
 });
 vi.stubGlobal('fetch',fetcher);
 const archive=await collectProjectArchive(source.project,source.dream);
 expect(archive.project.title).toBe('Ocean');
 expect(archive.images[frame]).toBe(image);
 expect(archive.media).toEqual(source.media);
 expect(fetcher).toHaveBeenCalledTimes(2);
 expect(parseProjectArchive(serializeProjectArchive(archive)).dream).toEqual(source.dream);
});
it('rejects remote references without fetching and fails closed on missing local media or cancellation',async()=>{
 const source=fixture();
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 source.project.shots[0].originalImageUrl='https://example.com/private.png';
 await expect(collectProjectArchive(source.project,source.dream)).rejects.toThrow('unsupported');
 expect(fetcher).not.toHaveBeenCalled();
 source.project.shots[0].originalImageUrl=image;
 fetcher.mockResolvedValue(new Response(JSON.stringify({error:'Media gone'}),{status:404,headers:{'Content-Type':'application/json'}}));
 await expect(collectProjectArchive(source.project,source.dream)).rejects.toThrow('Media gone');
 fetcher.mockClear();
 const controller=new AbortController();controller.abort();
 await expect(collectProjectArchive(source.project,source.dream,controller.signal)).rejects.toThrow();
 expect(fetcher).not.toHaveBeenCalled();
});

it('rejects a generated image whose content no longer matches its stored identity',async()=>{
 const source=fixture();source.project.shots[0].originalImageUrl='/api/muse/frames/'+'a'.repeat(64)+'.png';
 vi.stubGlobal('fetch',vi.fn(async(input:string)=>input.endsWith('/archive')
  ?new Response(JSON.stringify(source.media[0]),{headers:{'Content-Type':'application/json'}})
  :new Response(Uint8Array.of(1,2,3),{headers:{'Content-Type':'image/png'}})));
 await expect(collectProjectArchive(source.project,source.dream)).rejects.toThrow('content hash');
});

it('restored live candidates retain their rasters but never reuse an expired server mask reference',async()=>{
 const archive=fixture(),shot=archive.project.shots[0];
 const mask={id:'old-id',maskRef:'server:cup:1',objectId:'cup-one',maskBase64:'first-raster',box:{x:0,y:0,width:10,height:10},confidence:.9,provenance:'live-sam-3.1' as const,sourceImageUrl:shot.currentImageUrl};
 const other={...mask,maskRef:'server:cup:2',objectId:'cup-two',maskBase64:'second-raster'};
 shot.proposedFix={action:'recolor',targetObject:'cup',targetColor:'blue',mask,candidates:[mask,other]};
 const restored=prepareRestoredProject(archive,mapping(),'restored').project.shots[0];
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 const previous=(metaModelClient as any).sessionToken;(metaModelClient as any).sessionToken='test-session';
 try {
  const selected=await metaModelClient.disambiguateMaskSelection(restored,'cup-two');
  expect(fetcher).not.toHaveBeenCalled();
  expect(selected.proposedFix?.mask).toMatchObject({maskBase64:'second-raster',serverDetached:true,candidateCount:1,sourceImageUrl:restored.currentImageUrl});
  expect(selected.proposedFix?.mask?.maskRef).toMatch(/^restored:restored:/);
  expect(selected.proposedFix?.candidates?.[0].maskRef).toBe(restored.proposedFix?.mask?.maskRef);
  expect(selected.status).toBe('uncertain');
  const stale=structuredClone(restored);stale.currentImageUrl='another-frame';
  await expect(metaModelClient.disambiguateMaskSelection(stale,'cup-two')).rejects.toThrow('another frame');
  expect(fetcher).not.toHaveBeenCalled();
  expect(shot.proposedFix.mask?.maskRef).toBe('server:cup:1');
 }finally{(metaModelClient as any).sessionToken=previous;}
});
