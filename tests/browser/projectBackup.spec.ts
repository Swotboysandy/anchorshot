import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {createLocalAi} from '../../server/localAi';
import {videoFixture,sha} from '../helpers/videoFixture';
import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
for(const width of [1440,390])test(`portable project backup restores scenes and both masks in a fresh browser at ${width}px`,async({page,browser})=>{
 await page.setViewportSize({width,height:900});
 await page.goto('/');
 await page.getByRole('button',{name:'Kitchen to ocean',exact:true}).click();
 await page.getByRole('button',{name:'Apply direction',exact:true}).click();
 await expect(page.getByRole('region',{name:'Film preview'})).toBeVisible();
 const original=await page.getByLabel('Switch project').inputValue();
 const expected=await page.evaluate(async(id)=>{
  const modulePath='/src/services/projectStorage.ts';const storage=await import(/* @vite-ignore */modulePath);
  await storage.flushLocalSaves();
  const key=`dream:${id}`;await storage.loadLocal(key);
  const photo={width:8,height:4,data:Uint8ClampedArray.from({length:128},(_,i)=>[20,30,40,255,80,90,100,255][i%8])};
  const masks={selection:{photo,mask:Uint8Array.from({length:32},(_,i)=>i%2===0?1:0),name:'Cup',revision:2},umbrella:{photo,mask:Uint8Array.from({length:32},(_,i)=>i%2===1?1:0),name:'Umbrella',revision:3}};
  await storage.saveLocal(key,masks);
  return (await storage.loadLocal('library')).projects.find((project:any)=>project.projectId===id);
 },original);
 await page.locator('summary').filter({hasText:/^Files$/}).click();
 const downloadPromise=page.waitForEvent('download');
 await page.getByRole('button',{name:'Back up project',exact:true}).click();
 const download=await downloadPromise;
 const file=await download.path();expect(file).toBeTruthy();
 const bytes=await readFile(file!);expect(bytes.length).toBeGreaterThan(1000);
 const fresh=await browser.newContext({viewport:{width,height:900}});
 try{
  const restoredPage=await fresh.newPage();await restoredPage.goto('/');
  await expect(restoredPage.getByRole('heading',{name:'What would you like to create?'})).toBeVisible();
  await restoredPage.getByLabel('Restore project backup').setInputFiles({name:'film.anchorshot.json',mimeType:'application/json',buffer:bytes});
  await expect(restoredPage.getByRole('status').filter({hasText:'Project restored as a separate copy.'})).toBeVisible();
  const newId=await restoredPage.getByLabel('Switch project').inputValue();expect(newId).not.toBe(original);
  await restoredPage.reload();
  await expect(restoredPage.getByRole('region',{name:'Film preview'})).toBeVisible();
  const stored=await restoredPage.evaluate(async(id)=>{
   const modulePath='/src/services/projectStorage.ts';const storage=await import(/* @vite-ignore */modulePath);
   const library=await storage.loadLocal('library');const masks=await storage.loadLocal(`dream:${id}`);
   return {project:library.projects.find((p:any)=>p.projectId===id),count:library.projects.length,cup:Array.from(masks.selection.mask),umbrella:Array.from(masks.umbrella.mask),photo:Array.from(masks.selection.photo.data),typed:masks.selection.photo.data instanceof Uint8ClampedArray,overflow:document.documentElement.scrollWidth>innerWidth};
  },newId);
  expect(stored.count).toBe(2); // Fresh landing project plus imported copy; neither is overwritten.
  expect(stored.project.shots.map((s:any)=>[s.currentImageUrl,s.durationSeconds,s.promptDescription])).toEqual(expected.shots.map((s:any)=>[s.currentImageUrl,s.durationSeconds,s.promptDescription]));
  expect(stored).toMatchObject({cup:Array.from({length:32},(_,i)=>i%2===0?1:0),umbrella:Array.from({length:32},(_,i)=>i%2===1?1:0),photo:Array.from({length:128},(_,i)=>[20,30,40,255,80,90,100,255][i%8]),typed:true,overflow:false});
  await restoredPage.locator('summary').filter({hasText:/^Files$/}).click();
  await restoredPage.screenshot({path:path.join(tmpdir(),`anchorshot-backup-${width}.png`)});
 }finally{await fresh.close();}
});


