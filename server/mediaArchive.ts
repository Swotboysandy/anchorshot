import sharp from 'sharp';
import {readVideoManifest} from './videoTracks';
import {lstatSync,readFileSync,readdirSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {LocalMediaArchive} from '../src/types/mediaArchive';
const allowed=new Set(['generated-image.png','generated-video.mp4','contact-sheet.png','inference-report.json','modification-report.json','reviewed-tracks.json']);
export function archiveLocalMedia(folder:string,job:{id:string;kind:'image'|'video';prompt:string;seed:number;status:string}):LocalMediaArchive {
 if(job.status!=='completed'||!['image','video'].includes(job.kind))throw new Error('Only completed local media can be backed up.');
 const names=readdirSync(folder).filter(name=>allowed.has(name)||/^frame-\d{3}\.png$/.test(name)).sort();
 const primary=job.kind==='video'?'generated-video.mp4':'generated-image.png';
 if(!names.includes(primary))throw new Error('The completed media file is missing. Restore it before backing up.');
 let total=0;
 const files=names.map(name=>{
  const file=path.join(folder,name),stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Media backup cannot follow links or directories.');
  total+=stat.size;if(total>128*1024*1024)throw new Error('This media job exceeds the 128 MB backup limit.');
  const bytes=readFileSync(file);
  return {name,sha256:createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64')};
 });
 return {version:1,sourceJobId:job.id,kind:job.kind,prompt:job.prompt,seed:job.seed,files};
}

export async function importLocalMedia(output:string,input:unknown,lifecycle?:{token:string;prepare:(ids:string[],sourceIds:string[])=>void}){
 if(lifecycle&&!/^[a-f0-9-]{36}$/.test(lifecycle.token))throw new Error('Invalid import owner.');
 if(!Array.isArray(input)||input.length>24)throw new Error('Import at most 24 local media jobs.');
 let total=0;const sources=new Set<string>();
 const checked=input.map((archive:LocalMediaArchive)=>{
  if(!archive||archive.version!==1||!['image','video'].includes(archive.kind)||!/^([a-f0-9-]{36})$/.test(archive.sourceJobId)||sources.has(archive.sourceJobId)||typeof archive.prompt!=='string'||archive.prompt.length>4000||!Number.isSafeInteger(archive.seed)||archive.seed<0||archive.seed>2147483647||!Array.isArray(archive.files)||archive.files.length>70)throw new Error('Invalid media archive metadata.');
  sources.add(archive.sourceJobId);const names=new Set<string>();
  const files=archive.files.map(file=>{
   if(!file||typeof file.name!=='string'||(!allowed.has(file.name)&&!/^frame-\d{3}\.png$/.test(file.name))||names.has(file.name)||typeof file.base64!=='string'||file.base64.length>178956972||typeof file.sha256!=='string')throw new Error('Invalid or duplicate archive file.');
   names.add(file.name);const bytes=Buffer.from(file.base64,'base64');total+=bytes.length;
   if(total>128*1024*1024||bytes.toString('base64')!==file.base64||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('Archive bytes are damaged or exceed the import limit.');
   return {name:file.name,bytes};
  });
  if(!names.has(archive.kind==='video'?'generated-video.mp4':'generated-image.png'))throw new Error('Archive is missing its primary media.');
  return {archive,files};
 });
 const root=path.resolve(output),created:string[]=[];
 const allocations=checked.map(()=>randomUUID());
 // Persist ownership of every allocation before creating any media directory.
 lifecycle?.prepare(allocations,checked.map(item=>item.archive.sourceJobId));
 try {
  const restored=[];
  for(const [index,{archive,files}] of checked.entries()){
   const id=allocations[index],folder=path.join(root,id);
   mkdirSync(folder);created.push(folder);
   if(lifecycle)writeFileSync(path.join(folder,'job.json'),JSON.stringify({id,importToken:lifecycle.token,status:'importing'}),{flag:'wx',flush:true});
   for(const {name,bytes} of files){
    if(name.endsWith('.png')){
     const meta=await sharp(bytes,{limitInputPixels:24*1024*1024}).metadata();
     if(meta.format!=='png'||!meta.width||!meta.height)throw new Error('Archive contains an invalid PNG.');
     await sharp(bytes,{limitInputPixels:24*1024*1024}).stats();
    }
    if(name.endsWith('.mp4')&&(bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp'))throw new Error('Archive contains an invalid MP4.');
    writeFileSync(path.join(folder,name),bytes,{flag:'wx'});
   }
   const manifest=archive.kind==='video'?await readVideoManifest(folder,id):undefined;
   const job={id,...(lifecycle?{importToken:lifecycle.token}:{}),kind:archive.kind,prompt:archive.prompt,seed:archive.seed,status:'completed',message:'Imported local media. Generation and continuity are unverified.',createdAt:new Date().toISOString()};
   writeFileSync(path.join(folder,'job.json'),JSON.stringify(job),{flag:lifecycle?'w':'wx',flush:true});
   restored.push({sourceJobId:archive.sourceJobId,job,manifest});
  }
  return restored;
 }catch(error){
  for(const folder of created){
   if(path.dirname(path.resolve(folder))!==root||!/^([a-f0-9-]{36})$/.test(path.basename(folder)))throw new Error('Unsafe import rollback target.');
   rmSync(folder,{recursive:true,force:true});
  }
  throw error;
 }
}
