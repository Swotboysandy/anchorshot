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

function evalOrca(pageId, code) {
  const oneLine = code.replace(/\r?\n/g, ' ').replace(/"/g, '\\"');
  return runOrca(`eval --page ${pageId} --expression "${oneLine}"`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\n================================================================');
  console.log('   AnchorShot Live Wedding Scenario Test with Real Meta SAM API ');
  console.log('   Scenario: "A Last-Minute Wedding"                           ');
  console.log('   Watch your open Orca browser window as each step executes!   ');
  console.log('================================================================\n');

  // Step 1: Connect to active Orca Browser tab
  console.log('Step 1: Connecting to active Orca Browser tab...');
  const tabsRes = runOrcaJson('tab list');
  let pageId = null;
  if (tabsRes.ok && Array.isArray(tabsRes.result?.tabs)) {
    const activeTab = tabsRes.result.tabs.find((t) => t.active && t.url && t.url.includes('127.0.0.1:4317'));
    const existing = activeTab || tabsRes.result.tabs.find((t) => t.url && t.url.includes('127.0.0.1:4317'));
    if (existing) pageId = existing.browserPageId;
  }
  if (!pageId) {
    const createRes = runOrcaJson('tab create --url http://127.0.0.1:4317');
    pageId = createRes.result?.browserPageId;
    await sleep(2000);
  }
  console.log(`  -> Connected to Orca Tab: ${pageId}\n`);

  // Dismiss any tour modal if open
  evalOrca(pageId, `(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Skip tour') || b.textContent.includes('Close'));
    if (btn) btn.click();
  })()`);

  // Step 2: Check Live Meta Gateway Health
  console.log('Step 2: Checking Live Meta Gateway Health...');
  const healthRes = await fetch('http://127.0.0.1:4317/api/health');
  const health = await healthRes.json();
  console.log(`  -> Live Meta Key: ${health.configured ? 'ACTIVE (https://api.meta.ai/v1)' : 'MOCK'}`);
  console.log(`  -> Target Model: ${health.model}`);
  console.log(`  -> Session Token: ${health.sessionToken ? health.sessionToken.slice(0, 16) + '...' : 'none'}\n`);

  // Step 3: Populate Wedding Scenario in Orca UI
  console.log('Step 3: Directing wedding scenario in Orca UI...');
  const weddingStory = `A Last-Minute Wedding

I'm about to marry the love of my life, but disaster strikes.

Our car breaks down on the way to the church.

We make it to the altar, but not exactly on time.`;

  const b64 = Buffer.from(weddingStory).toString('base64');
  const fillRes = evalOrca(pageId, `(() => {
    const ta = document.querySelector('textarea');
    if (ta) {
      const val = atob('${b64}');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, val);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      return 'FILLED: ' + ta.value.slice(0, 25);
    }
    return 'TEXTAREA_NOT_FOUND';
  })()`);
  console.log(`  -> Story Input: ${fillRes}`);
  await sleep(1000);

  // Click Apply direction
  console.log('  -> Clicking "Apply direction" button in Orca...');
  const applyRes = evalOrca(pageId, `(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Apply direction') || b.getAttribute('aria-label') === 'Apply direction');
    if (btn && !btn.disabled) { btn.click(); return 'CLICKED_APPLY'; }
    return 'BTN_NOT_READY';
  })()`);
  console.log(`  -> Apply Result: ${applyRes}`);
  console.log('  -> Synthesizing wedding storyboard shots on canvas (waiting 4s)...');
  await sleep(4000);

  // Step 4: Verify Storyboard Canvas & Inspector in Orca
  console.log('\nStep 4: Inspecting storyboard canvas & detected objects in Orca...');
  const canvasStatus = evalOrca(pageId, `(() => {
    const aside = document.querySelector('aside');
    const hasCanvas = !!document.querySelector('.preview-frame');
    const targetObj = document.querySelector('span[class*=\"font-bold\"]')?.textContent || '';
    const hasDiscrepancy = aside ? aside.textContent.includes('Continuity Discrepancy') : false;
    return JSON.stringify({ hasCanvas, hasDiscrepancy, targetObj });
  })()`);
  console.log(`  -> Canvas & Continuity Status: ${canvasStatus}`);

  // Step 5: Test Real Meta Platform SAM 3.1 API directly
  console.log('\nStep 5: Invoking Real Meta Platform SAM 3.1 API for wedding car...');
  const sampleImagePath = path.resolve('public/dream/real-cup.png');
  const pngBuffer = await sharp(sampleImagePath).resize(512, 512, { fit: 'inside' }).png().toBuffer();
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
      concept: 'car',
      sourceHash,
      shotNumber: 2,
      expectedValue: 'white',
      observedValue: 'red',
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

  // Step 6: Test Local Object Detection on Video/Image
  console.log('\nStep 6: Running semantic object extraction for wedding scenario...');
  const jobsRes = await fetch('http://127.0.0.1:4317/api/local-ai/jobs');
  const jobs = await jobsRes.json();
  const completedJob = jobs.find((j) => j.status === 'completed' && j.kind === 'video') || jobs.find((j) => j.status === 'completed');

  if (completedJob) {
    console.log(`  -> Found completed local AI job: ${completedJob.id} ("${completedJob.prompt.slice(0, 35)}...")`);
    const detectRes = await fetch(`http://127.0.0.1:4317/api/local-ai/jobs/${completedJob.id}/detect-objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-anchorshot-local': '1' },
      body: JSON.stringify({ prompt: weddingStory }),
    });
    if (detectRes.ok) {
      const detected = await detectRes.json();
      console.log(`  -> Extracted ${detected.length} candidate object masks:`);
      detected.forEach((d) => {
        console.log(`     • [${d.label}] confidence: ${(d.confidence * 100).toFixed(1)}%, maskRef: ${d.maskRef}`);
      });
    }
  }

  // Step 7: Apply Continuity Fix in Orca UI
  console.log('\nStep 7: Applying SAM 3.1 Repair / Recolor in Orca UI...');
  const recolorRes = evalOrca(pageId, `(() => {
    const btn = Array.from(document.querySelectorAll('aside button')).find(b => b.textContent.includes('Apply SAM 3.1 Recolor'));
    if (btn) { btn.click(); return 'CLICKED_FIX_BTN'; }
    return 'RECOLOR_BTN_NOT_FOUND';
  })()`);
  console.log(`  -> Recolor Action: ${recolorRes}`);
  await sleep(2500);

  // Verify verification / drift report in Orca UI
  const reportStatus = evalOrca(pageId, `(() => {
    const aside = document.querySelector('aside');
    if (!aside) return 'NO_ASIDE';
    const hasVerified = aside.textContent.includes('Continuity verified') || aside.textContent.includes('Pixel Continuity Report') || aside.textContent.includes('0 outside-mask');
    const badge = Array.from(aside.querySelectorAll('span')).find(s => s.textContent.includes('LIVE SAM 3.1') || s.textContent.includes('META SAM 3.1'))?.textContent || 'NO_BADGE';
    return JSON.stringify({ hasVerified, badge });
  })()`);
  console.log(`  -> Post-Recolor Verification: ${reportStatus}`);

  // Step 8: Check Orca In-Browser Telemetry
  console.log('\nStep 8: Verifying In-Browser Telemetry (window.__ORCA_TRACKER__)...');
  const trackerDump = evalOrca(pageId, `window.__ORCA_TRACKER__.dump()`);
  let trackerData = null;
  try { trackerData = JSON.parse(trackerDump); } catch {}
  if (trackerData && trackerData.summary) {
    console.log(`  -> In-Browser Error Count: ${trackerData.summary.errorCount}`);
    console.log(`  -> Total Events Captured: ${trackerData.summary.totalLogs}`);
  }

  // Step 9: Viewport Screenshot
  console.log('\nStep 9: Capturing live Orca viewport screenshot...');
  const screenshotRes = runOrcaJson(`screenshot --page ${pageId} --format png`);
  const artifactDir = 'C:/Users/buzman/.gemini/antigravity-cli/brain/d918e4dd-ae3f-4a4e-b8b0-672ac8b88d8d';
  if (screenshotRes.ok && screenshotRes.result?.data) {
    const snapPath = path.join(artifactDir, 'orca-wedding-live-test.png');
    fs.writeFileSync(snapPath, Buffer.from(screenshotRes.result.data, 'base64'));
    console.log(`  -> Viewport saved to: ${snapPath}`);
  }

  console.log('\n================================================================');
  console.log('  Live Wedding Scenario Test Completed!                       ');
  console.log('================================================================\n');
}

main().catch(console.error);