test('video backup restores into a different local service and its saved masks can produce a corrected take',async({page,browser})=>{
 test.setTimeout(120000);
 const root=mkdtempSync(path.join(tmpdir(),'anchorshot-portable-video-'));
 const fixture=await videoFixture(path.join(root,'source'));
 const source=createLocalAi(path.join(root,'source')),destination=createLocalAi(path.join(root,'destination'));
 const servers=[source.app.listen(0,'127.0.0.1'),destination.app.listen(0,'127.0.0.1')];
 await Promise.all(servers.map(server=>new Promise<void>(resolve=>server.once('listening',resolve))));
 const origins=servers.map(server=>{const address=server.address();if(!address||typeof address==='string')throw new Error('Missing port');return `http://127.0.0.1:${address.port}`;});
 const forward=(origin:string)=>async(route:any)=>{
  const incoming=route.request(),url=new URL(incoming.url());
  const response=await fetch(origin+url.pathname.replace('/api/local-ai',''),{method:incoming.method(),headers:{'Content-Type':'application/json','X-Anchorshot-Local':'1'},body:incoming.method()==='POST'?incoming.postData():undefined});
  await route.fulfill({status:response.status,contentType:response.headers.get('content-type')||'application/octet-stream',body:Buffer.from(await response.arrayBuffer())});
 };
 const fresh=await browser.newContext();
 try {
  await page.route('**/api/local-ai/**',forward(origins[0]));
  await page.goto('/');
  await page.getByRole('button',{name:'Kitchen to ocean',exact:true}).click();
  await page.getByRole('button',{name:'Apply direction',exact:true}).click();
  await expect(page.getByRole('region',{name:'Film preview'})).toBeVisible();
  await page.evaluate(async({id,plan})=>{
   const modulePath='/src/services/projectStorage.ts';const storage=await import(/* @vite-ignore */modulePath);
   await storage.flushLocalSaves();const library=await storage.loadLocal('library');
   const project=library.projects.find((p:any)=>p.projectId===library.active);const shot=project.shots[0];
   project.activeShotId=shot.id;
   Object.assign(shot,{currentImageUrl:`/api/local-ai/jobs/${id}/assets/frame-000.png`,videoUrl:`/api/local-ai/jobs/${id}/assets/generated-video.mp4`,generatedJobId:id,videoMaskPlan:plan,mediaSource:'generated',status:'uncertain',proposedFix:undefined,detectedObjects:undefined});
   shot.revisions.push({revisionId:'saved-video',timestamp:1,imageUrl:shot.currentImageUrl,videoUrl:shot.videoUrl,generatedJobId:id,videoMaskPlan:plan,actionApplied:'Imported synthetic test video'});
   await storage.saveLocal('library',library);
  },{id:fixture.id,plan:fixture.plan});
  await page.reload();
  await page.locator('summary').filter({hasText:/^Files$/}).click();
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Back up project',exact:true}).click();
  const file=await (await downloadPromise).path();const bytes=await readFile(file!);
  const restored=await fresh.newPage();await restored.route('**/api/local-ai/**',forward(origins[1]));await restored.goto('/');
  await expect(restored.getByRole('heading',{name:'What would you like to create?'})).toBeVisible();
  await restored.getByLabel('Restore project backup').setInputFiles({name:'video.anchorshot.json',mimeType:'application/json',buffer:bytes});
  await expect(restored.getByRole('status').filter({hasText:'Project restored as a separate copy.'})).toBeVisible();
  await restored.reload();
  const readActive=()=>restored.evaluate(async()=>{const modulePath='/src/services/projectStorage.ts';const storage=await import(/* @vite-ignore */modulePath);await storage.flushLocalSaves();const library=await storage.loadLocal('library');return library.projects.find((p:any)=>p.projectId===library.active).shots[0];});
  const shot=await readActive();expect(shot.generatedJobId).not.toBe(fixture.id);
  expect(shot.videoMaskPlan.tracks).toEqual(fixture.plan.tracks);
  expect(shot.revisions.at(-1).videoMaskPlan).toEqual(shot.videoMaskPlan);
  const copyFolder=path.join(root,'destination','.artifacts/local-ai/ui-jobs',shot.generatedJobId);
  for(const file of readdirSync(fixture.folder).filter(name=>name.endsWith('.png')||name.endsWith('.mp4')))expect(sha(readFileSync(path.join(copyFolder,file)))).toBe(sha(readFileSync(path.join(fixture.folder,file))));
  expect((await fetch(`${origins[1]}/jobs/${fixture.id}`)).status).toBe(404);
  await expect.poll(()=>restored.locator('video').first().evaluate((video:HTMLVideoElement)=>video.readyState)).toBeGreaterThanOrEqual(2);
  const player=restored.locator('video').first();
  await expect(player).toHaveJSProperty('muted',false);
  await restored.getByRole('button',{name:'Mute spoken feedback',exact:true}).click();
  await expect(player).toHaveJSProperty('muted',true);
  await restored.getByRole('button',{name:'Enable spoken feedback',exact:true}).click();
  await expect(player).toHaveJSProperty('muted',false);
  await player.evaluate((video:HTMLVideoElement)=>{(video as any).__originalPlay=video.play;video.play=()=>Promise.reject(new DOMException('Blocked for test','NotAllowedError'));});
  await restored.getByRole('button',{name:'Play timeline',exact:true}).click();
  await expect(restored.getByRole('alert').filter({hasText:'Video playback could not start'})).toBeVisible();
  await expect(restored.getByRole('button',{name:'Play timeline',exact:true})).toBeVisible();
  await player.evaluate((video:HTMLVideoElement)=>{video.play=(video as any).__originalPlay;});
  await restored.getByRole('button',{name:'Play timeline',exact:true}).click();
  await expect(restored.getByRole('button',{name:'Pause timeline',exact:true})).toBeVisible();
  await expect(restored.getByRole('alert').filter({hasText:'Video playback could not start'})).toHaveCount(0);
  await restored.getByRole('button',{name:'Pause timeline',exact:true}).click();
  await restored.getByRole('tab',{name:'Review',exact:true}).click();
  const review=restored.getByRole('region',{name:'Video mask review',exact:true});
  await review.getByRole('button',{name:'Review video masks',exact:true}).click();
  const render=review.getByRole('button',{name:'Create corrected take',exact:true});await expect(render).toBeEnabled();
  await render.click();
  let corrected:any;await expect.poll(async()=>{corrected=await readActive();return corrected.generatedJobId;}).not.toBe(shot.generatedJobId);
  const report=JSON.parse(readFileSync(path.join(root,'destination','.artifacts/local-ai/ui-jobs',corrected.generatedJobId,'modification-report.json'),'utf8'));
  expect(report).toMatchObject({frames:5,rawChangedOutside:0,semanticContinuity:'unverified'});
 }finally{
  await fresh.close();await page.unroute('**/api/local-ai/**');source.stop();destination.stop();
  await Promise.all(servers.map(server=>{server.closeAllConnections();return new Promise<void>(resolve=>server.close(()=>resolve()));}));
  if(!root.startsWith(path.join(tmpdir(),'anchorshot-portable-video-')))throw new Error('Unsafe fixture cleanup');rmSync(root,{recursive:true,force:true});
 }
});


