import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile } from 'node:fs/promises';

test('dream scenes change while the opaque mug interior remains identical', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/dream');
  await expect(page.getByRole('button', { name: 'Play dream', exact: true })).toBeEnabled();
  const pixels = () =>
    page
      .locator('canvas')
      .evaluate((canvas) =>
        Array.from(
          (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(130, 480, 100, 70).data,
        ),
      );
  const first = await pixels();
  await page.getByRole('button', { name: 'Show An endless ocean' }).click();
  await expect(page.locator('canvas')).toHaveAttribute('aria-label', /endless ocean/);
  expect(await pixels()).toEqual(first);
  await page.getByRole('button', { name: 'Show Under another moon' }).click();
  await expect(page.locator('canvas')).toHaveAttribute('aria-label', /another moon/);
  expect(await pixels()).toEqual(first);
  await page.getByRole('checkbox', { name: 'Keep the red mug' }).uncheck();
  expect(await pixels()).not.toEqual(first);
  await page.getByRole('checkbox', { name: 'Keep the red mug' }).check();
  expect(await pixels()).toEqual(first);
  expect(errors).toEqual([]);
});

test('pause, scrubbing, captions and plan persistence work without generation', async ({
  page,
}) => {
  await page.goto('/dream');
  await page.getByRole('button', { name: 'Play dream', exact: true }).click();
  await expect
    .poll(async () => Number(await page.getByLabel('Dream playhead').inputValue()))
    .toBeGreaterThan(0.5);
  await page.getByRole('button', { name: 'Pause dream', exact: true }).click();
  const paused = await page.getByLabel('Dream playhead').inputValue();
  await page.waitForTimeout(180);
  expect(await page.getByLabel('Dream playhead').inputValue()).toBe(paused);
  await page.getByLabel('Dream playhead').focus();
  await page.keyboard.press('End');
  await expect(page.getByLabel('Dream playhead')).toHaveValue('20');
  await page.getByRole('button', { name: 'Restart dream' }).click();
  await expect(page.getByLabel('Dream playhead')).toHaveValue('0');
  await page.getByLabel('Your dream notes').fill('I remembered a doorway and a red mug.');
  await page.getByLabel('Caption for An endless ocean').fill('The sea was completely still.');
  await page.getByRole('button', { name: 'Dissolve', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Your dream notes')).toHaveValue(
    'I remembered a doorway and a red mug.',
  );
  await expect(page.getByLabel('Caption for An endless ocean')).toHaveValue(
    'The sea was completely still.',
  );
  await expect(page.getByRole('button', { name: 'Dissolve', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  await mkdir('.artifacts/dream', { recursive: true });
  await (await pending).saveAs('.artifacts/dream/plan.json');
  const plan = JSON.parse(await readFile('.artifacts/dream/plan.json', 'utf8'));
  expect(plan.provenance.modelCalls).toBe(0);
  expect(plan.captions[1]).toBe('The sea was completely still.');
});

test('exports an actual playable silent WebM and supports cancellation', async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto('/dream');
  const sharp = (await import('sharp')).default;
  const ownScene = await sharp({
    create: { width: 1120, height: 700, channels: 3, background: '#dd2244' },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel('Image for scene 2', { exact: true })
    .setInputFiles({ name: 'export-scene.png', mimeType: 'image/png', buffer: ownScene });
  await expect(page.getByRole('button', { name: 'Reset scene 2 image' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export WebM', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Export WebM', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel export' }).click();
  await expect(page.getByRole('status')).toContainText('Export cancelled');
  const downloaded = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Export WebM', exact: true }).click();
  await expect(page.getByLabel('Your dream notes')).toBeDisabled();
  await mkdir('.artifacts/dream', { recursive: true });
  await (await downloaded).saveAs('.artifacts/dream/journey.webm');
  const bytes = await readFile('.artifacts/dream/journey.webm');
  expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  expect(bytes.length).toBeGreaterThan(50_000);
  await page.route('**/test-dream.webm', (route) =>
    route.fulfill({ contentType: 'video/webm', body: bytes }),
  );
  // A downloaded file is fully local; use a Blob URL rather than a mock HTTP server without byte-range support.
  const metadata = await page.evaluate(async () => {
    const url = URL.createObjectURL(await (await fetch('/test-dream.webm')).blob());
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    document.body.append(video);
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('Video did not decode'));
    });
    await video.play();
    video.pause();
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      video.currentTime = 10;
    });
    const frame = document.createElement('canvas');
    frame.width = video.videoWidth;
    frame.height = video.videoHeight;
    const context = frame.getContext('2d')!;
    context.drawImage(video, 0, 0);
    const pixel = [...context.getImageData(500, 300, 1, 1).data];
    const result = {
      pixel,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      seek: video.currentTime,
    };
    video.remove();
    URL.revokeObjectURL(url);
    return result;
  });
  expect(metadata.width).toBe(1120);
  expect(metadata.height).toBe(700);
  expect(metadata.duration).toBeGreaterThan(19.5);
  expect(metadata.duration).toBeLessThan(21.5);
  expect(metadata.seek).toBe(10);
  expect(metadata.pixel[0]).toBeGreaterThan(200);
  expect(metadata.pixel[1]).toBeLessThan(55);
  await expect(page.getByLabel('Your dream notes')).toBeEnabled();
});

for (const [name, width] of [
  ['desktop', 1440],
  ['tablet', 768],
  ['mobile', 390],
] as const) {
  test(`dream ${name} layout and accessibility`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/dream');
    await expect(page.getByRole('button', { name: 'Play dream', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Show An endless ocean' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const checkbox = await page.getByRole('checkbox', { name: 'Gentle playback' }).boundingBox();
    expect(checkbox!.width).toBeLessThanOrEqual(20);
    expect(checkbox!.height).toBeLessThanOrEqual(20);
    expect(
      await page.locator('.dream-motion').evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await expect(page.getByLabel('Scene 1 title', { exact: true })).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    );
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(result.violations).toEqual([]);
    await page.locator('#dream-workspace').focus();
    await page.evaluate(() => window.scrollTo(0, 0));
    await mkdir('.artifacts/dream', { recursive: true });
    await page.screenshot({ path: `.artifacts/dream/${name}.png`, fullPage: true });
  });
}
test('reduced-motion preference defaults to gentle cuts and no autoplay', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dream');
  await expect(page.getByRole('checkbox', { name: 'Gentle playback' })).toBeChecked();
  await expect(page.getByLabel('Dream playhead')).toHaveValue('0');
  await expect(page.getByRole('button', { name: 'Play dream', exact: true })).toBeEnabled();
});

test('local images and story edits survive reload and export without generation', async ({
  page,
}) => {
  const unexpected: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' ||
      (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:4327/'))
    )
      unexpected.push(request.url());
  });
  await page.goto('/dream');
  await expect(page.getByRole('button', { name: 'Play dream', exact: true })).toBeEnabled();
  const sharp = (await import('sharp')).default;
  const png = await sharp({
    create: { width: 400, height: 250, channels: 3, background: '#dd2244' },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel('Image for scene 1', { exact: true })
    .setInputFiles({ name: 'my-dream.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('button', { name: 'Reset scene 1 image' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play dream', exact: true })).toBeEnabled();
  await page.getByLabel('Scene 1 title', { exact: true }).fill('My crimson world');
  await page
    .getByLabel('Your dream notes')
    .fill('I entered a crimson world.\n\nThe sea became a mirror.\n\nThe moon opened a door.');
  await page.getByRole('button', { name: 'Use paragraphs as captions' }).click();
  await expect(page.getByLabel('Caption for My crimson world', { exact: true })).toHaveValue(
    'I entered a crimson world.',
  );
  await page.getByRole('checkbox', { name: 'Keep the red mug' }).uncheck();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Play dream', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Scene 1 title', { exact: true })).toHaveValue('My crimson world');
  await expect(page.getByLabel('Caption for My crimson world', { exact: true })).toHaveValue(
    'I entered a crimson world.',
  );
  const pixel = await page
    .locator('canvas')
    .evaluate((canvas: HTMLCanvasElement) => [
      ...canvas.getContext('2d')!.getImageData(500, 300, 1, 1).data,
    ]);
  expect(pixel[0]).toBeGreaterThan(200);
  expect(pixel[1]).toBeLessThan(50);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  await (await pending).saveAs('.artifacts/dream/local-plan.json');
  const plan = JSON.parse(await readFile('.artifacts/dream/local-plan.json', 'utf8'));
  expect(plan.images[0].data).toMatch(/^data:image\/jpeg;base64,/);
  expect(plan.imageSources[0]).toEqual({ type: 'local-image', name: 'my-dream.png' });
  expect(plan.provenance.modelCalls).toBe(0);
  await page.getByLabel('Image for scene 1', { exact: true }).setInputFiles({
    name: 'broken.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an image'),
  });
  await expect(page.getByRole('alert')).toContainText('could not be opened');
  await expect(page.getByText('my-dream.png', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset scene 1 image' }).click();
  await expect(page.getByRole('button', { name: 'Reset scene 1 image' })).toHaveCount(0);
  await expect(page.getByLabel('Caption for My crimson world', { exact: true })).toHaveValue(
    'I entered a crimson world.',
  );
  expect(unexpected).toEqual([]);
});

test('invalid story input leaves edited captions unchanged', async ({ page }) => {
  await page.goto('/dream');
  await page.getByLabel('Your dream notes').fill('One paragraph is not three scenes.');
  await page.getByRole('button', { name: 'Use paragraphs as captions' }).click();
  await expect(page.getByRole('alert')).toContainText('exactly three paragraphs');
  await expect(page.getByLabel('Caption for A quiet kitchen', { exact: true })).toHaveValue(
    'I was holding my red mug in the kitchen.',
  );
});
