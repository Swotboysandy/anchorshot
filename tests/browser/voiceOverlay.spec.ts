import { test, expect } from '@playwright/test';

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['microphone'],
});

test('offline orb meters sound without browser recognition, recording, uploads or a popup', async ({ page }) => {
  const uploads: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST') uploads.push(request.url());
  });
  await page.addInitScript(() => {
    const state = window as unknown as Record<string, any>;
    state.__cloudRecognition = 0;
    state.__recorders = 0;
    state.SpeechRecognition = state.webkitSpeechRecognition = class {
      constructor() { state.__cloudRecognition++; throw new Error('Unexpected browser speech recognition'); }
    };
    const OriginalRecorder = MediaRecorder;
    state.MediaRecorder = class extends OriginalRecorder {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        state.__recorders++;
        super(stream, options);
      }
    };
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      const stream = await original(options);
      state.__stream = stream;
      return stream;
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Start voice chat/ }).click();
  await expect(page.locator('#voice-orb-status')).toContainText('Local sound visualization only');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('log', { name: 'Voice agent captions' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop voice chat' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__stream.getTracks()
    .every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
  expect(await page.evaluate(() => ({ recognition: (window as any).__cloudRecognition, recorders: (window as any).__recorders })))
    .toEqual({ recognition: 0, recorders: 0 });
  expect(uploads).toEqual([]);
  await expect(page.getByRole('region', { name: 'Film preview' })).toHaveCount(0);
});
