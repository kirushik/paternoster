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
    // Wait for key generation and UI to settle
    await expect(page.locator('.contact-pill')).toHaveCount(1); // "Я" pill

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

  test('contact panel (self profile with invite token)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    await page.click('[data-id="self"]');
    await expect(page.locator('.invite-token')).toBeVisible();

    await expect(page).toHaveScreenshot('self-profile.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('message encoded in output', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    await page.fill('#input', 'Тестовое сообщение для скриншота');
    await expect(page.locator('#output')).not.toBeEmpty();

    await expect(page).toHaveScreenshot('encoded-output.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});
