import {test,expect} from '@playwright/test';
test.use({launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']},permissions:['microphone']});
test('bare orb toggles local microphone without opening a popup',async({page})=>{
 await page.addInitScript(()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async options=>{const stream=await original(options);(window as any).__stream=stream;return stream;};});
 await page.goto('/');
 await page.getByRole('button',{name:/Start voice chat/}).click();
 await expect(page.locator('#voice-orb-status')).toContainText('Microphone on');
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'Stop voice chat'}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__stream.getTracks().every((t:MediaStreamTrack)=>t.readyState==='ended'))).toBe(true);
 await expect(page.getByRole('region',{name:'Film preview'})).toHaveCount(0);
});
