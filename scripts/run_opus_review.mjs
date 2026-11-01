import { spawnSync } from 'child_process';
import fs from 'fs';

const prompt = `You are Claude Opus (v5.5 architecture review).
Review the Storyboard Studio and Meta Model API alignment in MetaHT:
1. Video & Audio Understanding: Meta 'muse-spark-1.3' on /v1/responses.
2. Object Recognition & Multi-Frame Tracking: Meta 'sam-3.1' stream wire protocol (<0f>1<|box;x1=...|><|mask;...|>).
3. Generative Voice Direction & Inpainting Edits: Meta 'muse-image-1.0' on POST /v1/images/edits with Sharp 0-drift pixel compositing.
4. Storyboard Ingestion: 16-frame video keyframes ingested into .shot-strip with interactive timestamp seeking.

Provide:
- Architecture alignment verdict (Aligned / Needs Attention)
- Assessment of the 4 pillars
- Concrete recommendations for the hackathon presentation and live demo.`;

console.log('Invoking Claude Opus review...');
const res = spawnSync('claude', ['--bare', '--dangerously-skip-permissions', '-p', prompt], {
  encoding: 'utf8',
  timeout: 60000,
  maxBuffer: 10 * 1024 * 1024,
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe']
});

const output = res.stdout || res.stderr || '';
console.log('--- Claude Opus Review Output ---');
console.log(output);

fs.writeFileSync('C:/Users/buzman/.gemini/antigravity-cli/brain/d918e4dd-ae3f-4a4e-b8b0-672ac8b88d8d/CLAUDE_OPUS_REVIEW_REPORT.md', `# Claude Opus 5.5 Architecture & Storyboard Review

${output}
`);
console.log('Report written to artifacts.');
