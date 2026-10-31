import {test,expect} from '@playwright/test';
for(const viewport of [{width:1440,height:900},{width:375,height:667}]) test(`landing stays within viewport ${viewport.width}`,async({page})=>{
 await page.setViewportSize(viewport);await page.goto('/');
 expect(await page.evaluate(()=>document.documentElement.scrollHeight <= innerHeight)).toBe(true);
 await expect(page.getByRole('button',{name:/Start voice chat/})).toBeInViewport();
 await expect(page.getByRole('tab',{name:'Describe a video',exact:true})).toBeInViewport();
 await expect(page.getByRole('button',{name:'Kitchen to ocean',exact:true})).toBeInViewport();
});
