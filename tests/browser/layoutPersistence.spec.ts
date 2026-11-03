import { expect, test } from '@playwright/test';

test('crossing the layout breakpoint keeps an open dream study mounted', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Describe your video or edit' }).fill('A kitchen opens onto an ocean. A blue cup stays in place.');
  await page.getByRole('button', { name: 'Apply direction', exact: true }).click();
  await page.getByRole('region', { name: 'Film preview' }).waitFor();
  await page.getByRole('tab', { name: 'Dream', exact: true }).click();
  await page.getByRole('button', { name: /Open dream transition/ }).click();
  const close = page.getByRole('button', { name: /Close study/ });
  await expect(close).toBeVisible();
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(close).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await expect(close).toBeVisible();
});


test('creation preview uses the available width without an empty inspector column', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Kitchen to ocean', exact: true }).click();
  await page.getByRole('button', { name: 'Apply direction', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Film preview' });
  await expect(preview).toBeVisible();
  const measure = await preview.evaluate(element => ({
    right: element.getBoundingClientRect().right,
    width: element.getBoundingClientRect().width,
    viewport: innerWidth,
  }));
  expect(measure.viewport - measure.right).toBeLessThan(45);
  expect(measure.width).toBeGreaterThan(measure.viewport * 0.6);
  await expect(page.getByRole('separator', { name: 'Resize scene details' })).toHaveCount(0);
  await page.screenshot({path:'.artifacts/audit-dashboard-desktop.png'});
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('separator', { name: 'Resize scene details' })).toBeVisible();
  await page.getByRole('tab', { name: 'Create', exact: true }).click();
  await page.setViewportSize({width:390,height:844});
  await expect(preview).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:'.artifacts/audit-dashboard-mobile.png'});
});
