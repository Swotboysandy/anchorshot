import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import request from 'supertest';
import {createLocalAi} from '../server/localAi';
import {videoFixture,sha} from './helpers/videoFixture';
import {archiveLocalMedia,importLocalMedia} from '../server/mediaArchive';
import {createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';

it('exports actual video frames and bytes with integrity hashes while excluding unrelated files',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'anchorshot-archive-'));
 try {
  const fixture=await videoFixture(root);
  writeFileSync(path.join(fixture.folder,'private-unrelated.txt'),'exclude me');
  const service=createLocalAi(root);
  const response=await request(service.app).get(`/jobs/${fixture.id}/archive`).set('Host','127.0.0.1');
  expect(response.status).toBe(200);
  const post=(archives:unknown[])=>request(service.app).post('/imports').set('Host','127.0.0.1').set('X-Anchorshot-Local','1').send({archives});
  const imported=await post([response.body]);expect(imported.status).toBe(201);
  const copy=imported.body[0];expect(copy.job.id).not.toBe(fixture.id);
  expect(copy.manifest.fingerprint).not.toBe(fixture.manifest.fingerprint);
  expect(copy.manifest.frames.map((f:any)=>f.sourceHash)).toEqual(fixture.manifest.frames.map(f=>f.sourceHash));
  for(const file of response.body.files)expect(sha(readFileSync(path.join(path.dirname(fixture.folder),copy.job.id,file.name)))).toBe(file.sha256);
  const existing=readdirSync(path.dirname(fixture.folder)).sort();
  const damaged=structuredClone(response.body);damaged.files[0].base64='AAAA';
  expect((await post([damaged])).status).toBe(422);
  const traversal=structuredClone(response.body);traversal.files[0].name='../outside.png';
  expect((await post([traversal])).status).toBe(422);
  const badPng=structuredClone(response.body);const badBytes=Buffer.from('not PNG');
  badPng.sourceJobId='00000000-0000-0000-0000-000000000001';
  badPng.files[0].base64=badBytes.toString('base64');badPng.files[0].sha256=sha(badBytes);
  expect((await post([response.body,badPng])).status).toBe(422);
  expect(readdirSync(path.dirname(fixture.folder)).sort()).toEqual(existing);
  for(const file of response.body.files)expect(sha(readFileSync(path.join(fixture.folder,file.name)))).toBe(file.sha256);

  expect(response.body).toMatchObject({version:1,sourceJobId:fixture.id,kind:'video'});
  expect(response.body.files.map((file:any)=>file.name)).toEqual(['frame-000.png','frame-001.png','frame-002.png','frame-003.png','frame-004.png','generated-video.mp4']);
  for(const file of response.body.files)expect(sha(Buffer.from(file.base64,'base64'))).toBe(file.sha256);
  expect((await request(service.app).get('/jobs/not-a-job/archive').set('Host','127.0.0.1')).status).toBe(404);
  expect(()=>archiveLocalMedia(fixture.folder,{id:fixture.id,kind:'video',prompt:'',seed:1,status:'running'})).toThrow('completed');
 }finally{if(!root.startsWith(path.join(tmpdir(),'anchorshot-archive-')))throw new Error('Unsafe cleanup');rmSync(root,{recursive:true,force:true});}
});


it('rollback removes only its new import and committed imports cannot be rolled back',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'anchorshot-archive-'));
 try {
  const fixture=await videoFixture(root);
  const service=createLocalAi(root);
  const archive=archiveLocalMedia(fixture.folder,{id:fixture.id,kind:'video',prompt:'Cup',seed:1,status:'completed'});
  const post=(route:string,body:unknown)=>request(service.app).post(route).set('Host','127.0.0.1').set('X-Anchorshot-Local','1').send(body);
  const imported=await post('/imports',{archives:[archive],transactional:true});
  expect(imported.status).toBe(201);
  const {importToken,items}=imported.body;
  expect((await post(`/imports/${fixture.id}/rollback`,{})).status).toBe(409);
  expect((await post(`/imports/${importToken}/rollback`,{})).body).toEqual({rolledBack:true});
  expect(readdirSync(path.dirname(fixture.folder))).not.toContain(items[0].job.id);
  expect((await request(service.app).get(`/jobs/${items[0].job.id}`).set('Host','127.0.0.1')).status).toBe(404);
  for(const file of archive.files)expect(sha(readFileSync(path.join(fixture.folder,file.name)))).toBe(file.sha256);
  const committed=await post('/imports',{archives:[archive],transactional:true});
  expect((await post(`/imports/${committed.body.importToken}/commit`,{})).status).toBe(200);
  expect((await post(`/imports/${committed.body.importToken}/rollback`,{})).status).toBe(409);
  expect(readdirSync(path.dirname(fixture.folder))).toContain(committed.body.items[0].job.id);
 }finally{if(!root.startsWith(path.join(tmpdir(),'anchorshot-archive-')))throw new Error('Unsafe cleanup');rmSync(root,{recursive:true,force:true});}
});


