import fs from 'node:fs';
import path from 'path';
import {localAiPlugin} from './server/localAi.ts';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { parse } from 'dotenv';
import { defineConfig, type Plugin } from 'vite';

function readLocalEnv(): Record<string, string> {
  try {
    return parse(fs.readFileSync(path.resolve(__dirname, '.env.local')));
  } catch {
    return {};
  }
}

function anchorShotSamApiPlugin(): Plugin {
  return {
    name: 'anchorshot-sam-api',
    async configureServer(server) {
      if (server.config.server.middlewareMode) return;
      const { createApp } = await import('./server/app');
      const localEnv = readLocalEnv();
      if (localEnv.MODAL_VIDEO_ENDPOINT && !process.env.MODAL_VIDEO_ENDPOINT) {
        process.env.MODAL_VIDEO_ENDPOINT = localEnv.MODAL_VIDEO_ENDPOINT;
      }
      const rawBaseUrl = localEnv.META_API_BASE_URL ?? localEnv.VITE_META_API_BASE_URL;
      if (rawBaseUrl && !process.env.META_API_BASE_URL) {
        process.env.META_API_BASE_URL = rawBaseUrl;
      }
      const rawLimit = (process.env.SAM_MAX_REQUESTS ?? localEnv.SAM_MAX_REQUESTS ?? '').trim();
      const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : 25;
      const requestLimit =
        Number.isInteger(parsedLimit) && parsedLimit >= 0 && parsedLimit <= 100 ? parsedLimit : 25;

      // Same model providers as server/index.ts, so `npm run dev` and `dev:server` behave alike.
      const [{ plannerFromSettings }, { imagerFromSettings }, { transcriberFromSettings }, { narratorFromSettings }, { agentFromSettings }] =
        await Promise.all([
          import('./server/planner'),
          import('./server/imager'),
          import('./server/transcriber'),
          import('./server/narrator'),
          import('./server/agent'),
        ]);
      const apiApp = createApp({
        settings: () => ({
          key: (process.env.META_API_KEY ?? localEnv.META_API_KEY ?? '').trim(),
          requestLimit,
        }),
        planner: plannerFromSettings(localEnv),
        imager: imagerFromSettings(localEnv),
        transcriber: transcriberFromSettings(localEnv),
        narrator: narratorFromSettings(localEnv, path.resolve(__dirname, '.artifacts/narration')),
        agent: agentFromSettings(localEnv),
      });
      server.middlewares.use(apiApp);
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), localAiPlugin(), anchorShotSamApiPlugin()],
    optimizeDeps: {entries: ['index.html']},
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: "127.0.0.1",
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {ignored: ['**/.artifacts/**', '**/.git/**']},
    },
  };
});
