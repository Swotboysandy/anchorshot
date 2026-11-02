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
