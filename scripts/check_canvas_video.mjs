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

async function run() {
  console.log('Connecting to Orca tab:', pageId);

  // 1. Dismiss tour
  evalOrca(pageId, `(() => {
    const skip = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Skip tour') || b.textContent.includes('Close'));
    if (skip) skip.click();
  })()`);
  await sleep(1000);

  // 2. Click a director preset or enter story
  const clickSample = evalOrca(pageId, `(() => {
    // Look for preset button or sample pill
    const pills = Array.from(document.querySelectorAll('button'));
    const preset = pills.find(b => b.textContent.includes('Space Mission') || b.textContent.includes('space') || b.textContent.includes('Fix shot 2'));
    if (preset) { preset.click(); return 'CLICKED_PRESET: ' + preset.textContent.trim(); }
    
    // Or click "Paste a script" and "Create storyboard"
    const scriptTab = pills.find(b => b.textContent.includes('Paste a script'));
    if (scriptTab) scriptTab.click();
    
    const genBtn = pills.find(b => b.textContent.includes('Create storyboard'));
    if (genBtn && !genBtn.disabled) { genBtn.click(); return 'CLICKED_CREATE_STORYBOARD'; }
    
    return 'PRESET_OR_GEN_NOT_FOUND';
  })()`);
  console.log('Story trigger:', clickSample);
  await sleep(3000);

  // 3. Check for Canvas .preview-frame and active shot
  const status = evalOrca(pageId, `(() => {
    const frame = document.querySelector('.preview-frame');
    const video = frame ? frame.querySelector('video') : null;
    const badge = frame ? frame.querySelector('span[class*=\"font-bold\"], div[class*=\"bg-[#10B981]\"]') : null;
    const shotBadge = frame ? frame.querySelector('.preview-tag') : null;
    return JSON.stringify({
      hasFrame: !!frame,
      hasVideo: !!video,
      videoSrc: video?.getAttribute('src'),
      badgeText: badge?.textContent || '',
      shotTag: shotBadge?.textContent || '',
    });
  })()`);
  console.log('Canvas State:', status);

  // 4. If frame has no video yet, select Shot 2 and click "Use video in Shot 2"
  const selectRes = evalOrca(pageId, `(() => {
    const shot2Btn = document.querySelector('button[aria-label="Select shot 2"]');
    if (shot2Btn) { shot2Btn.click(); }
    const useVidBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Use video in Shot 2'));
    if (useVidBtn) { useVidBtn.click(); return 'CLICKED_USE_VIDEO_SHOT_2'; }
    return 'USE_VIDEO_BTN_NOT_FOUND';
  })()`);
  console.log('Video Selection Result:', selectRes);
  await sleep(1500);

  // 5. Re-check Canvas
  const finalCanvas = evalOrca(pageId, `(() => {
    const frame = document.querySelector('.preview-frame');
    const video = frame ? frame.querySelector('video') : null;
    const badge = frame ? frame.querySelector('div[class*=\"bg-[#10B981]\"]') : null;
    return JSON.stringify({
      hasFrame: !!frame,
      hasVideo: !!video,
      videoSrc: video?.getAttribute('src'),
      badgeText: badge?.textContent || '',
    });
  })()`);
  console.log('Final Canvas Video State:', finalCanvas);

  // 6. Capture screenshot
  const screenshotRaw = runOrca(`screenshot --page ${pageId} --format png --json`);
  try {
    const parsed = JSON.parse(screenshotRaw);
    if (parsed.ok && parsed.result?.data) {
      const artifactDir = 'C:/Users/buzman/.gemini/antigravity-cli/brain/d918e4dd-ae3f-4a4e-b8b0-672ac8b88d8d';
      const snapPath = path.join(artifactDir, 'orca-canvas-video-preview.png');
      fs.writeFileSync(snapPath, Buffer.from(parsed.result.data, 'base64'));
      console.log('Saved screenshot to:', snapPath);
    }
  } catch (e) {
    console.error('Screenshot error:', e);
  }
}

run().catch(console.error);