it('pending imports recover after restart and finalized transactions stay idempotent and non-destructive',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'anchorshot-archive-'));
 try{
  const fixture=await videoFixture(root);
  const archive=archiveLocalMedia(fixture.folder,{id:fixture.id,kind:'video',prompt:'Cup',seed:1,status:'completed'});
  let service=createLocalAi(root);
  const post=(route:string,body:unknown)=>request(service.app).post(route).set('Host','127.0.0.1').set('X-Anchorshot-Local','1').send(body);
  const pending=await post('/imports',{archives:[archive],transactional:true});expect(pending.status).toBe(201);
  const token=pending.body.importToken,id=pending.body.items[0].job.id;
  service.stop();service=createLocalAi(root);
  expect((await request(service.app).get(`/jobs/${id}`).set('Host','127.0.0.1')).status).toBe(200);
  expect((await post(`/imports/${token}/rollback`,{})).status).toBe(200);
  service.stop();service=createLocalAi(root);
  expect((await post(`/imports/${token}/rollback`,{})).status).toBe(200);
  expect((await post(`/imports/${token}/commit`,{})).status).toBe(409);
  expect((await request(service.app).get(`/jobs/${id}`).set('Host','127.0.0.1')).status).toBe(404);
  const committed=await post('/imports',{archives:[archive],transactional:true});
  service.stop();service=createLocalAi(root);
  expect((await post(`/imports/${committed.body.importToken}/commit`,{})).status).toBe(200);
  service.stop();service=createLocalAi(root);
  expect((await post(`/imports/${committed.body.importToken}/commit`,{})).status).toBe(200);
  expect((await post(`/imports/${committed.body.importToken}/rollback`,{})).status).toBe(409);
  expect((await request(service.app).get(`/jobs/${committed.body.items[0].job.id}`).set('Host','127.0.0.1')).status).toBe(200);
  for(const file of archive.files)expect(sha(readFileSync(path.join(fixture.folder,file.name)))).toBe(file.sha256);
  service.stop();
 }finally{if(!root.startsWith(path.join(tmpdir(),'anchorshot-archive-')))throw Error('Unsafe cleanup');rmSync(root,{recursive:true,force:true});}
});

it('a restored transaction cannot delete media that no longer belongs to that import',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'anchorshot-archive-'));
 try{
  const fixture=await videoFixture(root);
  const archive=archiveLocalMedia(fixture.folder,{id:fixture.id,kind:'video',prompt:'Cup',seed:1,status:'completed'});
  let service=createLocalAi(root);
  const post=(route:string,body:unknown)=>request(service.app).post(route).set('Host','127.0.0.1').set('X-Anchorshot-Local','1').send(body);
  const imported=await post('/imports',{archives:[archive],transactional:true});
  const metadata=path.join(path.dirname(fixture.folder),imported.body.items[0].job.id,'job.json');
  const job=JSON.parse(readFileSync(metadata,'utf8'));delete job.importToken;writeFileSync(metadata,JSON.stringify(job));
  service.stop();service=createLocalAi(root);
  expect((await post(`/imports/${imported.body.importToken}/rollback`,{})).status).toBe(409);
  for(const file of archive.files)expect(sha(readFileSync(path.join(path.dirname(metadata),file.name)))).toBe(file.sha256);
  service.stop();
 }finally{if(!root.startsWith(path.join(tmpdir(),'anchorshot-archive-')))throw Error('Unsafe cleanup');rmSync(root,{recursive:true,force:true});}
});


