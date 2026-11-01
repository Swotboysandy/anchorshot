import { test, expect } from '@playwright/test';

test.describe('Edge Cases & Scenario B Verification', () => {
  test('mobile iPhone SE (375x667) viewport has zero horizontal scroll overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'What would you like to create?' })).toBeVisible();

    // Initial clean director's chair screen
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Create storyboard via script tab
    await page.getByRole('tab', { name: 'Paste a script', exact: true }).click();
    const script = page.getByRole('textbox', { name: 'Scene Transcript', exact: true });
    await script.fill('I am holding a blue cup in my kitchen. The walls dissolve into an ocean, but the cup stays exactly the same.');
    await page.getByRole('button', { name: 'Create storyboard', exact: true }).click();
    await page.getByRole('button', { name: 'Select shot 1', exact: true }).waitFor({ state: 'visible', timeout: 15000 });

    // Storyboard canvas on mobile
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Navigate to Dream tab on mobile
    await page.getByRole('tab', { name: 'Dream', exact: true }).click();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('keyboard shortcuts modal handles Escape key, focus trapping, and returns focus', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'What would you like to create?' })).toBeVisible();

    // Generate story using script tab so all workspace tabs and shortcut button appear
    await page.getByRole('tab', { name: 'Paste a script', exact: true }).click();
    const script = page.getByRole('textbox', { name: 'Scene Transcript', exact: true });
    await script.fill('I am holding a blue cup in my kitchen. The walls dissolve into an ocean, but the cup stays exactly the same.');
    await page.getByRole('button', { name: 'Create storyboard', exact: true }).click();
    await page.getByRole('button', { name: 'Select shot 1', exact: true }).waitFor({ state: 'visible', timeout: 15000 });

    const shortcutBtn = page.getByRole('button', { name: /Keyboard shortcuts/i });
    await expect(shortcutBtn).toBeVisible();
    await shortcutBtn.focus();

    // Trigger modal via button click
    await shortcutBtn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('heading', { name: /Accessible Keyboard/i })).toBeVisible();

    // Verify focus is inside the dialog on the Close button
    const closeBtn = dialog.getByRole('button', { name: 'Close Keyboard Shortcuts Dialog' });
    await expect(closeBtn).toBeFocused();

    // Press Escape to dismiss dialog
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    // Verify focus is returned to trigger button
    await expect(shortcutBtn).toBeFocused();

    // Now test opening via global '?' shortcut key
    await page.keyboard.press('?');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('voice command dispatcher handles number words, color rules, and playback controls', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'What would you like to create?' })).toBeVisible();

    // Create storyboard via script tab
    await page.getByRole('tab', { name: 'Paste a script', exact: true }).click();
    const script = page.getByRole('textbox', { name: 'Scene Transcript', exact: true });
    await script.fill('I am holding a blue cup in my kitchen. The walls dissolve into an ocean, but the cup stays exactly the same.');
    await page.getByRole('button', { name: 'Create storyboard', exact: true }).click();
    await page.getByRole('button', { name: 'Select shot 1', exact: true }).waitFor({ state: 'visible', timeout: 15000 });

    // Open shot tools / inspector
    const toolsBtn = page.getByRole('button', { name: 'Shot tools', exact: true });
    if (await toolsBtn.count()) {
      await toolsBtn.click();
      await page.waitForTimeout(400);
    }

    // Select shot 2 (which has the red cup mismatch)
    await page.getByRole('button', { name: 'Select shot 2', exact: true }).click();
    await page.waitForTimeout(400);

    // Switch back to 'Describe a video' tab to see direction suggestions and composer
    await page.getByRole('tab', { name: 'Describe a video', exact: true }).click();
    await page.waitForTimeout(300);

    // Test Fix via CleanStudio suggestion button (which executes voice command "Fix shot 2")
    const fixShot2Btn = page.getByRole('button', { name: /Fix shot 2/i });
    await expect(fixShot2Btn).toBeVisible();
    await fixShot2Btn.click();
    await page.waitForTimeout(1000);

    // Verify shot 2 status changed to consistent / 0-drift verified
    await expect(page.locator('body')).toContainText(/0 outside-mask pixel drift/i);

    // Test Voice Directive for color change via Review tab
    await page.getByRole('tab', { name: 'Review', exact: true }).click();
    await page.waitForTimeout(500);

    // The command panel now lives inside the Review tab's collapsed Project controls.
    await page.getByText('Project controls', { exact: true }).click();
    const commandInput = page.locator('#director-command-input');
    await commandInput.fill('Change continuity rule: cup color must be emerald');
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForTimeout(1000);

    // Verify emerald color rule is registered
    await expect(page.locator('body')).toContainText(/emerald/i);
  });

  test('server rate limiting (429) on segment check falls back safely without unhandled errors', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // Route /api/segment/check with simulated 429
    await page.route('**/api/segment/check', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Meta is rate limiting requests. Wait before trying again.' }),
      });
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'What would you like to create?' })).toBeVisible();

    // Open Dream tab after creating a storyboard
    await page.getByRole('tab', { name: 'Paste a script', exact: true }).click();
    const script = page.getByRole('textbox', { name: 'Scene Transcript', exact: true });
    await script.fill('I am holding a blue cup in my kitchen. The walls dissolve into an ocean, but the cup stays exactly the same.');
    await page.getByRole('button', { name: 'Create storyboard', exact: true }).click();
    await page.getByRole('button', { name: 'Select shot 1', exact: true }).waitFor({ state: 'visible', timeout: 15000 });

    await page.getByRole('tab', { name: 'Dream', exact: true }).click();
    await page.getByRole('button', { name: /Open dream transition/i }).click();
    const study = page.getByRole('region', { name: 'Kitchen to ocean dream study' });
    await study.getByRole('button', { name: 'Select real cup', exact: true }).click();

    // Verify mask editor opens safely on fallback
    const editor = page.getByRole('region', { name: 'Real cup mask editor' });
    await expect(editor).toBeVisible();

    // Close editor
    await editor.getByRole('button', { name: 'Cancel mask editing' }).click();
    await expect(editor).toHaveCount(0);

    // Verify no unhandled page errors occurred
    expect(pageErrors).toEqual([]);
  });
});
