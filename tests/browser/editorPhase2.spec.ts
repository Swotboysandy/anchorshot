import { test, expect } from '@playwright/test';

test('phase 2 video editor controls: takes stack, split-screen wipe, and BITC export', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What would you like to create?' })).toBeVisible();

  // Create storyboard from direction
  await page.getByRole('textbox', { name: 'Describe your video or edit' }).fill(
    'A kitchen opens onto an ocean. A blue cup stays in place.'
  );
  await page.getByRole('button', { name: 'Apply direction', exact: true }).click();
  await page.getByRole('region', { name: 'Film preview' }).waitFor();

  // 1. Verify BITC toggle in action bar
  const bitcCheckbox = page.getByRole('checkbox', { name: 'BITC' });
  await expect(bitcCheckbox).toBeVisible();
  await expect(bitcCheckbox).not.toBeChecked();
  await bitcCheckbox.check();
  await expect(bitcCheckbox).toBeChecked();
  await expect(page.getByRole('button', { name: /Export MP4 \(BITC\)/ })).toBeVisible();

  // 2. Select shot 2 (mismatched red cup)
  await page.getByRole('button', { name: 'Select shot 2' }).click();

  // Apply SAM 3.1 fix via [Y] shortcut
  await page.keyboard.press('y');

  // Toggle Before/After Split Wipe via [B] shortcut in the preview frame
  await page.keyboard.press('b');
  const splitRegion = page.getByRole('region', { name: /split wipe/i });
  await expect(splitRegion).toBeVisible();
  await expect(page.getByText('◄ BEFORE | AFTER ►')).toBeVisible();

  // 3. Navigate to Review workspace to inspect the Takes stack and slider
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: /Scene 2/i }).click();

  // Verify Takes / Version Stack has Take 1 and Take 2
  await expect(page.getByRole('button', { name: 'Take 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take 2', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take 2', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Verify Split Wipe Slider in inspector
  const slider = page.getByRole('slider', { name: /Split comparison position slider/i });
  await expect(slider).toBeVisible();
  await slider.fill('75');
  await expect(page.getByText('75%')).toBeVisible();

  // 4. Keyboard shortcut [T] cycles takes
  await slider.blur();
  await page.keyboard.press('t');
  await expect(page.getByRole('button', { name: 'Take 1', exact: true })).toHaveAttribute('aria-pressed', 'true');

  expect(errors).toEqual([]);
});
