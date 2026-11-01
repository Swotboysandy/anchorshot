import { expect, test } from '@playwright/test';

// The agent server is stubbed: /api/health reports an agent, and Playwright
// intercepts the ElevenLabs websocket to play a short exchange. The page's real
// CSP still applies, but no real service is contacted.
test.use({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-gpu'] },
});

test('voice agent conversation appears as on-screen captions', async ({ page }) => {
  await page.route('**/api/health', async (route) => {
    const health = await (await route.fetch()).json();
    await route.fulfill({ json: { ...health, agentReady: true } });
  });
  await page.route('**/api/agent/session', (route) => route.fulfill({ json: { signedUrl: 'wss://api.elevenlabs.io/v1/convai/conversation?test=1' } }));
  await page.routeWebSocket('wss://api.elevenlabs.io/**', (ws) => {
    ws.send(JSON.stringify({
      type: 'conversation_initiation_metadata',
      conversation_initiation_metadata_event: {
        conversation_id: 'test',
        agent_output_audio_format: 'pcm_16000',
        user_input_audio_format: 'pcm_16000',
      },
    }));
    ws.send(JSON.stringify({ type: 'user_transcript', user_transcription_event: { user_transcript: 'Read me the storyboard.' } }));
    ws.send(JSON.stringify({ type: 'agent_response', agent_response_event: { agent_response: 'The storyboard is empty.' } }));
    ws.onMessage(() => {});
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Start voice chat' }).click();
  const captions = page.getByRole('log', { name: 'Voice agent captions' });
  await expect(captions).toContainText('Read me the storyboard.');
  await expect(captions).toContainText('The storyboard is empty.');
  await expect(captions.getByText('Agent said:')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/agent-captions-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(captions).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/agent-captions-mobile.png' });

  await page.getByRole('button', { name: 'Stop voice chat' }).click();
  await expect(captions).toHaveCount(1);
});
