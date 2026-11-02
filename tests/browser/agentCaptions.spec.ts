import { expect, test } from '@playwright/test';

// The server is stubbed: /api/health reports an agent, so no real model is called.
test.use({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-gpu'] },
});

test('voice agent conversation appears as on-screen captions', async ({ page }) => {
  await page.route('**/api/health', async (route) => {
    const health = await (await route.fetch()).json();
    await route.fulfill({ json: { ...health, agentReady: true } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start voice chat' }).click();
  const captions = page.getByRole('log', { name: 'Voice agent captions' });
  await expect(captions).toContainText('I am your co-director');
  await expect(captions.getByText('Agent said:')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(captions).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Stop voice chat' }).click();
  await expect(captions).toHaveCount(1);
});
