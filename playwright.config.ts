import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4327',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true,
    viewport: { width: 1440, height: 1080 },
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--disable-gpu', '--no-sandbox'],
    },
  },
  // Tests get their own offline server: a separate port so a live `npm run dev` is never
  // reused, and empty model settings so keys in .env.local are never called.
  webServer: {
    command: 'node --no-maglev ./node_modules/vite/bin/vite.js --port=4327 --host=127.0.0.1 --strictPort',
    url: 'http://127.0.0.1:4327/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      META_API_KEY: '',
      PLANNER_PROVIDER: '',
      IMAGE_PROVIDER: '',
      TRANSCRIBE_PROVIDER: '',
      NARRATION_PROVIDER: '',
      AGENT_PROVIDER: '',
    },
  },
});
