import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLocalAi} from '../../server/localAi';
import {videoFixture,sha} from '../helpers/videoFixture';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';

test('scene text and duration edits preserve media, survive refresh and reject invalid duration', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Kitchen to ocean', exact: true }).click();
  await page.getByRole('button', { name: 'Apply direction', exact: true }).click();
  await page.getByRole('region', { name: 'Film preview' }).waitFor();
  const source = await page.getByRole('region', { name: 'Film preview' }).locator('img').first().getAttribute('src');
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  const prompt = page.getByLabel('Shot Prompt Description', { exact: true });
  const duration = page.getByLabel('DURATION (S):', { exact: true });
  await prompt.fill('The cup stays still as the kitchen becomes an ocean.');
  await duration.fill('6');
  await page.getByRole('button', { name: 'Update Shot', exact: true }).click();
  await expect(page.locator('.local-label')).toContainText('Saved locally');
  await page.getByRole('tab', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Film preview' }).locator('img').first()).toHaveAttribute('src', source!);
  await page.reload();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  await expect(prompt).toHaveValue('The cup stays still as the kitchen becomes an ocean.');
  await expect(duration).toHaveValue('6');
  await duration.fill('0');
  await expect(page.getByRole('button', { name: 'Update Shot', exact: true })).toBeDisabled();
});

