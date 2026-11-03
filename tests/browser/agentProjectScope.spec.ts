import {test,expect} from '@playwright/test';

test('voice direction cannot leak into a new project and same-turn generation uses its own script',async({page})=>{
 // Replace only the conversation transport; exercise the real live App tool callbacks.
 await page.route('**/src/services/voiceAgent.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
 export async function agentAvailable(){return {ready:true,session:'offline-test'};}
 export async function startAgentConversation(session,tools){
   window.__voiceTools=tools;
   return {endSession:async()=>{window.__voiceEnded=true;},getInputVolume:()=>0,getOutputVolume:()=>0};
 }
 `}));
 await page.goto('/');
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 await page.getByRole('button',{name:/Start voice chat/}).click();
 await page.waitForFunction(()=>Boolean((window as any).__voiceTools));
 const first=await page.getByLabel('Switch project').inputValue();
 expect(await page.evaluate(()=>(window as any).__voiceTools.set_direction({text:'A blue cup in an old kitchen.'}))).toContain('saved');
 await page.getByRole('button',{name:'New project',exact:true}).click();
 await expect(page.getByLabel('Switch project')).not.toHaveValue(first);
 await page.waitForFunction(()=>Boolean((window as any).__voiceEnded));
 await page.getByRole('button',{name:/Start voice chat/}).click();
 const result=await page.evaluate(()=>(window as any).__voiceTools.generate_storyboard({}));
 expect(result).toContain('script is empty');
 await expect(page.getByRole('region',{name:'Film preview'})).toHaveCount(0);
 // Consecutive tools in one turn must still share the current project's new text.
 await page.evaluate(()=>{
  (window as any).__voiceTools.set_direction({text:'An amber umbrella on a rainy street.'});
  return (window as any).__voiceTools.generate_storyboard({});
 });
 await expect(page.getByRole('region',{name:'Film preview'})).toBeVisible();
 await expect(page.locator('.local-label')).toContainText('Saved locally');
 const saved=await page.evaluate(async()=>{
  const storage=await import('/src/services/projectStorage.ts' as string);
  await storage.flushLocalSaves();return storage.loadLocal('library');
 });
 const active=saved.projects.find((p:any)=>p.projectId===saved.active);
 expect(active.transcript).toBe('An amber umbrella on a rainy street.');
 expect(saved.projects.find((p:any)=>p.projectId===first).transcript).toBe('A blue cup in an old kitchen.');
 // A later manual script edit must supersede the temporary voice draft.
 await page.evaluate(()=>(window as any).__voiceTools.set_direction({text:'A forgotten cup in the kitchen.'}));
 await page.getByRole('tab',{name:'Paste a script',exact:true}).click();
 await page.getByLabel('Scene Transcript',{exact:true}).fill('A white umbrella beside the ocean.');
 await page.evaluate(()=>(window as any).__voiceTools.generate_storyboard({}));
 await expect(page.getByRole('button',{name:'New project',exact:true})).toBeEnabled();
 await expect(page.getByLabel('Scene Transcript',{exact:true})).toHaveValue('A white umbrella beside the ocean.');

});


test('rapid voice generation runs once and returns actual failure before a successful retry',async({page})=>{
 await page.route('**/src/services/voiceAgent.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
 export async function agentAvailable(){return {ready:true,session:'offline-test'};}
 export async function startAgentConversation(session,tools){window.__voiceTools=tools;return {endSession:async()=>{},getInputVolume:()=>0,getOutputVolume:()=>0};}
 `}));
 await page.goto('/');await expect(page.locator('.local-label')).toContainText('Saved locally');
 await page.getByRole('button',{name:/Start voice chat/}).click();
 await page.waitForFunction(()=>Boolean((window as any).__voiceTools));
 await page.evaluate(()=>(window as any).__voiceTools.set_direction({text:'A blue cup in a kitchen.'}));
 await page.evaluate(async()=>{
  const {metaModelClient}=await import('/src/services/metaModels.ts' as string);
  const original=metaModelClient.generateStoryboardFromTranscript.bind(metaModelClient);
  const w=window as any;w.__generationCalls=0;
  const gate=new Promise<void>(resolve=>w.__releaseGeneration=resolve);
  metaModelClient.generateStoryboardFromTranscript=async(...args:any[])=>{
   w.__generationCalls++;
   if(w.__generationCalls===1){await gate;throw new Error('Offline test generation failure');}
   return original(...args);
  };
  w.__generationResults=[w.__voiceTools.generate_storyboard({}),w.__voiceTools.generate_storyboard({})];
 });
 expect(await page.evaluate(()=>(window as any).__generationCalls)).toBe(1);
 await expect(page.getByRole('button',{name:'New project',exact:true})).toBeDisabled();
 const results=await page.evaluate(async()=>{const w=window as any;w.__releaseGeneration();return Promise.all(w.__generationResults);});
 expect(results[0]).toContain('Offline test generation failure');
 expect(results[1]).toContain('Wait for the current');
 await expect(page.getByRole('region',{name:'Film preview'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'New project',exact:true})).toBeEnabled();
 const retry=await page.evaluate(()=>(window as any).__voiceTools.generate_storyboard({}));
 expect(retry).toContain('Generated 4 shots');
 await expect(page.getByRole('region',{name:'Film preview'})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__generationCalls)).toBe(2);
});
