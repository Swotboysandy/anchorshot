import { expect, test, type Page } from '@playwright/test';

async function createFilm(page: Page, name: string) {
  await page.getByRole('button', { name: 'Kitchen to ocean', exact: true }).click();
  await page.getByRole('button', { name: 'Apply direction', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Film preview' })).toBeVisible();
  await rename(page, name);
}
async function rename(page: Page, name: string) {
  await page.locator('.project-rename summary').click();
  await page.getByLabel('Project name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save name' }).click();
}
async function stored(page: Page): Promise<any> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('anchorshot-projects', 1);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('records').objectStore('records').get('library');
      request.onsuccess = () => { resolve(request.result); db.close(); };
      request.onerror = () => { reject(request.error); db.close(); };
    };
    open.onerror = () => reject(open.error);
  }));
}
async function savedName(page: Page, id: string, name: string) {
  await expect.poll(async () => (await stored(page)).projects.find((p: any) => p.projectId === id)?.title).toBe(name);
}

test('independent tabs merge distinct projects and switching loads the latest saved edits', async ({ page, context }) => {
  await page.goto('/');
  await createFilm(page, 'Ocean original');
  const selector = page.getByLabel('Switch project');
  const ocean = await selector.inputValue();
  await savedName(page, ocean, 'Ocean original');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What would you like to create?' })).toBeVisible();
  await createFilm(page, 'Moon original');
  const moon = await selector.inputValue();
  await savedName(page, moon, 'Moon original');
  const other = await context.newPage();
  await other.goto('/');
  await other.getByLabel('Switch project').selectOption(ocean);
  await expect(other.getByLabel('Switch project')).toHaveValue(ocean);
  await rename(page, 'Moon latest');
  await savedName(page, moon, 'Moon latest');
  await rename(other, 'Ocean latest');
  await savedName(page, ocean, 'Ocean latest');
  await savedName(page, moon, 'Moon latest');
  await selector.selectOption(ocean);
  await expect(selector.locator('option:checked')).toHaveText('Ocean latest');
  await page.reload();
  await expect(selector.locator('option:checked')).toHaveText('Ocean latest');
  await selector.selectOption(moon);
  await expect(selector.locator('option:checked')).toHaveText('Moon latest');
});

test('a stale tab cannot overwrite the same project or switch away from unsaved conflicting edits', async ({ page, context }) => {
  await page.goto('/');
  await createFilm(page, 'Shared original');
  const id = await page.getByLabel('Switch project').inputValue();
  await savedName(page, id, 'Shared original');
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.getByRole('region', { name: 'Film preview' })).toBeVisible();
  await rename(page, 'Saved in first tab');
  await savedName(page, id, 'Saved in first tab');
  await rename(other, 'Unsaved in second tab');
  await expect(other.getByRole('alert')).toContainText('changed in another tab');
  await savedName(page, id, 'Saved in first tab');
  await other.getByRole('button', { name: 'New project', exact: true }).click();
  await expect(other.getByLabel('Switch project')).toHaveValue(id);
  await expect(other.getByLabel('Switch project').locator('option:checked')).toHaveText('Unsaved in second tab');
});

test('a malformed saved library is reported without replacing the stored record', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What would you like to create?' })).toBeVisible();
  const damaged = { active: 'broken', projects: [{ projectId: 'broken', title: 'Keep my data', shots: 'damaged' }] };
  await page.evaluate(value => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('anchorshot-projects', 1);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('records', 'readwrite');
      tx.objectStore('records').put(value, 'library');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), damaged);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('damaged or unsupported');
  expect(await stored(page)).toEqual(damaged);
  await expect(page.getByRole('heading', { name: 'What would you like to create?' })).toHaveCount(0);
});

test('quota failure preserves the previous save and recovers after storage is available', async ({ page }) => {
  await page.goto('/');
  await createFilm(page, 'Before quota');
  const id = await page.getByLabel('Switch project').inputValue();
  await savedName(page, id, 'Before quota');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).__quota = true;
    IDBObjectStore.prototype.put = function(value, key) {
      if ((window as any).__quota && key === 'library') throw new DOMException('Test quota exhausted', 'QuotaExceededError');
      return original.call(this, value, key);
    };
  });
  await rename(page, 'Not saved');
  await expect(page.getByRole('alert')).toContainText('Local storage is full');
  await page.screenshot({path:'.artifacts/storage-warning-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('alert')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:'.artifacts/storage-warning-mobile.png'});
  await page.setViewportSize({width:1440,height:1080});
  await savedName(page, id, 'Before quota');
  await page.evaluate(() => { (window as any).__quota = false; });
  await rename(page, 'Recovered save');
  await savedName(page, id, 'Recovered save');
  await page.reload();
  await expect(page.getByLabel('Switch project').locator('option:checked')).toHaveText('Recovered save');
});


