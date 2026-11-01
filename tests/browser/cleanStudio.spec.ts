import { test, expect } from '@playwright/test';
test('clean workspace supports input, playback and preserved dream selections offline', async ({
  page,
}) => {
  const errors: string[] = [],
    posts: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push(r.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What would you like to create?' })).toBeVisible();
  await page.getByLabel('Describe your video or edit').focus();
  await page.getByRole('tab', { name: 'Paste a script', exact: true }).click();
  const script = page.getByRole('textbox', { name: 'Scene Transcript', exact: true });
  const original = await script.inputValue();
  await script.fill(original + ' A distant light.');
  await page.getByRole('tab', { name: 'Describe a video', exact: true }).click();
  await page.getByRole('tab', { name: 'Paste a script', exact: true }).click();
  await expect(script).toHaveValue(original + ' A distant light.');
  await page.getByRole('button', {name:'Create storyboard',exact:true}).click();
  await page.getByRole('button', { name: 'Select shot 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select shot 1', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Play preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause preview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause preview', exact: true }).click();
  await page.getByRole('tab', { name: 'Dream', exact: true }).click();
  await page.getByRole('button', { name: /Open dream transition/ }).click();
  await page.getByRole('button', { name: 'Select real cup', exact: true }).click();
  await page.getByRole('button', { name: 'Use real cup sample' }).click();
  await page.getByRole('button', { name: 'Start rough sample outline' }).click();
  await page.getByRole('button', { name: 'Apply cup to dream' }).click();
  await page.getByRole('tab', { name: 'Create', exact: true }).click();
  await page.getByRole('tab', { name: 'Dream', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit cup mask' })).toBeVisible();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review sequence', exact: true })).toBeVisible();
  expect(posts).toEqual([]);
  expect(errors).toEqual([]);
});
test('clean workspace fits mobile and supports keyboard tabs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('textbox',{name:'Describe your video or edit'}).fill('A kitchen opens onto an ocean. A blue cup stays in place.');await page.getByRole('button',{name:'Apply direction',exact:true}).click();await page.getByRole('region',{name:'Film preview'}).waitFor();
  const create = page.getByRole('tab', { name: 'Create', exact: true });
  await create.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Dream', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  for (const name of ['Create', 'Dream', 'Review']) {
    await page.getByRole('tab', { name, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});


test('published components retain theme and prompt keyboard behavior', async ({page}) => {
 await page.goto('/');
 const tabs=page.getByRole('tablist',{name:'Story input'});
 await expect(tabs.locator('[data-tabs-indicator]')).toBeVisible();
 const prompt=page.getByRole('textbox',{name:'Describe your video or edit'});
 await prompt.fill('Narrate the scene');await prompt.press('Shift+Enter');await expect(prompt).toHaveValue('Narrate the scene\n');
 await expect(page.getByRole('button',{name:'Apply direction',exact:true})).toBeEnabled();await prompt.press('Enter');await expect(prompt).toHaveValue('');
 const slider=page.getByRole('slider',{name:'Preview time'});await slider.focus();await slider.press('ArrowRight');await expect(slider).toHaveAttribute('aria-valuenow','0.1');
});


test('first screen stays clean until real context is submitted',async({page})=>{
 await page.addInitScript(()=>{(window as any).__micRequests=0;navigator.mediaDevices.getUserMedia=async()=>{(window as any).__micRequests++;throw new DOMException('Denied','NotAllowedError');};});
 await page.goto('/');await expect(page.getByRole('region',{name:'Film preview'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Export film'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/Start voice chat/}).getByRole('img',{name:'Voice orb',exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).__micRequests)).toBe(0);
 await page.getByRole('button',{name:/Start voice chat/}).click();await expect(page.locator('#voice-orb-status')).toContainText('denied');expect(await page.evaluate(()=>(window as any).__micRequests)).toBe(1);await page.getByRole('button',{name:'Stop voice chat'}).click();await expect(page.getByRole('region',{name:'Film preview'})).toHaveCount(0);
 const input=page.getByRole('textbox',{name:'Describe your video or edit'});await input.fill('   ');await expect(page.getByRole('button',{name:'Apply direction',exact:true})).toBeDisabled();await input.fill('A blue cup in a kitchen. The door opens onto the ocean.');await expect(page.getByRole('region',{name:'Film preview'})).toHaveCount(0);await page.getByRole('button',{name:'Apply direction',exact:true}).click();await expect(page.getByRole('region',{name:'Film preview'})).toBeVisible();
 await page.getByRole('tab',{name:'Paste a script',exact:true}).click();await expect(page.getByRole('textbox',{name:'Scene Transcript',exact:true})).toHaveValue('A blue cup in a kitchen. The door opens onto the ocean.');
 await page.reload();await expect(page.getByRole('region',{name:'Film preview'})).toBeVisible();await page.getByRole('button',{name:'New project',exact:true}).click();await expect(page.getByRole('region',{name:'Film preview'})).toHaveCount(0);await page.getByRole('button',{name:'Paste a script',exact:true}).click();const script=page.getByRole('textbox',{name:'Scene Transcript',exact:true});await expect(script).toHaveValue('');await expect(page.getByRole('button',{name:'Create storyboard',exact:true})).toBeDisabled();await script.fill('My umbrella stays beside me while the kitchen becomes an ocean.');await page.getByRole('button',{name:'Create storyboard',exact:true}).click();await expect(page.getByRole('region',{name:'Film preview'})).toBeVisible();
});