test('failed film export reports the error and unlocks the controls', async ({ page }) => {
  await page.route('**/api/export/animatic', route => route.fulfill({ status: 500, json: { error: 'Encoder test failure' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Kitchen to ocean', exact: true }).click();
  await page.getByRole('button', { name: 'Apply direction', exact: true }).click();
  const button = page.getByRole('button', { name: /^Export (film|MP4)$/ });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.locator('.clean-studio')).toContainText('Export failed: Encoder test failure');
  await expect(button).toBeEnabled();
  await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeEnabled();
});


const jobId='00000000-0000-0000-0000-000000000001';
const completedVideo={id:jobId,kind:'video',status:'completed',prompt:'A cup beside an umbrella.',seed:42,message:'Fixture video for browser tests'};

async function mockVideo(page: import('@playwright/test').Page) {
  const pixel=await sharp({create:{width:4,height:4,channels:4,background:'#2255aa'}}).png().toBuffer();
  const mp4=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=64x64:r=8:d=1','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1'],{windowsHide:true});
  await page.route('**/api/local-ai/health',route=>route.fulfill({json:{ready:false,activeJobId:null}}));
  await page.route('**/api/local-ai/jobs',route=>route.fulfill({json:[completedVideo]}));
  await page.route('**/api/local-ai/jobs/*/assets/*.png',route=>route.fulfill({contentType:'image/png',body:pixel}));
  await page.route('**/api/local-ai/jobs/*/assets/*.mp4',route=>route.fulfill({contentType:'video/mp4',body:mp4}));
}
async function createStory(page: import('@playwright/test').Page) {
  await page.getByRole('button',{name:'Kitchen to ocean',exact:true}).click();
  await page.getByRole('button',{name:'Apply direction',exact:true}).click();
  await page.getByRole('region',{name:'Film preview'}).waitFor();
  await expect(page.getByRole('button',{name:'New project',exact:true})).toBeEnabled();
}
async function applyVideo(page: import('@playwright/test').Page) {
  await page.getByRole('tab',{name:'Review',exact:true}).click();
  await page.getByText('Generate new media',{exact:true}).click();
  await page.getByRole('button',{name:'Use video in Shot 2',exact:true}).click();
  await expect(page.locator('.local-label')).toContainText('Saved locally');
}
async function readLibrary(page: import('@playwright/test').Page) {
  return page.evaluate(()=>new Promise<any>((resolve,reject)=>{
    const open=indexedDB.open('anchorshot-projects',1);
    open.onsuccess=()=>{const db=open.result;const r=db.transaction('records').objectStore('records').get('library');r.onsuccess=()=>{resolve(r.result);db.close();};r.onerror=()=>reject(r.error);};
    open.onerror=()=>reject(open.error);
  }));
}

test('a local video applies to one shot, selects the correct timeline scene, and restores with its take',async({page})=>{
  await mockVideo(page);await page.goto('/');await createStory(page);
  await expect(page.getByRole('region',{name:'Film preview'}).locator('video')).toHaveCount(0);
  await expect(page.locator('.sample-badge')).toHaveText('Sample scene');
  await applyVideo(page);
  let library=await readLibrary(page);let project=library.projects.find((item:any)=>item.projectId===library.active);
  expect(project.shots.filter((shot:any)=>shot.videoUrl).map((shot:any)=>shot.shotNumber)).toEqual([2]);
  await page.getByRole('tab',{name:'Create',exact:true}).click();
  await page.getByRole('button',{name:'Select shot 1',exact:true}).click();
  await expect(page.getByRole('region',{name:'Film preview'}).locator('video')).toHaveCount(0);
  await page.getByRole('button',{name:'Select shot 2',exact:true}).click();
  await expect(page.locator('.sample-badge')).toHaveText('Generated scene');
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.sample-badge')).toBeVisible();
  await expect(page.locator('.sample-badge')).toHaveText('Generated scene');
  await page.setViewportSize({width:1280,height:900});
  await expect(page.getByRole('region',{name:'Film preview'}).locator('video')).toHaveAttribute('src',`/api/local-ai/jobs/${jobId}/assets/generated-video.mp4`);
  await page.getByRole('tab',{name:'Review',exact:true}).click();
  await page.getByRole('button',{name:'Take 1',exact:true}).click();
  await expect(page.locator('.local-label')).toContainText('Saved locally');
  library=await readLibrary(page);project=library.projects.find((item:any)=>item.projectId===library.active);
  expect(project.shots[1].videoUrl).toBeUndefined();
  expect(project.shots[1].mediaSource).toBe('sample');
  await page.getByRole('button',{name:'Take 2',exact:true}).click();
  await page.reload();
  await expect(page.getByRole('region',{name:'Film preview'}).locator('video')).toHaveAttribute('src',`/api/local-ai/jobs/${jobId}/assets/generated-video.mp4`);
});

test('a late region scan cannot attach to another project with the same shot id',async({page})=>{
  await mockVideo(page);
  let release!:()=>void;
  let requested!:()=>void;
  const started=new Promise<void>(resolve=>{requested=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let delivered!:()=>void;const response=new Promise<void>(resolve=>{delivered=resolve;});
  await page.route('**/api/local-ai/jobs/*/detect-objects',async route=>{
    requested();await gate;
    await route.fulfill({json:[{id:'old',objectId:'old',label:'Previous project scan',concept:'cup',confidence:0,maskRef:'proposal',bounds:{left:0,top:0,right:1,bottom:1},rasterWidth:1,rasterHeight:1,rasterBase64:'AQ=='}]});delivered();
  });
  await page.goto('/');await createStory(page);await applyVideo(page);
  const first=await page.getByLabel('Switch project').inputValue();
  await page.getByRole('button',{name:'Suggest regions in first frame',exact:true}).click();await started;
  await page.getByRole('button',{name:'New project',exact:true}).click();await createStory(page);await applyVideo(page);
  const second=await page.getByLabel('Switch project').inputValue();expect(second).not.toBe(first);
  release();await response;
  await page.waitForTimeout(150); // Allow the stale request's React updater and IDB write to settle.
  await expect(page.locator('.clean-studio')).not.toContainText('Previous project scan');
  const library=await readLibrary(page);const project=library.projects.find((item:any)=>item.projectId===second);
  expect(project.shots[1].detectedObjects).toBeUndefined();
});


for(const mode of ['confirm','switch','command','still','fix-command'] as const)test(`manual SAM selection ${mode} keeps source-bound candidate rasters`,async({page})=>{
  await mockVideo(page);await page.goto('/');await createStory(page);await applyVideo(page);
  const health=await (await page.request.get('/api/health')).json();
  await page.route('**/api/health',route=>route.fulfill({json:{...health,configured:true}}));
  let frameBody:any, selectionBody:any,aborted=false;
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  page.on('requestfailed',request=>{if(request.url().endsWith('/api/masks/disambiguate'))aborted=true;});
  await page.route('**/api/segment/check',async route=>{
    frameBody=route.request().postDataJSON();
    const objects=[0,1].map(index=>({id:`candidate-${index}`,objectId:String(index),maskRef:`sam-3.1:cup:${index}:v1`,source:'sam-3.1',sourceHash:frameBody.sourceHash,width:4,height:4,
      bounds:{left:index*2,top:index*2,right:index*2+2,bottom:index*2+2},rasterWidth:2,rasterHeight:2,rasterBase64:'AQEBAQ==',confidence:0.9}));
    await route.fulfill({json:{maskSessionId:health.maskSessionId,provenance:'live-sam-3.1',requestId:'test-only',sourceHash:frameBody.sourceHash,selectedObjectId:'0',objects}});
  });
  await page.route('**/api/masks/disambiguate',async route=>{
    selectionBody=route.request().postDataJSON();if(mode==='switch')await gate;return route.fulfill({json:{track:{maskRef:selectionBody.maskRef,objectId:selectionBody.selectedObjectId,status:'uncertain'}}});
  });
  if(mode==='command'){
    await page.getByRole('tab',{name:'Create',exact:true}).click();
    await page.getByPlaceholder('Describe your scene or an edit...', {exact:true}).fill('segment cup in shot 2');
    await page.getByRole('button',{name:'Apply direction',exact:true}).click();
    await expect(page.locator('.clean-studio')).toContainText('SAM returned 2 candidate masks');
    await page.getByRole('tab',{name:'Review',exact:true}).click();
  }else await page.getByRole('button',{name:'Run SAM 3.1 Object Segmentation',exact:true}).click();
  await page.getByRole('button',{name:'Lock candidate object 1',exact:true}).click();
  if(mode==='switch'){
    await expect.poll(()=>Boolean(selectionBody)).toBe(true);
    await page.getByRole('button',{name:'New project',exact:true}).click();
    await expect(page.getByRole('heading',{name:'What would you like to create?',exact:true})).toBeVisible();
    release();await expect.poll(()=>aborted).toBe(true);
    await expect(page.locator('.local-label')).toContainText('Saved locally');
    const saved=await readLibrary(page);
    expect(saved.projects.find((p:any)=>p.projectId===saved.active).shots).toHaveLength(0);
    expect(saved.projects.flatMap((p:any)=>p.shots).filter((s:any)=>s.proposedFix?.mask?.objectId==='1')).toHaveLength(0);
    return;
  }

  await expect(page.locator('.clean-studio')).toContainText('Selected object 1. Continuity is uncertain');
  expect(frameBody.image).toMatch(/^data:image\/png;base64,/);
  expect(frameBody.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  expect(selectionBody).toMatchObject({segmentationId:'test-only',maskRef:'sam-3.1:cup:1:v1',selectedObjectId:'1',shotNumber:2});
  await expect(page.locator('.local-label')).toContainText('Saved locally');
  const library=await readLibrary(page);const shot=library.projects.find((project:any)=>project.projectId===library.active).shots[1];
  expect(shot.proposedFix.mask.objectId).toBe('1');
  expect(shot.proposedFix.candidates[0].maskBase64).not.toBe(shot.proposedFix.candidates[1].maskBase64);
  expect(shot.proposedFix.mask.sourceImageUrl).toBe(shot.currentImageUrl);
  if(mode==='fix-command'){
    // Use the selected generated frame as an image rather than a moving clip.
    delete shot.videoUrl;delete shot.videoMaskPlan;
    delete shot.revisions.at(-1).videoUrl;delete shot.revisions.at(-1).videoMaskPlan;
    await page.evaluate(async library=>{const storage=await import('/src/services/projectStorage.ts');await storage.saveLocal('library',library);await storage.flushLocalSaves();},library);
    await page.reload();
    await page.getByPlaceholder('Describe your scene or an edit...', {exact:true}).fill('fix shot 2');
    await page.getByRole('button',{name:'Apply direction',exact:true}).click();
    await expect(page.locator('.clean-studio')).toContainText('recolored to blue');
    await expect(page.locator('.local-label')).toContainText('Saved locally');
    const saved=await readLibrary(page),current=saved.projects.find((p:any)=>p.projectId===saved.active).shots[1];
    expect(current.revisions).toHaveLength(shot.revisions.length+1);
    expect(current.pixelVerification.passed).toBe(true);
    expect(current.mediaSource).toBe('generated');
    expect(current.proposedFix.mask.sourceImageUrl).toBe(current.currentImageUrl);
    return;
  }
  if(mode==='still'){
    const plan={sourceJobId:jobId,fingerprint:'fixture-source',tracks:[{objectId:'cup',color:'blue',frames:[0,1].map(frameIndex=>({frameIndex,sourceHash:frameBody.sourceHash,maskBase64:Buffer.alloc(16,1).toString('base64'),revision:1,reviewed:true,absent:false,method:'manual'}))}]};
    shot.videoMaskPlan=plan;shot.revisions.at(-1).videoMaskPlan=plan;
    await page.evaluate(async library=>{const storage=await import('/src/services/projectStorage.ts');await storage.saveLocal('library',library);await storage.flushLocalSaves();},library);
    await page.reload();await page.getByRole('tab',{name:'Review',exact:true}).click();
    await page.getByRole('button',{name:'purple',exact:true}).click();
    await page.getByRole('button',{name:/Apply SAM 3.1 Recolor \(PURPLE\)/}).click();
    await expect(page.locator('.clean-studio')).toContainText('recolored to purple');
    await expect(page.locator('.local-label')).toContainText('Saved locally');
    await page.reload();
    let saved=await readLibrary(page),current=saved.projects.find((p:any)=>p.projectId===saved.active).shots[1];
    const still=current.currentImageUrl;
    expect(current.status).toBe('mismatch');expect(current.proposedFix.targetColor).toBe('blue');
    expect(saved.projects.find((p:any)=>p.projectId===saved.active).rules.find((r:any)=>r.targetObject==='cup'&&r.property==='color').expectedValue).toBe('blue');
    expect(still).toMatch(/^data:image/);expect(current.videoUrl).toBeUndefined();expect(current.videoMaskPlan).toBeUndefined();expect(current.mediaSource).toBe('generated');
    await page.getByRole('tab',{name:'Create',exact:true}).click();
    await expect(page.getByRole('region',{name:'Film preview'}).locator('video')).toHaveCount(0);
    await page.getByRole('tab',{name:'Review',exact:true}).click();
    await page.getByRole('button',{name:'Take 2',exact:true}).click();
    await expect(page.locator('.local-label')).toContainText('Saved locally');
    saved=await readLibrary(page);current=saved.projects.find((p:any)=>p.projectId===saved.active).shots[1];
    expect(current.videoMaskPlan).toEqual(plan);expect(current.videoUrl).toBe(shot.videoUrl);
    await page.getByRole('tab',{name:'Create',exact:true}).click();
    await expect(page.getByRole('region',{name:'Film preview'}).locator('video')).toHaveAttribute('src',shot.videoUrl);
    await page.getByRole('tab',{name:'Review',exact:true}).click();
    await page.getByRole('button',{name:'Take 3',exact:true}).click();
    await expect(page.locator('.local-label')).toContainText('Saved locally');
    saved=await readLibrary(page);current=saved.projects.find((p:any)=>p.projectId===saved.active).shots[1];
    expect(current.currentImageUrl).toBe(still);expect(current.videoUrl).toBeUndefined();expect(current.videoMaskPlan).toBeUndefined();expect(current.mediaSource).toBe('generated');
    let exportBody:any;page.on('request',request=>{if(request.url().endsWith('/api/export/animatic'))exportBody=request.postDataJSON();});
    await page.getByRole('tab',{name:'Create',exact:true}).click();
    const downloaded=page.waitForEvent('download');
    await page.getByRole('button',{name:/^Export (film|MP4)$/}).click();
    const download=await downloaded;expect(download.suggestedFilename()).toMatch(/\.mp4$/);
    const output=await download.path();if(!output)throw new Error('Missing exported film');
    expect(exportBody.shots[1].image).toBe(still);expect(exportBody.shots[1].video).toBeUndefined();
    execFileSync('ffmpeg',['-v','error','-i',output,'-f','null','-'],{windowsHide:true});
    const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','json',output],{windowsHide:true}).toString());
    expect(Number(probe.format.duration)).toBeCloseTo(14.5,1);
    return;
  }

  await page.getByText('Mask details',{exact:true}).click();
  await expect(page.getByText('SAM RESPONSE',{exact:true})).toBeVisible();
  await expect(page.getByText('Provider score 90.0%. Mask accuracy not measured.',{exact:true})).toBeVisible();
});


for(const mode of ['apply','switch','command'] as const) test(`video mask review ${mode} preserves separate objects and projects`,async({page})=>{
 await mockVideo(page);
 const png=await sharp({create:{width:64,height:48,channels:4,background:'#777777'}}).png().toBuffer();
 const sourceHash=createHash('sha256').update(png).digest('hex');
 const manifest={jobId,fingerprint:'browser-source',fps:8,frames:[0,1].map(index=>({index,width:64,height:48,sourceHash,url:`/api/local-ai/jobs/${jobId}/assets/frame-${String(index).padStart(3,'0')}.png`}))};
 await page.route('**/api/local-ai/jobs/*/assets/*.png',route=>route.fulfill({contentType:'image/png',body:png}));
 await page.route('**/api/local-ai/jobs/*/frames',route=>route.fulfill({json:manifest}));
 let submitted:any,aborted=false;
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 page.on('requestfailed',request=>{if(request.url().endsWith('/correct'))aborted=true;});
 const correctedId='00000000-0000-0000-0000-000000000002';
 await page.route('**/api/local-ai/jobs/*/correct',async route=>{submitted=route.request().postDataJSON();if(mode==='switch'||mode==='command')await gate;return route.fulfill({status:201,json:{id:correctedId,sourceJobId:jobId,videoUrl:`/api/local-ai/jobs/${correctedId}/assets/generated-video.mp4`,imageUrl:`/api/local-ai/jobs/${correctedId}/assets/frame-000.png`,report:{frames:2,rawChangedOutside:0,semanticContinuity:'unverified'}}});});
 await page.goto('/');await createStory(page);await applyVideo(page);
 const review=page.getByRole('region',{name:'Video mask review',exact:true});
 await review.getByRole('button',{name:'Review video masks',exact:true}).click();
 const render=review.getByRole('button',{name:'Create corrected take',exact:true});
 await expect(render).toBeDisabled();
 async function trace(object:'cup'|'umbrella',left:number,right:number){
  const canvas=review.getByRole('img',{name:`${object==='cup'?'Cup':'Umbrella'} selection canvas`,exact:true});
  await canvas.scrollIntoViewIfNeeded();
  const box=await canvas.boundingBox();if(!box)throw new Error('Missing mask canvas');
  for(const [x,y] of [[left,.2],[right,.2],[right,.8],[left,.8]]) await canvas.click({position:{x:box.width*x,y:box.height*y}});
  await review.getByRole('button',{name:'Close outline',exact:true}).click();
  await review.getByRole('button',{name:`Approve ${object} in this frame`,exact:true}).click();
 }
 await trace('cup',.1,.35);
 await review.getByLabel('Review frame',{exact:true}).fill('1');
 await review.getByRole('button',{name:'Mark cup absent in this frame',exact:true}).click();
 await expect(render).toBeEnabled();
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 await page.reload();
 await page.getByRole('tab',{name:'Review',exact:true}).click();
 await review.getByRole('button',{name:'Review video masks',exact:true}).click();
 await expect(render).toBeEnabled();
 await review.getByLabel('Review frame',{exact:true}).fill('1');
 await expect(review).toContainText('Object absent');
 await review.getByRole('button',{name:'umbrella',exact:true}).click();
 await expect(render).toBeDisabled();
 await trace('umbrella',.6,.85);
 await review.getByLabel('Review frame',{exact:true}).fill('0');
 await trace('umbrella',.6,.85);
 await expect(render).toBeEnabled();
 await review.getByRole('button',{name:'Add brush',exact:true}).click();
 const editedCanvas=review.getByRole('img',{name:'Umbrella selection canvas',exact:true});
 await editedCanvas.scrollIntoViewIfNeeded();
 const editedBox=await editedCanvas.boundingBox();if(!editedBox)throw new Error('Missing canvas');
 await editedCanvas.click({position:{x:editedBox.width*.8,y:editedBox.height*.5}});
 await expect(render).toBeDisabled();
 await review.getByRole('button',{name:'Approve umbrella in this frame',exact:true}).click();
 await expect(render).toBeEnabled();
 if(mode==='command'){
  await review.getByRole('button',{name:'Close video mask review',exact:true}).click();
  await page.getByRole('tab',{name:'Create',exact:true}).click();
  const beforeCommand=await readLibrary(page);
  const beforeShots=beforeCommand.projects.find((p:any)=>p.projectId===beforeCommand.active).shots;
  await page.getByPlaceholder('Describe your scene or an edit...', {exact:true}).fill('track video cup');
  await page.getByRole('button',{name:'Apply direction',exact:true}).click();
  await expect(page.locator('.clean-studio')).toContainText('Tracking does not recolor');
  expect(submitted).toBeUndefined();
  const afterCommand=await readLibrary(page);
  expect(afterCommand.projects.find((p:any)=>p.projectId===afterCommand.active).shots).toEqual(beforeShots);
  await page.getByPlaceholder('Describe your scene or an edit...', {exact:true}).fill('recolor video cup to purple');
  await page.getByRole('button',{name:'Apply direction',exact:true}).click();
  await expect.poll(()=>Boolean(submitted)).toBe(true);
  await expect(page.getByRole('button',{name:'New project',exact:true})).toBeDisabled();
  await expect(page.getByLabel('Switch project',{exact:true})).toBeDisabled();
  release();
 }else await render.click();
 if(mode==='switch') {
  await expect.poll(()=>Boolean(submitted)).toBe(true);
  await page.getByRole('button',{name:'New project',exact:true}).click();
  await expect(page.getByRole('heading',{name:'What would you like to create?',exact:true})).toBeVisible();
  release();
  await expect.poll(()=>aborted).toBe(true);
  const state=await readLibrary(page),current=state.projects.find((p:any)=>p.projectId===state.active);
  expect(current.shots).toHaveLength(0);
  expect(state.projects.flatMap((p:any)=>p.shots).some((shot:any)=>shot.generatedJobId===correctedId)).toBe(false);
  return;
 }
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 await expect.poll(async()=>{const library=await readLibrary(page);return library.projects.find((p:any)=>p.projectId===library.active).shots[1].generatedJobId;}).toBe(correctedId);
 expect(submitted.tracks.map((t:any)=>t.objectId)).toEqual(mode==='command'?['cup']:['cup','umbrella']);
 if(mode==='command')expect(submitted.tracks[0].color).toBe('purple');
 expect(submitted.tracks[0].frames[1]).toMatchObject({absent:true,reviewed:true});
 expect(submitted.tracks.every((t:any)=>t.frames.every((f:any)=>f.reviewed&&f.sourceHash===sourceHash))).toBe(true);
 const library=await readLibrary(page),shot=library.projects.find((p:any)=>p.projectId===library.active).shots[1];
 expect(shot.revisions.some((take:any)=>take.generatedJobId===jobId)).toBe(true);
 expect(shot.status).toBe('uncertain');
 await page.getByRole('tab',{name:'Review',exact:true}).click();
 await page.getByRole('button',{name:'Take 2',exact:true}).click();
 await review.getByRole('button',{name:'Review video masks',exact:true}).click();
 await expect(render).toBeEnabled();
 await review.getByRole('button',{name:'Close video mask review',exact:true}).click();
 await page.route('**/api/local-ai/jobs/*/frames',route=>route.fulfill({json:{...manifest,frames:manifest.frames.map(f=>({...f,width:32}))}}));
 await review.getByRole('button',{name:'Review video masks',exact:true}).click();
 await expect(review.getByRole('alert')).toContainText('Mask dimensions do not match');
 await expect(review.getByRole('img',{name:'Cup selection canvas',exact:true})).toHaveCount(0);
 const retained=await readLibrary(page);
 expect(retained.projects.find((p:any)=>p.projectId===retained.active).shots[1].videoMaskPlan.tracks).toHaveLength(2);
});


for (const width of [1440,390]) test(`browser selections produce a real corrected MP4 at ${width}px without changing the source`,async({page})=>{
 await page.setViewportSize({width,height:width===390?844:1080});
 test.setTimeout(120000);
 const workspace=mkdtempSync(path.join(tmpdir(),'anchorshot-browser-render-'));
 const fixture=await videoFixture(workspace),service=createLocalAi(workspace);
 const server=service.app.listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));
 const address=server.address();if(!address||typeof address==='string')throw new Error('Missing service port');
 const origin=`http://127.0.0.1:${address.port}`;
 const before=new Map(readdirSync(fixture.folder).map(file=>[file,sha(readFileSync(path.join(fixture.folder,file)))]));
 try {
  await page.route('**/api/local-ai/**',async route=>{
   const incoming=route.request(),url=new URL(incoming.url());
   const response=await fetch(origin+url.pathname.replace('/api/local-ai',''),{method:incoming.method(),headers:{'Content-Type':'application/json','X-Anchorshot-Local':'1'},body:incoming.method()==='POST'?incoming.postData():undefined});
   await route.fulfill({status:response.status,contentType:response.headers.get('content-type')||'application/octet-stream',body:Buffer.from(await response.arrayBuffer())});
  });
  await page.goto('/');await createStory(page);await applyVideo(page);
  const review=page.getByRole('region',{name:'Video mask review',exact:true});
  await review.getByRole('button',{name:'Review video masks',exact:true}).click();
  for(const object of ['cup','umbrella'] as const){
   await review.getByRole('button',{name:object,exact:true}).click();
   for(let index=0;index<5;index++){
    await review.getByLabel('Review frame',{exact:true}).fill(String(index));
    if(object==='cup'&&index===2){await review.getByRole('button',{name:'Mark cup absent in this frame',exact:true}).click();continue;}
    const canvas=review.getByRole('img',{name:`${object==='cup'?'Cup':'Umbrella'} selection canvas`,exact:true});
    await canvas.scrollIntoViewIfNeeded();
    await expect(review.getByText(`Frame ${index+1} / 5`,{exact:true})).toBeVisible();
    const box=await canvas.boundingBox();if(!box)throw new Error('Missing frame canvas');
    const points=object==='cup'?[[19+index*5,55],[32+index*5,55],[32+index*5,78],[19+index*5,78]]:[[85-index*2,25],[99-index*2,25],[99-index*2,32],[85-index*2,32]];
    for(const [x,y] of points)await canvas.click({position:{x:x/128*box.width,y:y/96*box.height}});
    await review.getByRole('button',{name:'Close outline',exact:true}).click();
    await review.getByRole('button',{name:`Approve ${object} in this frame`,exact:true}).click();
   }
  }
  await review.getByLabel('Video correction colour',{exact:true}).selectOption('white');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth+1)).toBe(true);
  await page.screenshot({path:`.artifacts/video-review-${width}.png`});
  await review.getByRole('button',{name:'Create corrected take',exact:true}).click();
  let correctedId='';
  await expect.poll(async()=>{const library=await readLibrary(page);correctedId=library.projects.find((p:any)=>p.projectId===library.active).shots[1].generatedJobId;return correctedId;}).not.toBe(fixture.id);
  const folder=path.join(workspace,'.artifacts/local-ai/ui-jobs',correctedId);
  const report=JSON.parse(readFileSync(path.join(folder,'modification-report.json'),'utf8'));
  expect(report).toMatchObject({frames:5,rawChangedOutside:0,semanticContinuity:'unverified'});
  expect(report.objects.map((o:any)=>o.visibleFrames)).toEqual([4,5]);
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames,width,height','-of','json',path.join(folder,'generated-video.mp4')],{windowsHide:true}).toString());
  expect(probe.streams[0]).toMatchObject({nb_read_frames:'5',width:128,height:96});
  for(const [file,hash] of before)expect(sha(readFileSync(path.join(fixture.folder,file)))).toBe(hash);
 } finally {
  await page.unroute('**/api/local-ai/**');service.stop();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  if(!workspace.startsWith(path.join(tmpdir(),'anchorshot-browser-render-')))throw new Error('Unsafe fixture cleanup');
  rmSync(workspace,{recursive:true,force:true});
 }
});


for(const width of [1440,390]) test(`local narration survives refresh and is audible in the downloaded MP4 at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:width===390?844:1080});
 test.setTimeout(120000);
 const audio=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=4','-f','wav','pipe:1'],{windowsHide:true});
 await page.goto('/');await createStory(page);
 await page.getByRole('tab',{name:'Review',exact:true}).click();
 await page.getByLabel('Upload scene narration',{exact:true}).setInputFiles({name:'local-story.wav',mimeType:'audio/wav',buffer:audio});
 await expect(page.getByRole('region',{name:'Scene narration'})).toContainText('local-story.wav');
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 await page.reload();await page.getByRole('tab',{name:'Review',exact:true}).click();
 await expect(page.getByLabel('Preview scene narration',{exact:true})).toHaveAttribute('src',/^data:audio\/wav;base64,/);
 const library=await readLibrary(page),shot=library.projects.find((p:any)=>p.projectId===library.active).shots[1];
 expect(shot.durationSeconds).toBeGreaterThanOrEqual(4.4);
 // A half-second trim near the audio boundary must clamp to 4.4, not cut it to 4.1.
 await page.getByLabel('DURATION (S):',{exact:true}).fill('4.6');
 await page.getByRole('button',{name:'Update Shot',exact:true}).click();
 await page.getByRole('tab',{name:'Create',exact:true}).click();
 await page.getByRole('button',{name:'Decrease duration of shot 2',exact:true}).click();
 await expect(page.getByRole('button',{name:'Decrease duration of shot 2',exact:true})).toBeDisabled();
 await expect.poll(async()=>{const saved=await readLibrary(page);return saved.projects.find((p:any)=>p.projectId===saved.active).shots[1].durationSeconds;}).toBe(4.4);
 const trimmed=await readLibrary(page);const trimmedShot=trimmed.projects.find((p:any)=>p.projectId===trimmed.active).shots[1];
 expect(trimmedShot.narrationDataUrl).toBe(shot.narrationDataUrl);
 expect(trimmedShot.currentImageUrl).toBe(shot.currentImageUrl);
 expect(trimmedShot.proposedFix).toEqual(shot.proposedFix);
 await page.getByRole('tab',{name:'Review',exact:true}).click();

 await page.getByLabel('Upload scene narration',{exact:true}).setInputFiles({name:'broken.wav',mimeType:'audio/wav',buffer:Buffer.from('not audio')});
 await expect(page.getByRole('region',{name:'Scene narration'}).getByRole('alert')).toContainText('could not be decoded');
 await expect(page.getByLabel('Preview scene narration',{exact:true})).toHaveAttribute('src',shot.narrationDataUrl);

 await page.getByRole('tab',{name:'Create',exact:true}).click();
 await page.getByRole('button',{name:'Select shot 2',exact:true}).click();
 const narration=page.locator('audio[aria-label="Film narration"]');
 await narration.evaluate((audio:HTMLAudioElement)=>{(audio as any).__originalPlay=audio.play;(audio as any).__attempts=0;audio.play=()=>{(audio as any).__attempts++;return Promise.reject(new DOMException('Blocked test narration','NotAllowedError'));};});
 await page.getByRole('button',{name:'Play timeline',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'Narration playback could not start'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Play timeline',exact:true})).toBeVisible();
 expect(await narration.evaluate(audio=>(audio as any).__attempts)).toBe(1);
 await narration.evaluate((audio:HTMLAudioElement)=>{audio.play=(audio as any).__originalPlay;});
 await page.getByRole('button',{name:'Play timeline',exact:true}).click();
 await expect.poll(()=>narration.evaluate((a:HTMLAudioElement)=>!a.paused&&a.currentTime>.15)).toBe(true);
 await expect(page.getByRole('alert').filter({hasText:'Narration playback could not start'})).toHaveCount(0);
 await page.getByRole('button',{name:'Pause timeline',exact:true}).click();
 await expect.poll(()=>narration.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
 await page.getByRole('button',{name:'Mute spoken feedback',exact:true}).click();
 await expect.poll(()=>narration.evaluate((a:HTMLAudioElement)=>a.muted)).toBe(true);
 await page.getByRole('button',{name:'Enable spoken feedback',exact:true}).click();
 await expect.poll(()=>narration.evaluate((a:HTMLAudioElement)=>a.muted)).toBe(false);

 const seek=page.getByRole('slider',{name:'Preview time',exact:true});
 await seek.focus();for(let i=0;i<5;i++)await seek.press('ArrowRight');
 const expectedOffset=Number(await seek.getAttribute('aria-valuenow'))-4;
 await expect.poll(()=>narration.evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeCloseTo(expectedOffset,0);
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:/^Export (film|MP4)$/}).click();
 const download=await downloaded,folder=mkdtempSync(path.join(tmpdir(),'anchorshot-narration-export-'));
 try {
  const file=path.join(folder,'film.mp4');await download.saveAs(file);
  const pcm=execFileSync('ffmpeg',['-v','error','-ss','4.5','-i',file,'-t','0.2','-vn','-ac','1','-f','s16le','-'],{windowsHide:true});
  let sum=0;for(let i=0;i<pcm.length;i+=2)sum+=(pcm.readInt16LE(i)/32768)**2;
  expect(Math.sqrt(sum/(pcm.length/2))).toBeGreaterThan(.03);
 } finally {if(!folder.startsWith(path.join(tmpdir(),'anchorshot-narration-export-')))throw new Error('Unsafe cleanup');rmSync(folder,{recursive:true,force:true});}
 await narration.evaluate((audio:HTMLAudioElement)=>{audio.play=()=>new Promise<void>((_resolve,reject)=>{(window as any).__rejectOldNarration=reject;});});
 await page.getByRole('button',{name:'Play timeline',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>typeof(window as any).__rejectOldNarration)).toBe('function');
 await page.getByRole('button',{name:'Select shot 1',exact:true}).click();
 await expect(narration).toHaveCount(0);
 await page.evaluate(async()=>{(window as any).__rejectOldNarration(new Error('Late old scene failure'));await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
 await expect(page.getByRole('alert').filter({hasText:'Narration playback could not start'})).toHaveCount(0);
 await page.getByRole('button',{name:'Select shot 2',exact:true}).click();
 await page.getByRole('tab',{name:'Review',exact:true}).click();
 await page.getByRole('button',{name:'Remove narration',exact:true}).click();
 await expect(page.getByLabel('Preview scene narration',{exact:true})).toHaveCount(0);
 await page.getByRole('tab',{name:'Create',exact:true}).click();
 await page.getByRole('button',{name:'Select shot 1',exact:true}).click();
 await expect(page.locator('audio[aria-label="Film narration"]')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);

});


test('generative command failure preserves scenes and retry applies only the requested scene',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 let calls=0,submitted:any;
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 const edited='data:image/png;base64,'+(await sharp({create:{width:800,height:450,channels:4,background:'#bbbbbb'}}).png().toBuffer()).toString('base64');
 await page.route('**/api/meta/edit-frame',async route=>{
  calls++;submitted=route.request().postDataJSON();
  if(calls===1)return route.fulfill({status:501,json:{error:'No image model is connected.'}});
  await gate;
  return route.fulfill({json:{editedImageUrl:edited,changedInside:16,selectedPixels:16,totalPixels:360000,outsideDrift:0,outsideDriftPercent:'0.00',verified:true,model:'test-fixture',provenance:'test'}});
 });
 await page.goto('/');await createStory(page);
 const initial=await readLibrary(page),before=initial.projects.find((p:any)=>p.projectId===initial.active);
 const send=async()=>{await page.getByPlaceholder('Describe your scene or an edit...', {exact:true}).fill('generative edit: add steam to the cup');await page.getByRole('button',{name:'Apply direction',exact:true}).click();};
 await send();
 await expect(page.locator('.clean-studio')).toContainText('Generative edit failed: No image model is connected.');
 await expect(page.getByRole('button',{name:'New project',exact:true})).toBeEnabled();
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const failed=await readLibrary(page);
 expect(failed.projects.find((p:any)=>p.projectId===failed.active).shots).toEqual(before.shots);
 expect(errors).toEqual([]);
 await send();await expect.poll(()=>calls).toBe(2);
 await expect(page.getByRole('button',{name:'New project',exact:true})).toBeDisabled();
 // Mutation shortcuts must not start competing edits or release the pending lock.
 await page.locator('body').click({position:{x:2,y:150}});
 await page.keyboard.press('y');
 await page.waitForTimeout(300);
 await expect(page.getByRole('button',{name:'New project',exact:true})).toBeDisabled();
 for(const key of ['a','g','t',']','Alt+ArrowLeft']) await page.keyboard.press(key);
 await page.waitForTimeout(300);
 await expect(page.getByRole('button',{name:'New project',exact:true})).toBeDisabled();
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const pending=await readLibrary(page);
 expect(pending.projects.find((p:any)=>p.projectId===pending.active).shots).toEqual(before.shots);
 // Selecting another shot must not redirect the pending result to it.
 await page.getByRole('button',{name:'Select shot 1',exact:true}).click();
 release();
 await expect(page.getByRole('button',{name:'New project',exact:true})).toBeEnabled();
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const saved=await readLibrary(page),after=saved.projects.find((p:any)=>p.projectId===saved.active);
 expect(submitted.imageBase64).toBe(before.shots[1].currentImageUrl);
 expect(submitted.maskBase64).toMatch(/^data:image\/png;base64,/);
 expect(after.shots[1].currentImageUrl).toBe(edited);
 expect(after.shots[1].status).toBe('uncertain');
 expect(after.shots[1].revisions.at(-1).mediaSource).toBe('generated');
 for(const i of [0,2,3])expect(after.shots[i]).toEqual(before.shots[i]);
 expect(errors).toEqual([]);
});


test('video evidence failure unlocks retry and results cannot modify other scenes',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await mockVideo(page);
 let calls=0,body:any;let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/meta/video-understand',async route=>{
  calls++;body=route.request().postDataJSON();
  if(calls===1)return route.fulfill({status:503,json:{error:'Review temporarily unavailable'}});
  await gate;
  const finding={status:'uncertain',targetObject:'cup',ruleId:'rule-cup-color',expectedValue:'blue',confidence:0,explanation:'No semantic measurement',proposedAction:'recolor'};
  return route.fulfill({json:{findings:[{...finding,shotIndex:1},{...finding,shotIndex:0}],detectedObjects:[],scenes:[]}});
 });
 await page.goto('/');await createStory(page);await applyVideo(page);
 const initial=await readLibrary(page),before=initial.projects.find((p:any)=>p.projectId===initial.active);
 const button=page.getByRole('button',{name:'Review video evidence',exact:true});
 await button.click();
 await expect(page.locator('.clean-studio')).toContainText('Review temporarily unavailable');
 await expect(button).toBeEnabled();
 await expect(page.getByRole('button',{name:'New project',exact:true})).toBeEnabled();
 await button.click();await expect.poll(()=>calls).toBe(2);
 await expect(button).toBeDisabled();
 await expect(page.getByLabel('Switch project',{exact:true})).toBeDisabled();
 release();await expect(button).toBeEnabled();
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const saved=await readLibrary(page),after=saved.projects.find((p:any)=>p.projectId===saved.active);
 expect(body).toMatchObject({jobId,shotIndex:1});
 expect(after.shots[1].discrepancyMessage).toContain('No semantic measurement');
 expect(after.shots[1].videoUrl).toBe(before.shots[1].videoUrl);
 for(const i of [0,2,3])expect(after.shots[i]).toEqual(before.shots[i]);
 expect(errors).toEqual([]);
});


for(const operation of ['edit-frame','video-understand'] as const)test(`${operation} request aborts on React unmount without changing saved scenes`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/src/main.tsx',async route=>{
  const response=await route.fetch();
  await route.fulfill({response,body:(await response.text())+'\nwindow.__auditUnmount = () => root.unmount();\n'});
 });
 await page.addInitScript((operation)=>{
  const original=window.fetch.bind(window);
  (window as any).__auditAborted=false;
  window.fetch=(input,init)=>{
   if(String(input).endsWith('/api/meta/'+operation))init?.signal?.addEventListener('abort',()=>{(window as any).__auditAborted=true;},{once:true});
   return original(input,init);
  };
 },operation);
 if(operation==='video-understand')await mockVideo(page);
 let started=false;let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route(`**/api/meta/${operation}`,async route=>{
  started=true;await gate;
  await route.fulfill({status:503,json:{error:'Delayed response after unmount'}}).catch(()=>{});
 });
 await page.goto('/');await createStory(page);
 if(operation==='video-understand')await applyVideo(page);
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const before=await readLibrary(page),scenes=before.projects.find((p:any)=>p.projectId===before.active).shots;
 if(operation==='video-understand')await page.getByRole('button',{name:'Review video evidence',exact:true}).click();
 else{
  await page.getByPlaceholder('Describe your scene or an edit...', {exact:true}).fill('generative edit: add steam to the cup');
  await page.getByRole('button',{name:'Apply direction',exact:true}).click();
 }
 await expect.poll(()=>started).toBe(true);
 await page.evaluate(()=>(window as any).__auditUnmount());
 await expect.poll(()=>page.evaluate(()=>(window as any).__auditAborted)).toBe(true);
 await expect(page.locator('#root')).toBeEmpty();
 release();
 // Drain the application's persistence queue after React cleanup and request rejection.
 await page.evaluate(async()=>{const storage=await import('/src/services/projectStorage.ts');await storage.flushLocalSaves();});
 const after=await readLibrary(page);
 expect(after.projects.find((p:any)=>p.projectId===after.active).shots).toEqual(scenes);
 expect(errors).toEqual([]);
});


for(const variant of ['stale','missing-source','sample-on-generated','ambiguous'] as const)test(`generative edit rejects ${variant} mask before any request`,async({page})=>{
 let requests=0;await page.route('**/api/meta/edit-frame',route=>{requests++;return route.fulfill({status:500,json:{error:'Must not reach provider'}});});
 await page.goto('/');await createStory(page);
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const library=await readLibrary(page),project=library.projects.find((p:any)=>p.projectId===library.active),shot=project.shots[1];
 expect(shot.proposedFix.mask.maskBase64).toMatch(/^data:image/);
 if(variant==='stale')shot.proposedFix.mask.sourceImageUrl=project.shots[0].currentImageUrl;
 if(variant==='missing-source')delete shot.proposedFix.mask.sourceImageUrl;
 if(variant==='sample-on-generated'){shot.mediaSource='generated';shot.proposedFix.mask.provenance='offline-fixture';}
 if(variant==='ambiguous')shot.proposedFix.mask.candidateCount=2;
 await page.evaluate(async(library)=>{const storage=await import('/src/services/projectStorage.ts');await storage.saveLocal('library',library);await storage.flushLocalSaves();},library);
 await page.reload();await expect(page.getByRole('region',{name:'Film preview'})).toBeVisible();
 const before=await readLibrary(page);
 await page.getByPlaceholder('Describe your scene or an edit...', {exact:true}).fill('generative edit: add steam to the cup');
 await page.getByRole('button',{name:'Apply direction',exact:true}).click();
 const expected=variant==='ambiguous'?'Confirm one object before editing':variant==='sample-on-generated'?'Sample masks cannot be used':'Select the object in the current frame again';
 await expect(page.locator('.clean-studio')).toContainText(expected);
 await expect(page.getByRole('button',{name:'New project',exact:true})).toBeEnabled();
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const after=await readLibrary(page);
 expect(after.projects.find((p:any)=>p.projectId===after.active).shots).toEqual(before.projects.find((p:any)=>p.projectId===before.active).shots);
 expect(requests).toBe(0);
});


test('recolor command records the matching color rule revision rather than the first rule',async({page})=>{
 await page.goto('/');await createStory(page);await expect(page.locator('.local-label')).toContainText('Saved locally');
 const library=await readLibrary(page),project=library.projects.find((p:any)=>p.projectId===library.active);
 const color=project.rules.find((r:any)=>r.targetObject==='cup'&&r.property==='color');
 expect(color).toBeTruthy();color.revision=7;
 project.rules=[{id:'unrelated-presence',scope:'all_shots',targetObject:'cup',property:'spatial',expectedValue:'present',revision:99},color];
 const sources=project.shots.map((s:any)=>s.currentImageUrl);
 await page.evaluate(async library=>{const storage=await import('/src/services/projectStorage.ts');await storage.saveLocal('library',library);await storage.flushLocalSaves();},library);
 await page.reload();await page.getByPlaceholder('Describe your scene or an edit...', {exact:true}).fill('recolor cup in shot 2 to purple');
 await page.getByRole('button',{name:'Apply direction',exact:true}).click();
 await expect(page.locator('.clean-studio')).toContainText('Recoloured the cup to purple in 1 of 1 shots');
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const saved=await readLibrary(page),after=saved.projects.find((p:any)=>p.projectId===saved.active);
 expect(after.rules.find((r:any)=>r.targetObject==='cup'&&r.property==='color').revision).toBe(8);
 expect(after.shots[1].pixelVerification.ruleRevision).toBe(8);
 for(const i of [0,2,3])expect(after.shots[i].currentImageUrl).toBe(sources[i]);
});


test('missing and invalid scene commands leave all scenes and rules unchanged',async({page})=>{
 await page.goto('/');await createStory(page);await expect(page.locator('.local-label')).toContainText('Saved locally');
 const library=await readLibrary(page),before=library.projects.find((p:any)=>p.projectId===library.active);
 for(const command of ['fix shot 10','make cup purple in shot 99','fix shot 0','fix scene 2.5']){
  await page.getByPlaceholder('Describe your scene or an edit...', {exact:true}).fill(command);
  await page.getByRole('button',{name:'Apply direction',exact:true}).click();
  await expect(page.locator('.clean-studio')).toContainText(command.includes('10')?'There is no shot 10':command.includes('99')?'There is no shot 99':'Use a positive whole scene number');
  await expect(page.locator('.local-label')).toContainText('Saved locally');
  const saved=await readLibrary(page),after=saved.projects.find((p:any)=>p.projectId===saved.active);
  expect(after.shots).toEqual(before.shots);expect(after.rules).toEqual(before.rules);
 }
});


test('generated-frame segmentation command stays offline when no provider is connected',async({page})=>{
 await mockVideo(page);let requests=0;
 await page.route('**/api/segment/check',route=>{requests++;return route.fulfill({status:500,json:{error:'Unexpected model call'}});});
 await page.goto('/');await createStory(page);await applyVideo(page);
 const library=await readLibrary(page),before=library.projects.find((p:any)=>p.projectId===library.active);
 await page.getByRole('tab',{name:'Create',exact:true}).click();
 await page.getByPlaceholder('Describe your scene or an edit...', {exact:true}).fill('segment cup in shot 2');
 await page.getByRole('button',{name:'Apply direction',exact:true}).click();
 await expect(page.locator('.clean-studio')).toContainText('No real segmentation provider is connected');
 await expect(page.getByRole('button',{name:'New project',exact:true})).toBeEnabled();
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const saved=await readLibrary(page);
 expect(saved.projects.find((p:any)=>p.projectId===saved.active).shots).toEqual(before.shots);
 expect(requests).toBe(0);
});


test('delayed continuity review cannot overwrite a newer scene duration',async({page})=>{
 await page.goto('/');await createStory(page);
 await page.evaluate(async()=>{
  const {metaModelClient}=await import('/src/services/metaModels.ts' as string);
  const original=metaModelClient.auditAllShots.bind(metaModelClient);const w=window as any;
  const gate=new Promise<void>(resolve=>w.__releaseAudit=resolve);
  metaModelClient.auditAllShots=async(...args:any[])=>{w.__auditStarted=true;await gate;return original(...args);};
 });
 const before=await readLibrary(page),project=before.projects.find((p:any)=>p.projectId===before.active);
 await page.locator('body').click({position:{x:2,y:150}});await page.keyboard.press('a');
 await page.waitForFunction(()=>Boolean((window as any).__auditStarted));
 await page.getByRole('button',{name:'Increase duration of shot 2',exact:true}).click();
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const edited=await readLibrary(page);
 expect(edited.projects.find((p:any)=>p.projectId===edited.active).shots[1].durationSeconds).toBe(project.shots[1].durationSeconds+0.5);
 await page.evaluate(()=>(window as any).__releaseAudit());
 await expect(page.getByRole('button',{name:'New project',exact:true})).toBeEnabled();
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const after=await readLibrary(page);
 const afterShots=after.projects.find((p:any)=>p.projectId===after.active).shots;
 const editedShots=edited.projects.find((p:any)=>p.projectId===edited.active).shots;
 expect(afterShots[1].durationSeconds).toBe(editedShots[1].durationSeconds);
 expect(sha(Buffer.from(JSON.stringify(afterShots)))).toBe(sha(Buffer.from(JSON.stringify(editedShots))));
 await expect(page.locator('.clean-studio')).toContainText('changed during the continuity check');
 await page.locator('body').click({position:{x:2,y:150}});await page.keyboard.press('a');
 await expect(page.locator('.clean-studio')).toContainText('Continuity Audit found');
 await expect(page.getByRole('button',{name:'New project',exact:true})).toBeEnabled();
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const rechecked=await readLibrary(page);
 const recheckedShots=rechecked.projects.find((p:any)=>p.projectId===rechecked.active).shots;
 expect(recheckedShots[1].durationSeconds).toBe(editedShots[1].durationSeconds);
 expect(recheckedShots[1].continuityChecks.length).toBeGreaterThan(0);

});


test('delayed mask correction preserves a newer scene edit and supports retry',async({page})=>{
 await page.goto('/');await createStory(page);
 await page.evaluate(async()=>{
  const {metaModelClient}=await import('/src/services/metaModels.ts' as string);
  const original=metaModelClient.applyContinuityFix.bind(metaModelClient);const w=window as any;
  const gate=new Promise<void>(resolve=>w.__releaseCorrection=resolve);
  metaModelClient.applyContinuityFix=async(...args:any[])=>{w.__correctionStarted=true;await gate;return original(...args);};
 });
 await page.locator('body').click({position:{x:2,y:150}});await page.keyboard.press('y');
 await page.waitForFunction(()=>Boolean((window as any).__correctionStarted));
 await page.getByRole('button',{name:'Increase duration of shot 2',exact:true}).click();
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const edited=await readLibrary(page),editedShots=edited.projects.find((p:any)=>p.projectId===edited.active).shots;
 await page.evaluate(()=>(window as any).__releaseCorrection());
 await expect(page.getByRole('button',{name:'New project',exact:true})).toBeEnabled();
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const after=await readLibrary(page),afterShots=after.projects.find((p:any)=>p.projectId===after.active).shots;
 expect(afterShots[1].durationSeconds).toBe(editedShots[1].durationSeconds);
 expect(sha(Buffer.from(JSON.stringify(afterShots)))).toBe(sha(Buffer.from(JSON.stringify(editedShots))));
 await expect(page.locator('.clean-studio')).toContainText('changed during correction');
 await page.locator('body').click({position:{x:2,y:150}});await page.keyboard.press('y');
 await expect(page.locator('.clean-studio')).toContainText('recolored to blue');
 await expect(page.getByRole('button',{name:'New project',exact:true})).toBeEnabled();
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const retry=await readLibrary(page),shots=retry.projects.find((p:any)=>p.projectId===retry.active).shots;
 expect(shots[1].durationSeconds).toBe(editedShots[1].durationSeconds);
 expect(shots[1].revisions).toHaveLength(editedShots[1].revisions.length+1);
 expect(shots[1].pixelVerification.passed).toBe(true);
 for(const i of [0,2,3])expect(sha(Buffer.from(JSON.stringify(shots[i])))).toBe(sha(Buffer.from(JSON.stringify(editedShots[i]))));
});


for (const story of ['A courier rides through a market.', 'An occupied room with a cupboard and a carpet.']) test(`offline story without a continuity object renders no fallback cup: ${story}`,async({page})=>{
 await page.goto('/');
 await page.getByPlaceholder('Describe your scene or an edit...', {exact:true}).fill(story);
 await page.getByRole('button',{name:'Apply direction',exact:true}).click();
 await expect(page.getByRole('region',{name:'Film preview'})).toBeVisible();
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const library=await readLibrary(page),project=library.projects.find((p:any)=>p.projectId===library.active);
 expect(project.rules).toEqual([]);
 expect(project.shots.every((s:any)=>s.status==='uncertain'&&!s.proposedFix)).toBe(true);
 expect(project.shots.map((s:any)=>s.spokenDescription).join(' ')).not.toMatch(/\bcup\b/i);
 const rendered=await page.evaluate(async()=>{
  const {renderMuseStoryboardFrame}=await import('/src/services/canvasEngine.ts' as string);
  const spec={shotNumber:1,cameraAngle:'wide',settingTitle:'Studio Stage',targetObject:'',objectColorName:'',weatherOrMood:'rain_noir',characterPose:'seated_detective',seed:17};
  return {empty:renderMuseStoryboardFrame(spec),cup:renderMuseStoryboardFrame({...spec,targetObject:'cup',objectColorName:'blue'})};
 });
 expect(rendered.empty.box).toEqual({x:0,y:0,width:0,height:0});
 expect(sha(Buffer.from(project.shots[0].currentImageUrl))).toBe(sha(Buffer.from(rendered.empty.imageUrl)));
 expect(rendered.empty.imageUrl===rendered.cup.imageUrl).toBe(false);
 await page.screenshot({path:path.join(tmpdir(),'anchorshot-no-cup-preview.png')});
});


for(const command of ['the cup must stay purple in every shot','make the cup purple'])test(`stale rule update stops without recoloring: ${command}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');await createStory(page);
 const initial=await readLibrary(page),initialProject=initial.projects.find((p:any)=>p.projectId===initial.active);
 await page.evaluate(async()=>{
  const {metaModelClient}=await import('/src/services/metaModels.ts' as string);const w=window as any;
  const original=metaModelClient.auditAllShots.bind(metaModelClient);
  const gate=new Promise<void>(resolve=>w.__releaseRuleAudit=resolve);
  metaModelClient.auditAllShots=async(...args:any[])=>{w.__ruleAuditStarted=true;await gate;return original(...args);};
 });
 await page.getByPlaceholder('Describe your scene or an edit...', {exact:true}).fill(command);
 await page.getByRole('button',{name:'Apply direction',exact:true}).click();
 await page.waitForFunction(()=>Boolean((window as any).__ruleAuditStarted));
 await page.getByRole('button',{name:'Increase duration of shot 2',exact:true}).click();
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const edited=await readLibrary(page),editedShots=edited.projects.find((p:any)=>p.projectId===edited.active).shots;
 await page.evaluate(()=>(window as any).__releaseRuleAudit());
 await expect(page.getByRole('button',{name:'New project',exact:true})).toBeEnabled();
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const saved=await readLibrary(page),project=saved.projects.find((p:any)=>p.projectId===saved.active);
 expect(project.shots[1].durationSeconds).toBe(editedShots[1].durationSeconds);
 expect(sha(Buffer.from(JSON.stringify(project.shots)))).toBe(sha(Buffer.from(JSON.stringify(editedShots))));
 expect(project.rules).toEqual(initialProject.rules);
 await expect(page.locator('.clean-studio')).toContainText('changed during the rule update');
 expect(errors).toEqual([]);
});


test('unsupported offline dress is not drawn as a cup or assigned a fabricated mask',async({page})=>{
 await page.goto('/');
 await page.getByPlaceholder('Describe your scene or an edit...', {exact:true}).fill('A blue dress floats over the ocean.');
 await page.getByRole('button',{name:'Apply direction',exact:true}).click();
 await expect(page.getByRole('region',{name:'Film preview'})).toBeVisible();
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const saved=await readLibrary(page),project=saved.projects.find((p:any)=>p.projectId===saved.active);
 expect(project.rules[0].targetObject).toBe('dress');
 expect(project.shots.every((s:any)=>s.status==='uncertain'&&!s.proposedFix)).toBe(true);
 expect(project.shots[0].spokenDescription).toContain('dress is not rendered');
 const rendered=await page.evaluate(async()=>{
  const {renderMuseStoryboardFrame}=await import('/src/services/canvasEngine.ts' as string);
  const spec={shotNumber:1,cameraAngle:'wide',settingTitle:'Studio Stage',targetObject:'',objectColorName:'blue',weatherOrMood:'rain_noir',characterPose:'seated_detective',seed:17};
  return {empty:renderMuseStoryboardFrame(spec),dress:renderMuseStoryboardFrame({...spec,targetObject:'dress'})};
 });
 expect(rendered.dress.box).toEqual({x:0,y:0,width:0,height:0});
 expect(sha(Buffer.from(project.shots[0].currentImageUrl))).toBe(sha(Buffer.from(rendered.empty.imageUrl)));
 const error=await page.evaluate(async()=>{
  const {metaModelClient}=await import('/src/services/metaModels.ts' as string);
  try{await metaModelClient.segmentObjectWithSam3(1,'dress');return 'unexpected mask';}catch(e){return String(e);}
 });
 expect(error).toContain('No offline sample mask exists for dress');
});
