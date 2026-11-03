import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';

test('local dream preserves cup, scrubs, exports and cancels without model calls',async({page})=>{
  test.setTimeout(90000);
  const errors:string[]=[], posts:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
  await page.goto('/');await page.getByRole('textbox',{name:'Describe your video or edit'}).fill('A kitchen opens onto an ocean. A blue cup stays in place.');await page.getByRole('button',{name:'Apply direction',exact:true}).click();await page.getByRole('region',{name:'Film preview'}).waitFor();await page.getByRole('tab',{name:'Dream',exact:true}).click();
  await page.getByRole('button',{name:/Open dream transition/}).click();
  const study=page.getByRole('region',{name:'Kitchen to ocean dream study'});
  await expect(study.getByRole('img',{name:/Kitchen transforming/})).toBeVisible();
  await study.getByRole('button',{name:'Check cup preservation'}).click();
  await expect(study.getByRole('status',{name:'Cup preservation results'})).toContainText('PASS · 289 frames · 0 changed protected pixels',{timeout:30000});
  await mkdir('.artifacts/dream-tests',{recursive:true});
  const mask=await page.evaluate(async()=>{
    const modulePath='/src/services/dreamTransition.ts';
    const m=await import(/* @vite-ignore */ modulePath);const bytes:Uint8Array=(await m.loadDreamAssets()).mask;
    let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(binary);
  });
  await writeFile('.artifacts/dream-tests/mask.bin',Buffer.from(mask,'base64'));
  const report=page.waitForEvent('download');await study.getByRole('button',{name:'Save quality report'}).click();
  await (await report).saveAs('.artifacts/dream-tests/quality.json');
  for(const [name,file] of [['Kitchen','kitchen'],['World changing','midpoint'],['Ocean','ocean']]) {
    await study.getByRole('button',{name,exact:true}).click();
    const download=page.waitForEvent('download');await study.getByRole('button',{name:'Save PNG frame'}).click();
    await (await download).saveAs(`.artifacts/dream-tests/${file}.png`);
  }
  await study.getByRole('button',{name:'Show protected region'}).click();
  const unchanged=page.waitForEvent('download');await study.getByRole('button',{name:'Save PNG frame'}).click();
  await (await unchanged).saveAs('.artifacts/dream-tests/ocean-overlay.png');
  await study.getByRole('button',{name:'Hide protected region'}).click();
  await study.getByRole('button',{name:'Play dream'}).click();
  await expect(study.getByRole('button',{name:'Pause dream'})).toBeVisible();
  await page.waitForTimeout(350);
  await study.getByRole('button',{name:'Pause dream'}).click();
  const value=await study.getByRole('slider',{name:'Dream time'}).inputValue();
  await page.waitForTimeout(250);expect(await study.getByRole('slider',{name:'Dream time'}).inputValue()).toBe(value);
  await study.getByRole('button',{name:'Export dream WebM'}).click();
  await study.getByRole('button',{name:'Cancel export'}).click();
  await expect(study.getByRole('alert')).toContainText('cancelled');
  const video=page.waitForEvent('download',{timeout:30000});await study.getByRole('button',{name:'Export dream WebM'}).click();
  await (await video).saveAs('.artifacts/dream-tests/dream.webm');
  await study.getByRole('button',{name:'World changing',exact:true}).click();
  await study.screenshot({path:'.artifacts/dream-tests/study.png'});
  expect(posts).toEqual([]);expect(errors).toEqual([]);
  await writeFile('.artifacts/dream-tests/browser.json',JSON.stringify({errors,posts,playPause:true,exportCancel:true}));
});

test('reduced motion, keyboard scrubbing and mobile layout',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('textbox',{name:'Describe your video or edit'}).fill('A kitchen opens onto an ocean. A blue cup stays in place.');await page.getByRole('button',{name:'Apply direction',exact:true}).click();await page.getByRole('region',{name:'Film preview'}).waitFor();await page.getByRole('tab',{name:'Dream',exact:true}).click();
  await page.getByRole('button',{name:/Open dream transition/}).click();
  const study=page.getByRole('region',{name:'Kitchen to ocean dream study'});
  await expect(study.getByText(/Reduced motion: a cut/)).toBeVisible();
  const picture=study.getByRole('img',{name:/Kitchen transforming/});
  await study.getByRole('button',{name:'Kitchen',exact:true}).click();
  const first=await picture.evaluate((c:HTMLCanvasElement)=>c.toDataURL());
  await study.getByRole('button',{name:'World changing',exact:true}).click();
  const cut=await picture.evaluate((c:HTMLCanvasElement)=>c.toDataURL());
  expect(cut).not.toBe(first);
  await study.getByRole('button',{name:'Ocean',exact:true}).click();
  expect(await picture.evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(cut);
  const slider=study.getByRole('slider',{name:'Dream time'});await slider.focus();await page.keyboard.press('End');
  await expect(slider).toHaveValue('12');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await study.screenshot({path:'.artifacts/dream-tests/mobile.png'});
});


