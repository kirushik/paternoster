import { test, expect } from '@playwright/test';
import { selectTheme } from './helpers';

test.describe('status bar pipeline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
  });

  test('pipeline markers appear after encoding', async ({ page }) => {
    await page.fill('#input', 'Привет');
    await expect(page.locator('#output')).not.toBeEmpty();

    const status = page.locator('#status');
    await expect(status).toContainText('📝');
    await expect(status).toContainText('🔒');
    await expect(status).toContainText('📤');
  });

  test('pipeline numbers are positive', async ({ page }) => {
    await page.fill('#input', 'Тестовое сообщение');
    await expect(page.locator('#output-mode-label')).toContainText('Зашифровано');

    await expect(page.locator('#status')).toContainText('📝');
    const text = await page.locator('#status').textContent();
    // Extract numbers after emoji markers: 📝N → 🔒N → 📤N
    const inputMatch = text!.match(/📝(\d+)/);
    const wireMatch = text!.match(/🔒(\d+)/);
    const outputMatch = text!.match(/📤(\d+)/);

    expect(inputMatch).not.toBeNull();
    expect(wireMatch).not.toBeNull();
    expect(outputMatch).not.toBeNull();

    expect(Number(inputMatch![1])).toBeGreaterThan(0);
    expect(Number(wireMatch![1])).toBeGreaterThan(0);
    expect(Number(outputMatch![1])).toBeGreaterThan(0);
  });

  test('pipeline disappears when decoding own message', async ({ page }) => {
    // Encode a message
    await page.fill('#input', 'Привет');
    await expect(page.locator('#output-mode-label')).toContainText('Зашифровано');
    const encoded = await page.locator('#output').textContent();

    // Clear and paste encoded text back to decode
    await page.fill('#input', '');
    await page.fill('#input', encoded!);

    // Wait for decode to complete
    await expect(page.locator('#output')).toHaveText('Привет', { timeout: 5000 });

    // Pipeline markers should be gone (decode path clears stats)
    const status = await page.locator('#status').textContent();
    expect(status).not.toContain('📝');
  });

  test('theme switch changes output chars but preserves input chars', async ({ page }) => {
    await page.fill('#input', 'Тест');
    await expect(page.locator('#output-mode-label')).toContainText('Зашифровано');

    await expect(page.locator('#status')).toContainText('📝');
    const text1 = await page.locator('#status').textContent();
    const input1 = text1!.match(/📝(\d+)/)![1];
    const output1 = Number(text1!.match(/📤(\d+)/)![1]);

    // Switch theme
    await selectTheme(page, 'КИТАЙ');
    await expect(page.locator('#output')).not.toBeEmpty();
    // Wait for re-encode to reflect in status
    await expect(page.locator('#status')).toContainText('КИТАЙ');

    const text2 = await page.locator('#status').textContent();
    const input2 = text2!.match(/📝(\d+)/)![1];
    const output2 = Number(text2!.match(/📤(\d+)/)![1]);

    // Input chars should stay the same (same plaintext)
    expect(input1).toBe(input2);
    // Output chars should differ (different theme expansion)
    expect(output1).not.toBe(output2);
  });

  test('broadcast mode shows pipeline markers', async ({ page }) => {
    // Enter broadcast mode
    await page.click('#mode-toggle');
    await page.waitForSelector('#input[placeholder*="публикации"]');

    await page.fill('#input', 'Публичное сообщение');
    await expect(page.locator('#output')).not.toBeEmpty();

    const status = page.locator('#status');
    await expect(status).toContainText('📝');
    await expect(status).toContainText('🔒');
    await expect(status).toContainText('📤');
  });

  test('output span has color styling', async ({ page }) => {
    // Use КИТАЙ theme for compact output likely under 280 chars
    await selectTheme(page, 'КИТАЙ');
    await page.fill('#input', 'Тест');
    await expect(page.locator('#output')).not.toBeEmpty();

    // The last span in #status should have a color style
    const outputSpan = page.locator('#status span').last();
    await expect(outputSpan).toBeVisible();
    const color = await outputSpan.evaluate(el => el.style.color);
    expect(color).toBeTruthy();
  });

  test('wire bytes segment has monospace font', async ({ page }) => {
    await page.fill('#input', 'Тест');
    await expect(page.locator('#output')).not.toBeEmpty();

    // The first span (🔒 wire bytes) should have monospace font — inside .pipeline-detail
    const wireSpan = page.locator('#status .pipeline-detail span').first();
    await expect(wireSpan).toBeVisible();
    const font = await wireSpan.evaluate(el => el.style.fontFamily);
    expect(font).toBe('monospace');
  });
});
