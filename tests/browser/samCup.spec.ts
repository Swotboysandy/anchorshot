import {test,expect} from '@playwright/test';

test('offline cutout never contacts models and manual correction clears synthetic metadata',async({page})=>{
 const posts:string[]=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
 await page.goto('/');await page.getByRole('textbox',{name:'Describe your video or edit'}).fill('A kitchen opens onto an ocean. A blue cup stays in place.');await page.getByRole('button',{name:'Apply direction',exact:true}).click();await page.getByRole('region',{name:'Film preview'}).waitFor();await page.getByRole('tab',{name:'Dream',exact:true}).click();await page.getByRole('button',{name:/Open dream transition/}).click();
 await page.getByRole('button',{name:'Select real cup',exact:true}).click();
 const editor=page.getByRole('region',{name:'Real cup mask editor'});
 await editor.getByRole('button',{name:'Use real cup sample'}).click();
 await editor.getByRole('button',{name:'Preview cutout (offline)'}).click();
 await expect(editor.getByText('Offline starter shape - not AI segmentation')).toBeVisible();
 await editor.getByRole('button',{name:'Clear mask'}).click();
 await expect(editor.getByText('Offline starter shape - not AI segmentation')).toHaveCount(0);
 await editor.getByRole('button',{name:'Undo mask edit'}).click();
 await editor.getByRole('button',{name:'Apply cup to dream'}).click();
 await expect(page.getByText(/Approved photo mask.*revision 1/)).toBeVisible();
 await page.getByRole('button',{name:'Check cup preservation'}).click();
 await expect(page.getByRole('status',{name:'Cup preservation results'})).toContainText(/PASS.*289 frames.*0 changed protected pixels/,{timeout:15000});
 expect(posts).toEqual([]);
});

test('SAM adapter decodes mocked live responses and rejects errors without synthetic success',async({page})=>{
 await page.route('**/api/health',route=>route.fulfill({json:{sessionToken:'mock'}}));
 let malformed=false;
 await page.route('**/api/segment/check',route=>route.fulfill({json:malformed?{objects:[]}:{provenance:'live-sam-3.1',selectedObjectId:'cup',objects:[{objectId:'cup',bounds:{left:2,top:2,right:8,bottom:8},rasterWidth:2,rasterHeight:2,rasterBase64:'AQABAQ==',confidence:0.9}]}}));
 await page.goto('/');await page.getByRole('textbox',{name:'Describe your video or edit'}).fill('A kitchen opens onto an ocean. A blue cup stays in place.');await page.getByRole('button',{name:'Apply direction',exact:true}).click();await page.getByRole('region',{name:'Film preview'}).waitFor();await page.getByRole('tab',{name:'Dream',exact:true}).click();
 const run=()=>page.evaluate(async()=>{
 // Vite loads the real adapter; HTTP routes above ensure this never reaches a provider.
 const {requestSamCupCutout}=await import('/src/services/cupSelection.ts' as string);
 try {const r=await requestSamCupCutout({width:10,height:10,data:new Uint8ClampedArray(400).fill(255)},'cup',{allowLive:true});return {provenance:r.provenance,count:r.mask.reduce((a:number,b:number)=>a+b,0)};}
 catch(e){return {error:String(e)};}
 });
 expect(await run()).toEqual({provenance:'live-sam-3.1',count:27});
 malformed=true;expect((await run()).error).toContain('no valid mask');
});