test('restore identity survives reload before publication and after publication without duplicating the project',async({page})=>{
 await page.goto('/');
 const fixture=await page.evaluate(async()=>{
  const storagePath='/src/services/projectStorage.ts',archivePath='/src/services/projectArchive.ts';
  const storage=await import(storagePath),archive=await import(archivePath);
  await storage.flushLocalSaves();
  const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const image=canvas.toDataURL();
  const text=archive.serializeProjectArchive({format:'anchorshot-project',version:1,media:[],images:{},project:{projectId:'source',title:'Recovered story',transcript:'Cup',isRecording:false,isPlayingAnimatic:false,isProcessing:false,statusAnnouncement:'',activeShotId:'1',rules:[],shots:[{id:'1',shotNumber:1,durationSeconds:2,status:'uncertain',promptDescription:'Cup',spokenDescription:'Cup',currentImageUrl:image,originalImageUrl:image,revisions:[]}]}});
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));const fingerprint=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  const {operation}=await storage.beginRestoreOperation(fingerprint);
  return {text,fingerprint,operation};
 });
 await page.reload();await expect(page.getByRole('heading',{name:'What would you like to create?'})).toBeVisible();
 const first=await page.evaluate(async({text})=>{
  const modulePath='/src/services/projectArchive.ts';const archive=await import(modulePath);
  const remove=IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete=function(key){if(String(key).startsWith('restore:'))throw new DOMException('Injected finalization interruption','QuotaExceededError');return remove.call(this,key);};
  try{const result=await archive.restoreProjectArchive(text);return {id:result.project.projectId,warning:result.warning};}
  finally{IDBObjectStore.prototype.delete=remove;}
 },fixture);
 expect(first.id).toBe(fixture.operation.projectId);expect(first.warning).toContain('Project was saved');
 await page.reload();
 const recovered=await page.evaluate(async({text})=>{
  const modulePath='/src/services/projectArchive.ts';const archive=await import(modulePath);
  const result=await archive.restoreProjectArchive(text);
  return {id:result.project.projectId,count:result.library.projects.filter((p:any)=>p.title.startsWith('Recovered story')).length,warning:result.warning};
 },fixture);
 expect(recovered).toEqual({id:first.id,count:1,warning:undefined});
});
