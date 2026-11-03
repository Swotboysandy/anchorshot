import {encodeArchive} from '../src/services/archiveCodec';
import {it,expect,vi,beforeEach} from 'vitest';
const dependencies=vi.hoisted(()=>({request:vi.fn(),insert:vi.fn(),flush:vi.fn(),begin:vi.fn(),finish:vi.fn(),load:vi.fn()}));
vi.mock('../src/services/localGeneration',()=>({localRequest:dependencies.request}));
vi.mock('../src/services/projectStorage',async(importOriginal)=>({...await importOriginal<typeof import('../src/services/projectStorage')>(),insertRestoredProject:dependencies.insert,flushLocalSaves:dependencies.flush,beginRestoreOperation:dependencies.begin,finishRestoreOperation:dependencies.finish,loadLocal:dependencies.load}));
import {restoreProjectArchive,serializeProjectArchive,type ProjectArchive} from '../src/services/projectArchive';
const oldId='11111111-1111-4111-8111-111111111111',newId='22222222-2222-4222-8222-222222222222';
const source=`/api/local-ai/jobs/${oldId}/assets/generated-image.png`;
const archive:ProjectArchive={format:'anchorshot-project',version:1,images:{},media:[{version:1,sourceJobId:oldId,kind:'image',prompt:'Cup',seed:1,files:[{name:'generated-image.png',sha256:'hash',base64:'AQID'}]}],project:{projectId:'old',title:'Cup',transcript:'Cup',isRecording:false,isPlayingAnimatic:false,isProcessing:false,statusAnnouncement:'',activeShotId:'1',rules:[],shots:[{id:'1',shotNumber:1,durationSeconds:4,status:'uncertain',promptDescription:'Cup',spokenDescription:'Cup',currentImageUrl:source,originalImageUrl:source,revisions:[]}]}};
beforeEach(()=>{vi.resetAllMocks();dependencies.begin.mockResolvedValue({operation:{version:1,operationId:'transaction',projectId:'33333333-3333-4333-8333-333333333333'}});dependencies.finish.mockResolvedValue(undefined);dependencies.flush.mockResolvedValue(undefined);dependencies.insert.mockImplementation(async(project)=>({active:project.projectId,projects:[project]}));dependencies.request.mockImplementation(async(route)=>route==='/imports'?{items:[{sourceJobId:oldId,job:{id:newId}}],importToken:'transaction'}:{});});
it('rolls back new media if the atomic project write fails',async()=>{
 dependencies.insert.mockRejectedValue(new DOMException('Full','QuotaExceededError'));
 await expect(restoreProjectArchive(serializeProjectArchive(archive))).rejects.toThrow('Full');
 expect(dependencies.request).toHaveBeenLastCalledWith('/imports/transaction/rollback',{});
 expect(dependencies.request.mock.calls.some(([route])=>route.endsWith('/commit'))).toBe(false);
});
it('preserves successfully saved media when finalization cannot be confirmed',async()=>{
 dependencies.request.mockImplementation(async(route)=>{if(route.endsWith('/commit'))throw new Error('Disconnected');return {items:[{sourceJobId:oldId,job:{id:newId}}],importToken:'transaction'};});
 const result=await restoreProjectArchive(serializeProjectArchive(archive));
 expect(result.warning).toContain('Project was saved');
 expect(result.project.projectId).not.toBe('old');
 expect(result.project.shots[0].currentImageUrl).toContain(newId);
 expect(dependencies.request.mock.calls.some(([route])=>route.endsWith('/rollback'))).toBe(false);
});
it('does not import anything when current saves have failed',async()=>{
 dependencies.flush.mockRejectedValue(new Error('Conflicting edits'));
 await expect(restoreProjectArchive(serializeProjectArchive(archive))).rejects.toThrow('Conflicting edits');
 expect(dependencies.request).not.toHaveBeenCalled();
 expect(dependencies.insert).not.toHaveBeenCalled();
});


it('retries a lost import response with the same operation and publishes the project once',async()=>{
 let attempts=0;
 dependencies.request.mockImplementation(async(route)=>{
  if(route==='/imports'){
   if(++attempts===1)throw new TypeError('Network response lost');
   return {items:[{sourceJobId:oldId,job:{id:newId}}],importToken:'transaction'};
  }
  return {};
 });
 const restored=await restoreProjectArchive(serializeProjectArchive(archive));
 const calls=dependencies.request.mock.calls.filter(([route])=>route==='/imports');
 expect(calls).toHaveLength(2);expect(calls[0][1].operationId).toBe('transaction');
 expect(calls[1][1]).toEqual(calls[0][1]);expect(dependencies.insert).toHaveBeenCalledTimes(1);
 expect(restored.project.shots[0].currentImageUrl).toContain(newId);
});

it('rejects unrenderable dream masks before reserving a restore or importing media',async()=>{
 const broken=structuredClone(archive);broken.dream={selection:{name:'Cup',revision:1,photo:{width:4,height:4,data:new Uint8ClampedArray(64).fill(255)},mask:new Uint8Array(16)},umbrella:null};
 await expect(restoreProjectArchive(encodeArchive(broken))).rejects.toThrow('Saved masks');
 for(const fn of Object.values(dependencies))expect(fn).not.toHaveBeenCalled();
});
