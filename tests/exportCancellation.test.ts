import {it,expect,vi} from 'vitest';
import sharp from 'sharp';
import {createApp} from '../server/app';
import {runVision} from '../server/videoTracks';
import {renderAnimatic} from '../server/animatic';

it('terminates an actual stalled process at its deadline and on cancellation',async()=>{
 const start=Date.now();
 await expect(runVision(process.execPath,['-e','setInterval(()=>{},1000)'],undefined,1024,undefined,100)).rejects.toThrow('timed out');
 expect(Date.now()-start).toBeLessThan(3000);
 const controller=new AbortController();
 const running=runVision(process.execPath,['-e','setInterval(()=>{},1000)'],controller.signal);
 setTimeout(()=>controller.abort(),100);
 await expect(running).rejects.toThrow('cancelled');
});

it('aborting a browser export cancels the renderer and releases the export lock for the next request',async()=>{
 let aborted=false,started=false;
 const renderer=vi.fn(async(_shots:unknown,_ffmpeg:unknown,_ffprobe:unknown,options:any)=>{
  if(started)return Buffer.from('next export');started=true;
  return new Promise<Buffer>((_resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new Error('Aborted'));},{once:true}));
 });
 const app=createApp({settings:()=>({key:'',requestLimit:10}),ffmpegAvailable:async()=>true,renderAnimatic:renderer});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const address=server.address();if(!address||typeof address==='string')throw new Error('Missing test address');
 const origin=`http://127.0.0.1:${address.port}`;
 try{
  const health=await(await fetch(origin+'/api/health')).json();
  const image=await sharp({create:{width:2,height:2,channels:3,background:'#000'}}).png().toBuffer();
  const options={method:'POST',headers:{'Content-Type':'application/json','X-Anchorshot-Session':health.sessionToken},body:JSON.stringify({shots:[{image:`data:image/png;base64,${image.toString('base64')}`,seconds:1}]})};
  const controller=new AbortController();
  const first=fetch(origin+'/api/export/animatic',{...options,signal:controller.signal}).catch(error=>error);
  await vi.waitFor(()=>expect(started).toBe(true));controller.abort();await first;
  await vi.waitFor(()=>expect(aborted).toBe(true));
  const second=await fetch(origin+'/api/export/animatic',options);
  expect(second.status).toBe(200);expect(await second.text()).toBe('next export');
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it('a pre-cancelled export never attempts to read or encode media',async()=>{
 const controller=new AbortController();controller.abort();
 await expect(renderAnimatic([{image:Buffer.from('invalid'),seconds:1}],'nonexistent-encoder','nonexistent-probe',{signal:controller.signal})).rejects.toThrow();
});
