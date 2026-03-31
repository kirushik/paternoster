import { test, expect } from '@playwright/test';
import { selectTheme } from './helpers';

test.describe('basic functionality', () => {
  test('page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.waitForSelector('#input');
    expect(errors).toEqual([]);
  });

  test('generates key on first visit and persists on reload', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    const key1 = await page.evaluate(() => localStorage.getItem('paternoster_private_key'));
    expect(key1).toBeTruthy();
    expect(key1!.length).toBe(64); // 32 bytes as hex

    // Reload
    await page.reload();
    await page.waitForSelector('#input');
    const key2 = await page.evaluate(() => localStorage.getItem('paternoster_private_key'));
    expect(key2).toBe(key1);
  });

  test('typing Russian text produces encoded output', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    // Need a contact to encrypt for — use self
    await page.fill('#input', 'Привет, мир!');
    await expect(page.locator('#output')).not.toBeEmpty();

    const output = await page.textContent('#output');
    expect(output).toBeTruthy();
    expect(output!.length).toBeGreaterThan(0);
  });

  test('changing theme re-encodes output', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    await page.fill('#input', 'Тест');
    await expect(page.locator('#output')).not.toBeEmpty();
    const output1 = await page.textContent('#output');

    await selectTheme(page, 'РОССИЯ');
    // Theme change triggers re-encode; wait for output to change
    await expect(page.locator('#output')).not.toHaveText(output1!);
    const output2 = await page.textContent('#output');

    expect(output1).not.toBe(output2);
  });

  test('copy button copies output to clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await page.waitForSelector('#input');

    await page.fill('#input', 'Копируемый текст');
    await expect(page.locator('#output')).not.toBeEmpty();

    await page.click('#copy-btn');
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBeTruthy();
  });

  test('CID badge appears with valid CIDv0', async ({ page }) => {
    await page.goto('/');
    const badge = page.locator('.cid-badge');
    await expect(badge).toBeVisible();
    const text = await badge.textContent();
    expect(text).toMatch(/^ipfs:\/\/Qm[1-9A-HJ-NP-Za-km-z]{44}$/);
  });

  test('self-encryption roundtrip: encode then decode own message', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await page.waitForSelector('#input');

    // Type a message (self-encryption is the default when no contact is selected)
    const plaintext = 'Секретное сообщение самому себе';
    await page.fill('#input', plaintext);
    await expect(page.locator('#output-mode-label')).toContainText('Зашифровано');
    const encoded = await page.textContent('#output');
    expect(encoded).toBeTruthy();

    // Clear and paste the encoded output back
    await page.fill('#input', '');
    await page.fill('#input', encoded!);

    // Should decode back to the original plaintext
    await expect(page.locator('#output')).toHaveText(plaintext, { timeout: 5000 });
  });

  test('download button triggers file download', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#download-btn'),
    ]);
    expect(download.suggestedFilename()).toBe('paternoster.html');
  });
});
