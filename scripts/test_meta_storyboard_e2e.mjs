import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function runOrca(cmdStr) {
  try {
    return execSync(`orca ${cmdStr}`, { encoding: 'utf8', timeout: 35000, maxBuffer: 50 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
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
  console.log('=== End-to-End Meta Model API Alignment & Storyboard Studio Verification ===\n');

  // Step 1: Detect Active Orca Tab
  const tabsResRaw = runOrca('tab list --json');
  const tabsRes = JSON.parse(tabsResRaw);
  const tabsList = tabsRes.result?.tabs || [];
  const activeTab = tabsList.find(t => t.url && t.url.includes('4317')) || tabsList[0];
  const pageId = activeTab?.browserPageId;
  console.log('Target Orca Tab:', pageId);
  if (!pageId) throw new Error('No active Orca tab found');

  // Step 2: Reload page to ensure clean state with latest build
  console.log('\n[Phase 1] Reloading Orca Tab...');
  evalOrca(pageId, 'window.location.reload()');
  await sleep(3500);

  // Step 3: Check Shot Strip & Storyboard Status
  console.log('\n[Phase 2] Verifying Storyboard Strip & Shot Thumbnails...');
  const shotStripStatus = evalOrca(pageId, `(() => {
    const shotButtons = Array.from(document.querySelectorAll('.shot-strip button, .shot-thumb'));
    return {
      count: shotButtons.length,
      shots: shotButtons.map(b => b.textContent.trim().replace(/\\s+/g, ' ')),
      hasVideo: Boolean(document.querySelector('video')),
      videoSrc: document.querySelector('video')?.src || null,
      activeShotText: document.querySelector('.film-column h2')?.textContent || null
    };
  })()`);
  console.log('Shot Strip Status:', shotStripStatus);

  // Step 4: Click on Shot 2 in the Storyboard strip to verify timestamp seeking
  console.log('\n[Phase 3] Selecting Shot 2 in the Storyboard Strip...');
  const selectShot2 = evalOrca(pageId, `(() => {
    const shotButtons = Array.from(document.querySelectorAll('.shot-strip button, .shot-thumb'));
    if (shotButtons.length >= 2) {
      shotButtons[1].click();
      return 'CLICKED_SHOT_2';
    }
    return 'SHOT_2_NOT_FOUND';
  })()`);
  console.log('Select Shot 2 action:', selectShot2);
  await sleep(1500);

  // Step 5: Test SAM 3.1 / Meta Video Understanding Object Recognition
  console.log('\n[Phase 4] Testing Object Identification (SAM 3.1 & Meta Video Understanding)...');
  const detectObjectsResult = evalOrca(pageId, `(() => {
    const detectBtn = Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent.includes('Identify All Objects in Video') ||
      b.textContent.includes('SAM 3.1')
    );
    if (detectBtn) {
      detectBtn.click();
      return 'CLICKED_IDENTIFY_OBJECTS';
    }
    return 'IDENTIFY_BUTTON_NOT_FOUND';
  })()`);
  console.log('Object identification trigger:', detectObjectsResult);
  await sleep(3000);

  // Step 6: Select Tracked Object and Suggest Generative Edit via muse-image-1.0
  console.log('\n[Phase 5] Directing Generative Edit (Meta muse-image-1.0: "Change car to vintage white convertible")...');
  const genEditResult = evalOrca(pageId, `(() => {
    // Fill generative edit input
    const inputs = Array.from(document.querySelectorAll('input'));
    const genInput = inputs.find(i => i.placeholder && i.placeholder.includes('Change'));
    if (!genInput) return 'GEN_INPUT_NOT_FOUND';

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(genInput, 'Change car to vintage white convertible wedding car');
    genInput.dispatchEvent(new Event('input', { bubbles: true }));
    genInput.dispatchEvent(new Event('change', { bubbles: true }));

    const editBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Edit Frame'));
    if (editBtn) {
      editBtn.click();
      return 'CLICKED_EDIT_FRAME';
    }
    return 'EDIT_FRAME_BTN_NOT_FOUND';
  })()`);
  console.log('Generative Edit trigger:', genEditResult);
  await sleep(4000);

  // Step 7: Capture Final State & Status Announcements
  console.log('\n[Phase 6] Reading System Status & Verification Proof...');
  const finalState = evalOrca(pageId, `(() => {
    const statusText = document.querySelector('[role=\"status\"]')?.textContent || '';
    const notice = Array.from(document.querySelectorAll('p, div')).find(el => el.textContent.includes('0 outside drift') || el.textContent.includes('SAM 3.1'))?.textContent || '';
    const videoProof = Array.from(document.querySelectorAll('div, span')).find(el => el.textContent.includes('16 FRAMES · 0 DRIFT'))?.textContent || '';
    return {
      statusText: statusText.trim().replace(/\\s+/g, ' '),
      notice: notice.trim().replace(/\\s+/g, ' '),
      videoProof: videoProof.trim().replace(/\\s+/g, ' ')
    };
  })()`);
  console.log('Final Verification Status:', finalState);

  // Step 8: Take high-resolution screenshot
  const screenshotPath = 'C:/Users/buzman/.gemini/antigravity-cli/brain/d918e4dd-ae3f-4a4e-b8b0-672ac8b88d8d/meta-storyboard-verified-live.png';
  console.log(`\n[Phase 8] Capturing Orca screenshot to: ${screenshotPath}...`);
  try {
    const shotData = execSync(`orca screenshot --page ${pageId} --json`, {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 50 * 1024 * 1024
    });
    const parsed = JSON.parse(shotData);
    if (parsed.result?.data) {
      fs.writeFileSync(screenshotPath, Buffer.from(parsed.result.data, 'base64'));
      console.log('Screenshot successfully saved!');
    } else {
      console.log('Screenshot json missing data property:', parsed);
    }
  } catch (err) {
    console.error('Screenshot error:', err.message);
  }

  console.log('\n=== E2E Test Run Complete ===');
}

main().catch(console.error);
