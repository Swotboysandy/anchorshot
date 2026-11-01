import { execSync } from 'child_process';
import fs from 'fs';

const reviewPrompt = `Perform a comprehensive, rigorous code review of the Meta Model API integration in MetaHT (Anchorshot):

Scope of Code Reviewed:
1. 'server/app.ts':
   - POST /api/meta/video-understand (muse-spark-1.3 on /v1/responses)
   - POST /api/meta/edit-frame (muse-image-1.0 on /v1/images/edits + sharp 0-drift compositing)
   - POST /api/video/ingest-shots (16-frame video keyframes mapped to discrete shots)
2. 'src/components/CleanStudio.tsx':
   - .shot-strip keyframes display and interactive timeline seeking on click
3. 'src/components/ShotInspectorPanel.tsx':
   - SAM 3.1 multi-frame object tracking (16 frames, candidate objects, bounding boxes, confidence)
   - Direct Voice & Generative Edit (muse-image-1.0)
4. 'src/services/metaModels.ts':
   - Client methods understandVideoWithMuseSpark, editFrameGenerative, ingestShotsFromVideo

Evaluate:
A. Architectural Compliance with Meta Model API documentation (https://dev.meta.ai/docs/overview)
B. 0-Drift Pixel Compositing Integrity (Sharp dest-in alpha cutout vs background preservation)
C. Local RTX 4070 AnimateDiff fallback vs Live Meta Model API resilience
D. Identified strengths, potential risks, and concrete recommendations for the live hackathon demo.`;

console.log('Invoking ZCode with Claude Opus 5 (new-provider-3/claude-opus-5)...');
try {
  const result = execSync(
    'zcode -p "' + reviewPrompt.replace(/"/g, '\\"') + '" --model new-provider-3/claude-opus-5',
    {
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 20 * 1024 * 1024,
      env: process.env,
    }
  );

  console.log('\n--- ZCODE CLAUDE OPUS 5 REVIEW OUTPUT ---');
  console.log(result);

  fs.writeFileSync(
    'C:/Users/buzman/.gemini/antigravity-cli/brain/d918e4dd-ae3f-4a4e-b8b0-672ac8b88d8d/ZCODE_OPUS_CODE_REVIEW_REPORT.md',
    `# ZCode Claude Opus 5 Architecture & Code Review Report\n\n${result}`
  );
  console.log('\nSuccessfully saved review to ZCODE_OPUS_CODE_REVIEW_REPORT.md');
} catch (err) {
  console.error('Error running zcode review:', err.message);
  if (err.stdout) console.log('Stdout:', err.stdout);
  if (err.stderr) console.error('Stderr:', err.stderr);
}
