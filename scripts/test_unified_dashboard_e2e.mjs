import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function runOrca(cmdStr) {
  try {
    return execSync(`orca ${cmdStr}`, { encoding: 'utf8', timeout: 30000, maxBuffer: 50 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch (err) {
    return (err.stdout || '').trim();
  }
}

function evalOrca(pageId, code) {
  const oneLine = code.replace(/\r?\n/g, ' ').replace(/"/g, '\\"');
  return runOrca(`eval --page ${pageId} --expression "${oneLine}"`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('--- Testing Unified Dashboard with Sandy Updates & Video Mount in Orca ---');

  // Step 1: Find Orca Tab
  const tabsResRaw = runOrca('tab list --json');
  const tabsRes = JSON.parse(tabsResRaw);
  const activeTab = tabsRes.result?.tabs?.find(t => t.url && t.url.includes('127.0.0.1:4317'));
  const pageId = activeTab?.browserPageId;
  console.log('Active Orca Tab:', pageId);
  if (!pageId) throw new Error('No active Orca tab found');

  // Step 2: Test [Y] Fix / Apply SAM 3.1 repair
  console.log('\nStep 2: Clicking "[Y] to Fix" in the inspector...');
  const fixClick = evalOrca(pageId, `(() => {
    const fixBtn = Array.from(document.querySelectorAll('button, div')).find(el => el.textContent.includes('[Y] to Fix') || el.textContent.includes('Apply SAM 3.1 Recolor'));
    if (fixBtn) { fixBtn.click(); return 'CLICKED_FIX_ALERT'; }
    // Try dispatching keyboard Y
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', bubbles: true }));
    return 'DISPATCHED_KEY_Y';
  })()`);
  console.log('Fix action:', fixClick);
  await sleep(2000);

  // Step 3: Test Scene Details Editor inline editing
  console.log('\nStep 3: Testing Sandy SceneDetailsEditor (modifying duration to 4.2s)...');
  const editDetailsRes = evalOrca(pageId, `(() => {
    const durInput = document.querySelector('input[type=\"number\"]') || Array.from(document.querySelectorAll('input')).find(i => i.value === '3.5');
    if (!durInput) return 'DURATION_INPUT_NOT_FOUND';
    
    // Set value to 4.2
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(durInput, '4.2');
    durInput.dispatchEvent(new Event('input', { bubbles: true }));
    durInput.dispatchEvent(new Event('change', { bubbles: true }));

    const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Save changes'));
    if (saveBtn) { saveBtn.click(); return 'CLICKED_SAVE_SCENE_DETAILS'; }
    return 'SAVE_BTN_NOT_FOUND';
  })()`);
  console.log('Scene details edit:', editDetailsRes);
  await sleep(1500);

  // Step 4: Test Switching to Review Workspace Tab
  console.log('\nStep 4: Testing Workspace Switch to "Review"...');
  const switchReview = evalOrca(pageId, `(() => {
    const reviewTrigger = Array.from(document.querySelectorAll('button, [role=\"tab\"]')).find(el => el.textContent.includes('Review') && el.getAttribute('role') === 'tab');
    if (reviewTrigger) { reviewTrigger.click(); return 'SWITCHED_TO_REVIEW_TAB'; }
    return 'REVIEW_TAB_NOT_FOUND';
  })()`);
  console.log('Switch to Review:', switchReview);
  await sleep(2000);

  // Step 5: Capture Screenshot of Review Workspace
  console.log('\nStep 5: Capturing screenshot of Review Workspace...');
  const screenRaw = runOrca(`screenshot --page ${pageId} --format png --json`);
  const screenData = JSON.parse(screenRaw);
  const reviewSnapPath = path.resolve('C:/Users/buzman/.gemini/antigravity-cli/brain/d918e4dd-ae3f-4a4e-b8b0-672ac8b88d8d/sandy-review-workspace.png');
  fs.writeFileSync(reviewSnapPath, Buffer.from(screenData.result.data, 'base64'));
  console.log('Saved Review screenshot to:', reviewSnapPath);

  // Step 6: Switch back to Create Workspace
  console.log('\nStep 6: Switching back to "Create" Workspace...');
  evalOrca(pageId, `(() => {
    const createTrigger = Array.from(document.querySelectorAll('button, [role=\"tab\"]')).find(el => el.textContent.includes('Create') && el.getAttribute('role') === 'tab');
    if (createTrigger) createTrigger.click();
  })()`);
  await sleep(1500);

  // Final check: dump tracker metrics
  const trackerJson = evalOrca(pageId, `JSON.stringify(window.__ORCA_TRACKER__.dump())`);
  const tracker = JSON.parse(trackerJson);
  console.log('\n--- Final Telemetry ---');
  console.log('Total tracked logs:', tracker.summary?.totalLogs);
  console.log('Errors:', tracker.summary?.errorCount);
  console.log('Status:', tracker.summary?.status);
}

main().catch(console.error);
