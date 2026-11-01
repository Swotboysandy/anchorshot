import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const promptPath = path.resolve('scripts/claude_review_meta_alignment.txt');
const prompt = fs.readFileSync(promptPath, 'utf8');

console.log('Invoking Claude Opus to review Meta Model API alignment...');
try {
  // Pass prompt to claude CLI
  const cmd = `claude -p "${prompt.replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;
  const result = execSync(cmd, {
    encoding: 'utf8',
    timeout: 120000,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024
  });

  const outPath = path.resolve('scripts/claude_review_meta_alignment_output.md');
  fs.writeFileSync(outPath, result, 'utf8');
  console.log(`Claude Opus review written to: ${outPath}`);
  console.log('Preview:');
  console.log(result.slice(0, 1500));
} catch (err) {
  console.error('Claude execution error:', err.message);
  if (err.stdout) console.log('Stdout:', err.stdout.slice(0, 500));
  if (err.stderr) console.error('Stderr:', err.stderr.slice(0, 500));
}
