import { spawn } from 'child_process';
import fs from 'fs';

const prompt = fs.readFileSync('scripts/review_prompt.txt', 'utf8');

const child = spawn('claude', ['--bare', '--dangerously-skip-permissions', '-p', prompt], {
  shell: true,
  stdio: ['pipe', 'pipe', 'pipe']
});

let output = '';
let errOutput = '';

child.stdout.on('data', d => { output += d.toString(); });
child.stderr.on('data', d => { errOutput += d.toString(); });

child.on('close', code => {
  console.log('Exit code:', code);
  console.log('--- OUTPUT ---');
  console.log(output);
  if (errOutput) console.log('--- STDERR ---', errOutput);
  fs.writeFileSync('C:/Users/buzman/.gemini/antigravity-cli/brain/d918e4dd-ae3f-4a4e-b8b0-672ac8b88d8d/CLAUDE_OPUS_REVIEW_REPORT.md', output || errOutput);
});

// Close stdin immediately to signal EOF!
child.stdin.end();
