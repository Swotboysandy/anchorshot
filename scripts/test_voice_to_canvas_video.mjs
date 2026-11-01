import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function runOrca(cmdStr) {
  try {
    return execSync(`orca ${cmdStr}`, { encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch (err) {
    return (err.stdout || '').trim();
  }
}

function evalOrca(pageId, code) {
  const oneLine = code.replace(/\r?\n/g, ' ').replace(/"/g, '\\"');
  return runOrca(`eval --page ${pageId} --expression "${oneLine}"`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pageId = '69f37a65-d2ba-48fd-bb86-9d05d872f0fa';

async function main() {
  console.log('--- Testing Prompt Submission to Canvas Video Preview in Orca ---');

  // Step 1: Click starter pill "A dream in space"
  const clickPill = evalOrca(pageId, `(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('A dream in space'));
    if (btn) { btn.click(); return 'CLICKED_DREAM_IN_SPACE'; }
    return 'PILL_NOT_FOUND';
  })()`);
  console.log('Starter suggestion pill:', clickPill);
  await sleep(800);

  // Step 2: Click "Apply direction"
  const clickApply = evalOrca(pageId, `(() => {
    const btn = document.querySelector('button[aria-label="Apply direction"]');
    if (btn && !btn.disabled) { btn.click(); return 'CLICKED_APPLY'; }
    return 'APPLY_BTN_DISABLED_OR_MISSING: ' + (btn ? 'disabled=' + btn.disabled : 'not_found');
  })()`);
  console.log('Apply direction click:', clickApply);

  console.log('Waiting 6s for storyboard synthesis and canvas video auto-mounting...');
  await sleep(6000);

  // Step 3: Inspect Canvas Preview
  const canvasState = evalOrca(pageId, `(() => {
    const frame = document.querySelector('.preview-frame');
    if (!frame) return JSON.stringify({ hasFrame: false });
    const video = frame.querySelector('video');
    const badge = frame.querySelector('div[class*=\"bg-[#10B981]\"]');
    const shotTag = frame.querySelector('.preview-tag');
    return JSON.stringify({
      hasFrame: true,
      hasVideo: !!video,
      videoSrc: video?.getAttribute('src'),
      videoControls: video?.hasAttribute('controls'),
      badgeText: badge?.textContent || '',
      shotTag: shotTag?.textContent?.trim() || ''
    });
  })()`);
  console.log('Canvas State:', canvasState);

  // Step 4: Capture screenshot
  const screenshotRaw = runOrca(`screenshot --page ${pageId} --format png --json`);
  try {
    const parsed = JSON.parse(screenshotRaw);
    if (parsed.ok && parsed.result?.data) {
      const artifactDir = 'C:/Users/buzman/.gemini/antigravity-cli/brain/d918e4dd-ae3f-4a4e-b8b0-672ac8b88d8d';
      const snapPath = path.join(artifactDir, 'orca-canvas-video-preview.png');
      fs.writeFileSync(snapPath, Buffer.from(parsed.result.data, 'base64'));
      console.log('Canvas screenshot saved to:', snapPath);
    }
  } catch (e) {
    console.error('Screenshot error:', e);
  }
}

main().catch(console.error);
