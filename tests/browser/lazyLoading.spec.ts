import {test,expect} from '@playwright/test';
test('studio defers standalone dream and archive modules until needed',async({page})=>{
 const requests:string[]=[];page.on('request',request=>requests.push(new URL(request.url()).pathname));
 await page.goto('/');await expect(page.getByRole('heading',{name:'What would you like to create?'})).toBeVisible();
 expect(requests.some(url=>url.includes('/dream/DreamStudio'))).toBe(false);
 expect(requests.some(url=>url.includes('/services/projectArchive'))).toBe(false);
 await page.getByRole('button',{name:'Kitchen to ocean',exact:true}).click();await page.getByRole('button',{name:'Apply direction',exact:true}).click();
 await expect(page.getByRole('region',{name:'Film preview'})).toBeVisible();
 await page.locator('.project-files summary').click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Back up project',exact:true}).click();await download;
 expect(requests.some(url=>url.includes('/services/projectArchive'))).toBe(true);
 expect(requests.some(url=>url.includes('/dream/DreamStudio'))).toBe(false);
});
test('a failed route module load provides a working reload action',async({page})=>{
 await page.route('**/src/App.tsx*',route=>route.abort());
 await page.goto('/');await expect(page.getByRole('alert')).toContainText('could not load');
 await page.unroute('**/src/App.tsx*');
 await page.getByRole('button',{name:'Reload AnchorShot',exact:true}).click();
 await expect(page.getByRole('heading',{name:'What would you like to create?'})).toBeVisible();
});

test('standalone dream accepts the static-server trailing slash',async({page})=>{
 const requests:string[]=[];page.on('request',request=>requests.push(new URL(request.url()).pathname));
 await page.goto('/dream/');
 await expect(page.getByRole('heading',{name:'Dream editor',exact:true})).toBeVisible();
 expect(requests.some(url=>url.includes('/src/App.tsx'))).toBe(false);
});