test('missing local background fails closed without export',async({page})=>{
  await page.route('**/dream/ocean.png',route=>route.fulfill({status:404,body:'missing'}));
  await page.goto('/');await page.getByRole('textbox',{name:'Describe your video or edit'}).fill('A kitchen opens onto an ocean. A blue cup stays in place.');await page.getByRole('button',{name:'Apply direction',exact:true}).click();await page.getByRole('region',{name:'Film preview'}).waitFor();await page.getByRole('tab',{name:'Dream',exact:true}).click();await page.getByRole('button',{name:/Open dream transition/}).click();
  const study=page.getByRole('region',{name:'Kitchen to ocean dream study'});
  await expect(study.getByRole('alert')).toContainText('Could not load local dream assets');
  await expect(study.getByRole('button',{name:'Export dream WebM'})).toHaveCount(0);
});

for(const mode of ['hidden-start','already-aborted','constructor','start','progress','hidden-during','capture-gap','early-stop','stop-timeout'])test(`dream export cleans up ${mode} without returning partial video`,async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async(mode)=>{
  const path='/src/services/dreamTransition.ts';const m=await import(path);const assets=await m.loadDreamAssets();
  const Native=window.MediaRecorder,originalStart=Native.prototype.start,originalStop=Native.prototype.stop,originalCapture=HTMLCanvasElement.prototype.captureStream,originalNow=performance.now.bind(performance);
  const tracks:MediaStreamTrack[]=[];let offset=0,hidden=false,bytes=0,message='';const controller=new AbortController();
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
  HTMLCanvasElement.prototype.captureStream=function(...args:Parameters<typeof originalCapture>){const stream=originalCapture.apply(this,args);tracks.push(...stream.getTracks());return stream;};
  try{
   if(mode==='hidden-start')hidden=true;
   if(mode==='already-aborted')controller.abort();
   if(mode==='constructor')window.MediaRecorder=class extends Native{constructor(stream:MediaStream,options?:MediaRecorderOptions){super(stream,options);throw new Error('Injected constructor failure');}};
   if(mode==='start')Native.prototype.start=function(){throw new Error('Injected start failure');};
   if(mode==='early-stop')Native.prototype.start=function(...args:Parameters<typeof originalStart>){originalStart.apply(this,args);setTimeout(()=>this.stop(),50);};
   if(mode==='stop-timeout')Native.prototype.stop=function(){};
   if(mode==='capture-gap')Object.defineProperty(performance,'now',{configurable:true,value:()=>originalNow()+offset});
   const blob=await m.exportDream(assets,false,controller.signal,()=>{
    if(mode==='stop-timeout')controller.abort();
    if(mode==='progress')throw new Error('Injected progress failure');
    if(mode==='hidden-during'){hidden=true;document.dispatchEvent(new Event('visibilitychange'));}
    if(mode==='capture-gap')offset=5000;
   });bytes=blob.size;
  }catch(error){message=(error as Error).message;}
  finally{window.MediaRecorder=Native;Native.prototype.start=originalStart;Native.prototype.stop=originalStop;HTMLCanvasElement.prototype.captureStream=originalCapture;delete (document as any).hidden;delete (performance as any).now;}
  return {message,bytes,tracks:tracks.map(track=>track.readyState)};
 },mode);
 expect(result.bytes).toBe(0);expect(result.message).toMatch(/visible|cancelled|Injected|hidden|interrupted|before completion/);
 expect(result.tracks.every(state=>state==='ended')).toBe(true);
 if(mode==='hidden-start'||mode==='already-aborted')expect(result.tracks).toHaveLength(0);else expect(result.tracks.length).toBeGreaterThan(0);
});
