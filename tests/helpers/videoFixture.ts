import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {runVision,readVideoManifest} from '../../server/videoTracks';
import type {VideoTrackPlan} from '../../src/types/videoTracks';
export async function videoFixture(root:string) {
 const id=randomUUID(),folder=path.join(root,'.artifacts/local-ai/ui-jobs',id);
 mkdirSync(folder,{recursive:true});
 const width=128,height=96,count=5;
 const masks:{cup:Uint8Array[];umbrella:Uint8Array[]}={cup:[],umbrella:[]};
 for(let index=0;index<count;index++) {
  const rgba=new Uint8ClampedArray(width*height*4),cup=new Uint8Array(width*height),umbrella=new Uint8Array(width*height);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
   const i=y*width+x,t=i*4,noise=(x*13+y*7)%11;
   rgba.set([35+noise,45+noise,60+noise,255],t);
   const cx=18+index*5;
   if(index!==2 && x>=cx && x<cx+24 && y>=54 && y<80 && !(x>=cx+16&&x<cx+21&&y>=60&&y<65)) {
    cup[i]=1;rgba.set(index>=3?[175+noise,175+noise,175+noise,255]:[190+noise,35+noise,30+noise,255],t);
   }
   const ux=92-index*2;
   if((y>=16&&y<33&&Math.abs(x-ux)<(y-15)*1.2)||(y>=33&&y<54&&Math.abs(x-ux)<2)) {
    umbrella[i]=1;rgba.set([210+noise,140+noise,18+noise,255],t);
   }
  }
  masks.cup.push(cup);masks.umbrella.push(umbrella);
  await sharp(Buffer.from(rgba),{raw:{width,height,channels:4}}).png().toFile(path.join(folder,`frame-${String(index).padStart(3,'0')}.png`));
 }
 await runVision('ffmpeg',['-v','error','-y','-framerate','8','-i',path.join(folder,'frame-%03d.png'),'-c:v','libx264','-pix_fmt','yuv420p',path.join(folder,'generated-video.mp4')]);
 writeFileSync(path.join(folder,'job.json'),JSON.stringify({id,kind:'video',prompt:'A moving cup and umbrella. The cup disappears briefly and returns.',seed:42,status:'completed',message:'Synthetic moving fixture; not AI output',createdAt:new Date().toISOString()}));
 const manifest=await readVideoManifest(folder,id);
 const plan:VideoTrackPlan={sourceJobId:id,fingerprint:manifest.fingerprint,tracks:(['cup','umbrella'] as const).map(objectId=>({objectId,color:objectId==='cup'?'blue':'white',frames:manifest.frames.map(frame=>({frameIndex:frame.index,sourceHash:frame.sourceHash,maskBase64:Buffer.from(masks[objectId][frame.index]).toString('base64'),revision:1,absent:objectId==='cup'&&frame.index===2,reviewed:true,method:'manual'}))}))};
 return {id,folder,manifest,plan,masks,width,height};
}
export const sha=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
