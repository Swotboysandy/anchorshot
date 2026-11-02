import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import express from 'express';
import { parse } from 'dotenv';
import { createApp } from './app';
import { createLocalAi } from './localAi';
import { imagerFromSettings } from './imager';
import { agentFromSettings } from './agent';
import { plannerFromSettings } from './planner';
import { transcriberFromSettings } from './transcriber';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function localSettings() {
  let values: Record<string, string> = {};
  try {
    values = parse(readFileSync(resolve(root, '.env.local')));
    const rawBaseUrl = values.META_API_BASE_URL ?? values.VITE_META_API_BASE_URL;
    if (rawBaseUrl && !process.env.META_API_BASE_URL) {
      process.env.META_API_BASE_URL = rawBaseUrl;
    }
  } catch {
    /* Keyless offline mode is supported. */
  }
  const rawLimit = (process.env.SAM_MAX_REQUESTS ?? values.SAM_MAX_REQUESTS ?? '').trim();
  const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : 10;
  const requestLimit =
    Number.isInteger(parsedLimit) && parsedLimit >= 0 && parsedLimit <= 100 ? parsedLimit : 10;

  return {
    key: (process.env.META_API_KEY ?? values.META_API_KEY ?? '').trim(),
    requestLimit,
    port: Number(process.env.PORT ?? values.PORT ?? 4317),
    values,
  };
}
const app = express();
const localAi = createLocalAi(root);
app.use('/api/local-ai', localAi.app);
app.use(createApp({ settings: localSettings, planner: plannerFromSettings(localSettings().values),
  imager: imagerFromSettings(localSettings().values),
  transcriber: transcriberFromSettings(localSettings().values),
  agent: agentFromSettings(localSettings().values) }));
const server = createServer(app);
server.once('close', () => localAi.stop('Local server stopped.'));
if (process.argv.includes('--production')) {
  app.use(express.static(resolve(root, 'dist')));
  app.use((_req, res) => res.sendFile(resolve(root, 'dist/index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true, ws: { server } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}
const port = localSettings().port;
server.once('error', (error) => {
  console.error(`Could not start the local server: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const actualPort = address && typeof address !== 'string' ? address.port : port;
  console.log(`Frame lab: http://127.0.0.1:${actualPort} (local only)`);
});
