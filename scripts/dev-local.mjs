// Local-only launcher: overrides .env.local providers without modifying credentials.
import {spawn} from 'node:child_process';
const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port=4317', '--host=127.0.0.1', '--strictPort'], {
  stdio: 'inherit', windowsHide: true,
  env: {...process.env, META_API_KEY: '', PLANNER_PROVIDER: 'offline', IMAGE_PROVIDER: 'offline', TRANSCRIBE_PROVIDER: 'offline', AGENT_PROVIDER: 'offline', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1'},
});
child.on('error', error => {console.error(error.message); process.exitCode = 1;});
child.on('exit', code => {process.exitCode = code ?? 1;});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
