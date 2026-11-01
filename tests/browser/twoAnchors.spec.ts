import {test,expect} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
test('independent cup and umbrella corrections survive transition and export offline',async({page})=>{
 test.setTimeout(240000);const posts:string[]=[],errors:string[]=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.getByRole('textbox',{name:'Describe your video or edit'}).fill('A kitchen opens onto an ocean. A blue cup stays in place.');await page.getByRole('button',{name:'Apply direction',exact:true}).click();await page.getByRole('region',{name:'Film preview'}).waitFor();await page.getByRole('tab',{name:'Dream',exact:true}).click();await page.getByRole('button',{name:/Open dream transition/}).click();
 await page.getByRole('button',{name:'Select real cup',exact:true}).click();
 await page.getByRole('button',{name:'Use real cup sample'}).click();await page.getByRole('button',{name:'Start rough sample outline'}).click();await page.getByRole('button',{name:'Apply cup to dream'}).click();
 await page.getByRole('button',{name:'Select umbrella',exact:true}).click();await page.getByRole('button',{name:'Use umbrella sample'}).click();
 await expect(page.getByRole('button',{name:'Apply umbrella to dream'})).toBeDisabled();
 await page.getByRole('button',{name:'Start umbrella sample mask'}).click();
 const editor=page.getByRole('region',{name:'Umbrella mask editor'}),canvas=editor.getByRole('img',{name:'Umbrella selection canvas'});
 const before=await editor.getByRole('status').textContent();await canvas.focus();await page.keyboard.press(' ');await expect(editor.getByRole('status')).not.toHaveText(before!);
 await editor.getByRole('button',{name:'Undo mask edit'}).click();await expect(editor.getByRole('status')).toHaveText(before!);
 await canvas.focus();await page.keyboard.press(' ');await editor.getByRole('button',{name:'Apply umbrella to dream'}).click();
 await page.getByRole('button',{name:'Check both objects'}).click();await expect(page.getByLabel('umbrella preservation score')).toContainText('0 changed pixels',{timeout:30000});await expect(page.getByLabel('cup preservation score')).toContainText('0 changed pixels',{timeout:30000});
 await mkdir('.artifacts/two-anchors',{recursive:true});
 for(const [label,file] of [['Save quality report','quality.json'],['Save cup mask','cup.png'],['Save umbrella mask','umbrella.png'],['Save PNG frame','first.png']]){const d=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();await(await d).saveAs('.artifacts/two-anchors/'+file);}
 const report=JSON.parse(await readFile('.artifacts/two-anchors/quality.json','utf8'));expect(report.framesChecked).toBe(289);expect(report.objects).toHaveLength(2);for(const o of report.objects)expect(o.changedProtectedPixelsAcrossFrames).toBe(0);
 await page.getByRole('button',{name:'Ocean',exact:true}).click();const end=page.waitForEvent('download');await page.getByRole('button',{name:'Save PNG frame'}).click();await(await end).saveAs('.artifacts/two-anchors/last.png');
 const video=page.waitForEvent('download',{timeout:30000});await page.getByRole('button',{name:'Export dream WebM'}).click();await(await video).saveAs('.artifacts/two-anchors/dream.webm');
 await page.getByRole('region',{name:'Kitchen to ocean dream study'}).screenshot({path:'.artifacts/two-anchors/study.png'});
 await page.getByRole('button',{name:'Edit umbrella mask'}).click();await expect(page.getByRole('button',{name:'Export dream WebM'})).toBeDisabled();await expect(page.getByLabel('umbrella preservation score')).toHaveCount(0);
 await editor.getByRole('button',{name:'Clear mask'}).click();await expect(editor.getByRole('button',{name:'Apply umbrella to dream'})).toBeDisabled();await page.getByRole('button',{name:'Cancel mask editing'}).click();
 await page.getByRole('button',{name:'Check both objects'}).click();await expect(page.getByLabel('umbrella preservation score')).toContainText('revision 1');
 await page.getByRole('button',{name:'Remove umbrella'}).click();await expect(page.getByRole('button',{name:'Save umbrella mask'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Edit cup mask'})).toBeEnabled();
 expect(posts).toEqual([]);expect(errors).toEqual([]);
});
test('umbrella upload and keyboard correction work on mobile independently of cup',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('textbox',{name:'Describe your video or edit'}).fill('A kitchen opens onto an ocean. A blue cup stays in place.');await page.getByRole('button',{name:'Apply direction',exact:true}).click();await page.getByRole('region',{name:'Film preview'}).waitFor();await page.getByRole('tab',{name:'Dream',exact:true}).click();await page.getByRole('button',{name:/Open dream transition/}).click();await page.getByRole('button',{name:'Select umbrella',exact:true}).click();
 await page.getByLabel('Upload umbrella photo').setInputFiles('public/dream/real-cup.png');
 const editor=page.getByRole('region',{name:'Umbrella mask editor'});const c=editor.getByRole('img',{name:'Umbrella selection canvas'});await expect(c).toBeVisible();
 const box=(await c.boundingBox())!;for(const [x,y]of [[0.3,0.2],[0.6,0.2],[0.5,0.7]])await c.click({position:{x:box.width*x,y:box.height*y}});
 await editor.getByRole('button',{name:'Close outline'}).click();await editor.getByRole('button',{name:'Apply umbrella to dream'}).click();
 await expect(page.getByRole('button',{name:'Select real cup',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Edit umbrella mask'})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
