/**
 * Visual regression tests: screenshot comparison for key UI states.
 *
 * These capture baseline screenshots and diff against them on future runs.
 * Update baselines with: npx playwright test --update-snapshots
 *
 * Note: visual tests are sensitive to platform rendering differences (fonts, etc).
 * Run on a consistent environment (CI or the same local machine) for reliable diffs.
 */
import { test, expect } from '@playwright/test';

test.describe('visual regression', () => {
  test('default messaging mode', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    // Wait for key generation and UI to settle — "Я" pill + "+" button
    await expect(page.locator('.contact-pill')).toHaveCount(2);

    await expect(page).toHaveScreenshot('default-messaging.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('broadcast mode (warm background + banner)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    await page.click('#mode-toggle');
    await page.waitForSelector('#broadcast-banner');

    await expect(page).toHaveScreenshot('broadcast-mode.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  // Note: tests for "self profile" and "encoded output" were removed because
  // they contain crypto-derived text that differs per run, making screenshot
  // comparison inherently flaky even with masks. The layout structure for those
  // states is indirectly covered by the functional E2E tests.
});
