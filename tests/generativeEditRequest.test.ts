import {afterEach,expect,it,vi} from 'vitest';
import {MetaModelClient} from '../src/services/metaModels';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

it('rejects an already cancelled edit without sending a request',async()=>{
 const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
 const controller=new AbortController();controller.abort();
 await expect(new MetaModelClient().editFrameGenerative('image','edit','mask',undefined,controller.signal)).rejects.toMatchObject({name:'AbortError'});
 expect(fetchMock).not.toHaveBeenCalled();
});

for(const reason of ['caller','timeout'] as const)it(`settles a stalled edit when ${reason} cancels it`,async()=>{
 const caller=new AbortController(),deadline=new AbortController();
 const timeout=vi.spyOn(AbortSignal,'timeout').mockReturnValue(deadline.signal);
 let received:AbortSignal|undefined;
 vi.stubGlobal('fetch',vi.fn((_url:string,options:RequestInit)=>new Promise((_resolve,reject)=>{
  received=options.signal as AbortSignal;
  received.addEventListener('abort',()=>reject(received!.reason),{once:true});
 })));
 const pending=new MetaModelClient().editFrameGenerative('image','edit','mask',undefined,caller.signal);
 const assertion=expect(pending).rejects.toMatchObject({name:reason==='timeout'?'TimeoutError':'AbortError'});
 expect(timeout).toHaveBeenCalledWith(120000);
 if(reason==='timeout')deadline.abort(new DOMException('Edit timed out','TimeoutError'));else caller.abort();
 await assertion;expect(received?.aborted).toBe(true);
});

it('reports server failure and permits a subsequent successful request',async()=>{
 const result={editedImageUrl:'data:image/png;base64,edited',changedInside:16,outsideDrift:0,verified:true};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({error:'No image model is connected.'}),{status:501})).mockResolvedValueOnce(new Response(JSON.stringify(result))));
 const client=new MetaModelClient();
 await expect(client.editFrameGenerative('image','edit','mask')).rejects.toThrow('No image model is connected.');
 await expect(client.editFrameGenerative('image','edit','mask')).resolves.toEqual(result);
});


it('video review binds caller cancellation to a 30-second request deadline',async()=>{
 const caller=new AbortController(),deadline=new AbortController();
 const timeout=vi.spyOn(AbortSignal,'timeout').mockReturnValue(deadline.signal);
 vi.stubGlobal('fetch',vi.fn((_url:string,options:RequestInit)=>new Promise((_resolve,reject)=>{
  const signal=options.signal as AbortSignal;
  signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
 })));
 const pending=new MetaModelClient().understandVideoWithMuseSpark('video','prompt','job',[],1,caller.signal);
 const assertion=expect(pending).rejects.toMatchObject({name:'TimeoutError'});
 expect(timeout).toHaveBeenCalledWith(30000);
 deadline.abort(new DOMException('Review timed out','TimeoutError'));
 await assertion;
});
