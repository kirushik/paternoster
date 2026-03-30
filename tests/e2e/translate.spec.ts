import { test, expect, type Page } from '@playwright/test';
import { selectTheme } from './helpers';

/** Inject a mock Translator API (Chrome 138+ shape) into the page. */
async function mockTranslationAPI(
  page: Page,
  opts: { availability?: string; translateFn?: string } = {},
): Promise<void> {
  const availability = opts.availability ?? 'available';
  const translateFn = opts.translateFn ?? `return 'переведено: ' + text`;
  await page.evaluate(
    ([avail, trFn]) => {
      (globalThis as any).Translator = {
        availability: async () => avail,
        create: async () => ({
          translate: new Function('text', trFn) as (text: string) => Promise<string>,
          destroy: () => {},
        }),
      };
    },
    [availability, translateFn] as const,
  );
}

test.describe('Translation functionality', () => {
  test('Translate button hidden when API not available', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await expect(page.locator('#translate-btn')).toBeHidden();
  });

  test('Translate button hidden for Russian themes', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await mockTranslationAPI(page);
    await selectTheme(page, 'БОЖЕ');
    await page.waitForTimeout(100);
    await expect(page.locator('#translate-btn')).toBeHidden();
  });

  test('Translate button visible for КИТАЙ theme when API available', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await mockTranslationAPI(page);
    await selectTheme(page, 'КИТАЙ');
    await expect(page.locator('#translate-btn')).toBeVisible();
  });

  test('Translate button visible for TRUMP theme when API available', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await mockTranslationAPI(page);
    await selectTheme(page, 'TRUMP');
    await expect(page.locator('#translate-btn')).toBeVisible();
  });

  test('Translation appears alongside stego text, not replacing it', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await mockTranslationAPI(page);
    await selectTheme(page, 'КИТАЙ');

    await page.fill('#input', 'Тест');
    await expect(page.locator('#output')).not.toBeEmpty();
    const stegoText = await page.textContent('#output');

    // Click translate
    await page.click('#translate-btn');
    await expect(page.locator('#translate-output')).toHaveClass(/visible/);

    // Stego text is unchanged
    const stegoAfter = await page.textContent('#output');
    expect(stegoAfter).toBe(stegoText);

    // Translation appears in separate div
    const translation = await page.textContent('#translate-output');
    expect(translation).toContain('переведено');

    // Button shows active state
    await expect(page.locator('#translate-btn')).toHaveClass(/translate-on/);
  });

  test('Translate toggle: click again hides translation', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await mockTranslationAPI(page);
    await selectTheme(page, 'КИТАЙ');

    await page.fill('#input', 'Тест');
    await expect(page.locator('#output')).not.toBeEmpty();

    // Show translation
    await page.click('#translate-btn');
    await expect(page.locator('#translate-output')).toHaveClass(/visible/);

    // Hide translation
    await page.click('#translate-btn');
    await expect(page.locator('#translate-output')).not.toHaveClass(/visible/);
    await expect(page.locator('#translate-btn')).not.toHaveClass(/translate-on/);
  });

  test('Translation div has user-select: none (anti-copy)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await mockTranslationAPI(page);
    await selectTheme(page, 'КИТАЙ');

    await page.fill('#input', 'Тест');
    await expect(page.locator('#output')).not.toBeEmpty();

    await page.click('#translate-btn');
    await expect(page.locator('#translate-output')).toHaveClass(/visible/);

    const userSelect = await page.locator('#translate-output').evaluate(
      el => getComputedStyle(el).userSelect,
    );
    expect(userSelect).toBe('none');
  });

  test('Copy copies stego text even when translation is visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await mockTranslationAPI(page);
    await selectTheme(page, 'КИТАЙ');

    await page.fill('#input', 'Тест');
    await expect(page.locator('#output')).not.toBeEmpty();
    const stegoText = await page.textContent('#output');

    // Show translation
    await page.click('#translate-btn');
    await expect(page.locator('#translate-output')).toHaveClass(/visible/);

    // Copy
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.click('#copy-btn');

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(stegoText);
  });

  test('Translation cleared on theme change', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await mockTranslationAPI(page);
    await selectTheme(page, 'КИТАЙ');

    await page.fill('#input', 'Тест');
    await expect(page.locator('#output')).not.toBeEmpty();

    await page.click('#translate-btn');
    await expect(page.locator('#translate-output')).toHaveClass(/visible/);

    // Switch theme
    await selectTheme(page, 'БОЖЕ');
    await expect(page.locator('#translate-output')).not.toHaveClass(/visible/);
    await expect(page.locator('#translate-btn')).toBeHidden();
  });

  test('Translation cleared on new input', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await mockTranslationAPI(page);
    await selectTheme(page, 'КИТАЙ');

    await page.fill('#input', 'Тест');
    await expect(page.locator('#output')).not.toBeEmpty();

    await page.click('#translate-btn');
    await expect(page.locator('#translate-output')).toHaveClass(/visible/);

    // Type new text
    await page.fill('#input', 'Другой текст');
    await page.waitForTimeout(200); // debounce
    await expect(page.locator('#translate-output')).not.toHaveClass(/visible/);
    await expect(page.locator('#translate-btn')).not.toHaveClass(/translate-on/);
  });

  test('Loading indicator shown during translation', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await mockTranslationAPI(page, {
      translateFn: `return new Promise(r => setTimeout(() => r('done'), 500))`,
    });
    await selectTheme(page, 'КИТАЙ');

    await page.fill('#input', 'Тест');
    await expect(page.locator('#output')).not.toBeEmpty();

    await page.click('#translate-btn');
    await expect(page.locator('#translate-btn')).toBeDisabled();

    await page.waitForFunction(
      () => !document.getElementById('translate-btn')!.hasAttribute('disabled'),
      null,
      { timeout: 2000 },
    );
    await expect(page.locator('#translate-btn')).toBeEnabled();
  });

  test('Translate button hidden when API returns "unavailable"', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await mockTranslationAPI(page, { availability: 'unavailable' });
    await selectTheme(page, 'КИТАЙ');
    await page.waitForTimeout(100);
    await expect(page.locator('#translate-btn')).toBeHidden();
  });

  test('Translation in "Я" mode translates only stego text, not invite labels', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    // Track what text the translator receives
    await page.evaluate(() => {
      (window as any).__translatedInput = null;
      (globalThis as any).Translator = {
        availability: async () => 'available',
        create: async () => ({
          translate: async (text: string) => {
            (window as any).__translatedInput = text;
            return 'translated: ' + text;
          },
          destroy: () => {},
        }),
      };
    });

    // Enter "Я" mode with КИТАЙ theme
    await selectTheme(page, 'КИТАЙ');
    await page.click('[data-id="self"]');
    await expect(page.locator('.invite-stego')).toBeVisible();

    // Wait for translate availability check
    await expect(page.locator('#translate-btn')).toBeVisible();

    // Get the stego text that should be translated
    const stegoOnly = await page.locator('.invite-stego').textContent();

    // Click translate
    await page.click('#translate-btn');
    await expect(page.locator('#translate-output')).toHaveClass(/visible/);

    // Verify the translator received ONLY the stego text, not the full invite section
    const translatedInput = await page.evaluate(() => (window as any).__translatedInput);
    expect(translatedInput).toBe(stegoOnly);

    // Specifically: should NOT contain invite labels or URLs
    expect(translatedInput).not.toContain('Ваш код');
    expect(translatedInput).not.toContain('Ссылка');
    expect(translatedInput).not.toContain('http');
  });
});