test('separate mask saves reject stale edits and preserve binary arrays', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What would you like to create?' })).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/services/projectStorage.ts';
    const storage = await import(path);
    await storage.loadLocal('dream:conflict-test');
    await storage.saveLocal('dream:conflict-test', { selection: {
      name: 'Initial cup', revision: 1, mask: new Uint8Array(32).fill(1),
      photo: { width: 8, height: 4, data: new Uint8ClampedArray(128).fill(255) },
    }, umbrella: null });
  });
  const other = await context.newPage();
  await other.goto('/');
  await other.evaluate(async () => {
    const path = '/src/services/projectStorage.ts';
    (window as any).__maskSnapshot = await (await import(path)).loadLocal('dream:conflict-test');
  });
  await page.evaluate(async () => {
    const path = '/src/services/projectStorage.ts';
    const storage = await import(path);
    const value = await storage.loadLocal('dream:conflict-test');
    value.selection.name = 'Saved cup';
    value.selection.mask[0] = 0;
    await storage.saveLocal('dream:conflict-test', value);
  });
  const error = await other.evaluate(async () => {
    const path = '/src/services/projectStorage.ts';
    const value = (window as any).__maskSnapshot;
    value.selection.name = 'Stale cup';
    try { await (await import(path)).saveLocal('dream:conflict-test', value); }
    catch (reason) { return (reason as Error).message; }
  });
  expect(error).toContain('masks changed in another tab');
  expect(await page.evaluate(async () => {
    const path = '/src/services/projectStorage.ts';
    const saved = await (await import(path)).loadLocal('dream:conflict-test');
    return {name:saved.selection.name,mask:[...saved.selection.mask],rgba:saved.selection.photo.data instanceof Uint8ClampedArray};
  })).toEqual({name:'Saved cup',mask:[0,...Array(31).fill(1)],rgba:true});
});


test('archive insertion saves masks atomically, preserves projects, and rejects ID collisions', async ({ page }) => {
  await page.goto('/');
  await createFilm(page, 'Existing film');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/services/projectStorage.ts';
    const storage = await import(/* @vite-ignore */ modulePath);
    await storage.flushLocalSaves();
    const before = await storage.loadLocal('library');
    const restored = structuredClone(before.projects[0]);
    restored.projectId = crypto.randomUUID();
    restored.title = 'Restored film';
    restored.isPlayingAnimatic = true;
    const selection = {name:'Cup', revision:1, photo:{width:4,height:4,data:new Uint8ClampedArray(64).fill(255)}, mask:new Uint8Array(16).fill(1)};
    const masks = {selection, umbrella:null};
    const library = await storage.insertRestoredProject(restored, masks);
    const savedMasks = await storage.loadLocal(`dream:${restored.projectId}`);
    let collision = '';
    try { await storage.insertRestoredProject(restored, masks); } catch(error) { collision = String(error); }
    const afterCollision = await storage.loadLocal('library');
    const failedId = crypto.randomUUID();
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: any, key?: IDBValidKey) {
      if(key === `dream:${failedId}`) throw new DOMException('Test quota', 'QuotaExceededError');
      return originalPut.call(this, value, key!);
    };
    let quota = '';
    try { await storage.insertRestoredProject({...restored,projectId:failedId}, masks); }
    catch(error) { quota = String(error); }
    finally { IDBObjectStore.prototype.put = originalPut; }
    const afterFailure = await storage.loadLocal('library');
    const failedMasks = await storage.loadLocal(`dream:${failedId}`);
    return { originalPreserved: JSON.stringify(before.projects) === JSON.stringify(library.projects.slice(0,-1)),
      count:library.projects.length-before.projects.length, playing:library.projects.at(-1).isPlayingAnimatic,
      raster:Array.from(savedMasks.selection.mask), rgba:Array.from(savedMasks.selection.photo.data),
      typed:savedMasks.selection.mask instanceof Uint8Array && savedMasks.selection.photo.data instanceof Uint8ClampedArray,
      collision, quota, collisionPreserved:JSON.stringify(library)===JSON.stringify(afterCollision),
      rollback:JSON.stringify(library)===JSON.stringify(afterFailure) && failedMasks===undefined };
  });
  expect(result).toMatchObject({originalPreserved:true,count:1,playing:false,raster:Array(16).fill(1),rgba:Array(64).fill(255),typed:true,collisionPreserved:true,rollback:true});
  expect(result.collision).toContain('already exists');
  expect(result.quota).toContain('QuotaExceededError');
});
