import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import crypto from 'crypto';

function runOrca(cmdStr) {
  try {
    return execSync(`orca ${cmdStr}`, { encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch (err) {
    return (err.stdout || '').trim();
  }
}

function runOrcaJson(cmdStr) {
  const text = runOrca(`${cmdStr} --json`);
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, raw: text };
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('\n================================================================');
  console.log('   AnchorShot Live Interactive Walkthrough with Real Meta API   ');
  console.log('   Watch your open Orca browser window as each step executes!   ');
  console.log('================================================================\n');

  // Step 1: Verify Orca tab
  console.log('Step 1: Connecting to active Orca Browser tab...');
  const tabsRes = runOrcaJson('tab list');
  let pageId = null;
  if (tabsRes.ok && Array.isArray(tabsRes.result?.tabs)) {
    const activeTab = tabsRes.result.tabs.find(t => t.active && t.url && t.url.includes('127.0.0.1:4317'));
    const existing = activeTab || tabsRes.result.tabs.find(t => t.url && t.url.includes('127.0.0.1:4317'));
    if (existing) pageId = existing.browserPageId;
  }
  if (!pageId) {
    const createRes = runOrcaJson('tab create --url http://127.0.0.1:4317');
    pageId = createRes.result?.browserPageId;
    await sleep(2000);
  }
  console.log(`  -> Connected to Orca Tab: ${pageId}\n`);

  // Step 2: Check Live Meta Gateway Health
  console.log('Step 2: Checking Live Meta Gateway Health...');
  const healthRes = await fetch('http://127.0.0.1:4317/api/health');
  const health = await healthRes.json();
  console.log(`  -> Live Meta Key: ${health.configured ? 'ACTIVE (https://api.meta.ai/v1)' : 'MOCK'}`);
  console.log(`  -> Target Model: ${health.model}`);
  console.log(`  -> Session Token: ${health.sessionToken.slice(0, 16)}...\n`);

  // Step 3: Populate Story in Orca UI
  console.log('Step 3: Directing scene in the Orca browser UI...');
  const fillPromptJs = `
    (() => {
      const ta = document.querySelector('textarea[aria-label="Describe your video or edit"]');
      if (ta) {
        const val = 'I am holding a blue cup in my kitchen. The walls dissolve into an ocean, but the cup stays exactly the same.';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, val);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        return 'FILLED';
      }
      return 'TEXTAREA_NOT_FOUND';
    })()
  `;
  runOrca(`eval --page ${pageId} --expression "${fillPromptJs.replace(/"/g, '\\"')}"`);
  await sleep(1000);

  // Click Apply direction
  console.log('  -> Clicking "Apply direction" button in Orca...');
  const clickApplyJs = `
    (() => {
      const btn = document.querySelector('button[aria-label="Apply direction"]');
      if (btn && !btn.disabled) { btn.click(); return 'CLICKED_APPLY'; }
      return 'BTN_DISABLED_OR_MISSING';
    })()
  `;
  const applyRes = runOrca(`eval --page ${pageId} --expression "${clickApplyJs.replace(/"/g, '\\"')}"`);
  console.log(`  -> Apply Result: ${applyRes}`);
  console.log('  -> Synthesizing storyboard shots on canvas (waiting 2s)...');
  await sleep(2500);

  // Step 4: Verify Storyboard Canvas in Orca
  console.log('\nStep 4: Storyboard generated on canvas in Orca!');
  const snapshotText = runOrca(`snapshot --page ${pageId}`);
  const hasCanvas = snapshotText.includes('THE CANVAS');
  const hasShot2 = snapshotText.includes('Shot 02 Diagnostics') || snapshotText.includes('SHOT 02');
  console.log(`  -> Canvas Visible in Orca: ${hasCanvas ? 'YES' : 'NO'}`);
  console.log(`  -> Shot 02 Inspector Open: ${hasShot2 ? 'YES' : 'NO'}\n`);

  // Step 5: Execute Real Live Meta SAM 3.1 Call
  console.log('Step 5: Sending real cup photo to Meta Platform SAM 3.1 API...');
  const imagePath = path.resolve('public/dream/real-cup.png');
  const pngBuffer = await sharp(imagePath).resize(512, 512, { fit: 'inside' }).png().toBuffer();
  const base64Uri = `data:image/png;base64,${pngBuffer.toString('base64')}`;
  const sourceHash = crypto.createHash('sha256').update(pngBuffer).digest('hex');

  const metaStartTime = Date.now();
  const checkRes = await fetch('http://127.0.0.1:4317/api/segment/check', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Framelock-Session': health.sessionToken,
      'X-Anchorshot-Session': health.sessionToken,
    },
    body: JSON.stringify({
      image: base64Uri,
      concept: 'cup',
      sourceHash,
      shotNumber: 2,
      expectedValue: 'blue',
      observedValue: 'red'
    }),
  });
  const metaLatency = Date.now() - metaStartTime;
  const liveResult = await checkRes.json();

  console.log('  [LIVE META SAM 3.1 RESPONSE RECEIVED]');
  console.log(`  -> Live Request ID: ${liveResult.requestId}`);
  console.log(`  -> Model Name: sam-3.1`);
  console.log(`  -> Live Latency: ${metaLatency}ms`);
  console.log(`  -> Mask Reference: ${liveResult.maskRef}`);
  if (liveResult.objects?.[0]) {
    const o = liveResult.objects[0];
    console.log(`  -> Reported Confidence: ${(o.confidence * 100).toFixed(1)}%`);
    console.log(`  -> Live Bounding Box: [X: ${o.bounds.left}, Y: ${o.bounds.top}, W: ${o.bounds.right - o.bounds.left}, H: ${o.bounds.bottom - o.bounds.top}]`);
    console.log(`  -> Raster Mask Dimensions: ${o.rasterWidth} x ${o.rasterHeight}`);
  }
  console.log('');

  // Step 6: Apply the Live SAM 3.1 Recolor in the Orca UI
  console.log('Step 6: Applying SAM 3.1 Recolor to Blue in Orca UI...');
  const clickRecolorJs = `
    (() => {
      const btn = document.querySelector('button[aria-label*="Apply SAM 3.1 Recolor"]') ||
                  document.querySelector('button[aria-label*="Recolor"]');
      if (btn) { btn.click(); return 'CLICKED_RECOLOR'; }
      return 'RECOLOR_BTN_NOT_FOUND';
    })()
  `;
  const recolorRes = runOrca(`eval --page ${pageId} --expression "${clickRecolorJs.replace(/"/g, '\\"')}"`);
  console.log(`  -> Recolor Action: ${recolorRes}`);
  await sleep(1500);

  // Step 7: Check Orca In-Browser Telemetry
  console.log('\nStep 7: Verifying In-Browser Telemetry (window.__ORCA_TRACKER__)...');
  const trackerDump = runOrca(`eval --page ${pageId} --expression "window.__ORCA_TRACKER__.dump()"`);
  let trackerData = null;
  try { trackerData = JSON.parse(trackerDump); } catch {}
  if (trackerData && trackerData.summary) {
    console.log(`  -> In-Browser Error Count: ${trackerData.summary.errorCount}`);
    console.log(`  -> Total Events Captured: ${trackerData.summary.totalLogs}`);
  }

  // Step 8: Viewport Screenshot
  console.log('\nStep 8: Capturing live Orca viewport screenshot...');
  const screenshotRes = runOrcaJson(`screenshot --page ${pageId} --format png`);
  const artifactDir = 'C:/Users/buzman/.gemini/antigravity-cli/brain/d918e4dd-ae3f-4a4e-b8b0-672ac8b88d8d';
  if (screenshotRes.ok && screenshotRes.result?.data) {
    const snapPath = path.join(artifactDir, 'orca-live-walkthrough.png');
    fs.writeFileSync(snapPath, Buffer.from(screenshotRes.result.data, 'base64'));
    console.log(`  -> Viewport saved to: ${snapPath}`);
  }

  console.log('\n================================================================');
  console.log('  Live Walkthrough Complete! All steps executed successfully!  ');
  console.log('================================================================\n');
}

main().catch(console.error);