it('replays an acknowledged import after lost response and restart without duplicating media',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'anchorshot-archive-'));
 try{
  const fixture=await videoFixture(root);
  const archive=archiveLocalMedia(fixture.folder,{id:fixture.id,kind:'video',prompt:'Cup',seed:1,status:'completed'});
  let service=createLocalAi(root);
  const post=(route:string,body:unknown)=>request(service.app).post(route).set('Host','127.0.0.1').set('X-Anchorshot-Local','1').send(body);
  const payload={archives:[archive],transactional:true,operationId:'12345678-1234-4234-8234-123456789abc'};
  const first=await post('/imports',payload);expect(first.status).toBe(201);
  const idsBefore=readdirSync(path.dirname(fixture.folder)).sort();
  service.stop();service=createLocalAi(root);
  const replay=await post('/imports',payload);expect(replay.status).toBe(200);
  expect(replay.body.importToken).toBe(first.body.importToken);
  expect(replay.body.items[0].job.id).toBe(first.body.items[0].job.id);
  expect(replay.body.items[0].manifest).toEqual(first.body.items[0].manifest);
  expect(readdirSync(path.dirname(fixture.folder)).sort()).toEqual(idsBefore);
  const changed={...payload,archives:[{...archive,prompt:'Different backup'}]};
  expect((await post('/imports',changed)).status).toBe(409);
  expect(readdirSync(path.dirname(fixture.folder)).sort()).toEqual(idsBefore);
  expect((await post(`/imports/${payload.operationId}/commit`,{})).status).toBe(200);
  service.stop();service=createLocalAi(root);
  expect((await post('/imports',payload)).status).toBe(200);
  expect((await post(`/imports/${payload.operationId}/rollback`,{})).status).toBe(409);
  service.stop();
 }finally{if(!root.startsWith(path.join(tmpdir(),'anchorshot-archive-')))throw Error('Unsafe cleanup');rmSync(root,{recursive:true,force:true});}
});


it('records allocated IDs before writing and recovers partial owned media after restart',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'anchorshot-archive-'));
 try{
  const fixture=await videoFixture(root),output=path.dirname(fixture.folder);
  const archive=archiveLocalMedia(fixture.folder,{id:fixture.id,kind:'video',prompt:'Cup',seed:1,status:'completed'});
  const token='12345678-1234-4234-8234-abcdef123456';let allocated:string[]=[];
  const before=readdirSync(output).sort();
  await expect(importLocalMedia(output,[archive],{token,prepare:(ids)=>{
   allocated=ids;expect(readdirSync(output).sort()).toEqual(before);throw Error('Simulated interrupted pre-write journal');
  }})).rejects.toThrow('pre-write');
  expect(allocated).toHaveLength(1);expect(readdirSync(output).sort()).toEqual(before);
  // Reconstruct persisted crash states at mkdir and mid-media-write boundaries.
  for(const empty of [true,false]){
   const id=allocated[0],folder=path.join(output,id);mkdirSync(folder);
   if(!empty){writeFileSync(path.join(folder,'job.json'),JSON.stringify({id,importToken:token,status:'importing'}));writeFileSync(path.join(folder,'frame-000.png'),'partial bytes');}
   const journal=path.join(root,'.artifacts/local-ai/import-transactions');mkdirSync(journal,{recursive:true});
   writeFileSync(path.join(journal,`${token}.json`),JSON.stringify({version:1,token,ids:[id],sourceIds:[archive.sourceJobId],fingerprint:createHash('sha256').update(JSON.stringify([archive])).digest('hex'),status:'importing'}));
   const service=createLocalAi(root);
   const listed=await request(service.app).get('/jobs').set('Host','127.0.0.1');
   expect(listed.status).toBe(200);expect(listed.body.some((job:any)=>job.id===id)).toBe(false);
   const post=(route:string,body:unknown)=>request(service.app).post(route).set('Host','127.0.0.1').set('X-Anchorshot-Local','1').send(body);
   expect((await post(`/imports/${token}/commit`,{})).status).toBe(409);
   const recovered=await post('/imports',{archives:[archive],transactional:true,operationId:token});
   expect(recovered.status).toBe(201);expect(recovered.body.items[0].job.id).not.toBe(id);
   expect(readdirSync(output)).not.toContain(id);
   for(const file of archive.files){
    expect(sha(readFileSync(path.join(output,recovered.body.items[0].job.id,file.name)))).toBe(file.sha256);
    expect(sha(readFileSync(path.join(fixture.folder,file.name)))).toBe(file.sha256);
   }
   expect((await post(`/imports/${token}/rollback`,{})).status).toBe(200);service.stop();
  }
 }finally{if(!root.startsWith(path.join(tmpdir(),'anchorshot-archive-')))throw Error('Unsafe cleanup');rmSync(root,{recursive:true,force:true});}
});
