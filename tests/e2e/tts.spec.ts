import { test, expect } from '@playwright/test';

test.describe('TTS functionality', () => {
  test('TTS button exists', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await expect(page.locator('#tts-btn')).toBeVisible();
  });

  test('TTS button calls speechSynthesis.speak with correct text', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    await page.fill('#input', 'Тест');
    await page.waitForTimeout(300);

    // Set up interceptor BEFORE clicking
    await page.evaluate(() => {
      (window as any).__ttsCallArgs = null;
      const orig = window.speechSynthesis.speak;
      window.speechSynthesis.speak = function(u: SpeechSynthesisUtterance) {
        (window as any).__ttsCallArgs = { text: u.text, lang: u.lang };
      };
    });

    await page.click('#tts-btn');
    await page.waitForTimeout(200);

    const args = await page.evaluate(() => (window as any).__ttsCallArgs);
    expect(args).not.toBeNull();
    expect(args.text).toBeTruthy();
    expect(args.lang).toBe('ru-RU');
  });

  test('TTS uses correct language for PATER theme', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    await page.selectOption('#theme-select', 'PATER');
    await page.fill('#input', 'Test message');
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      (window as any).__ttsLang = null;
      window.speechSynthesis.speak = function(u: SpeechSynthesisUtterance) {
        (window as any).__ttsLang = u.lang;
      };
    });

    await page.click('#tts-btn');
    await page.waitForTimeout(200);

    const lang = await page.evaluate(() => (window as any).__ttsLang);
    expect(lang).toBe('la');
  });

  test('TTS uses Chinese for КИТАЙ theme', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    await page.selectOption('#theme-select', 'КИТАЙ');
    await page.fill('#input', 'Test');
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      (window as any).__ttsLang = null;
      window.speechSynthesis.speak = function(u: SpeechSynthesisUtterance) {
        (window as any).__ttsLang = u.lang;
      };
    });

    await page.click('#tts-btn');
    await page.waitForTimeout(200);

    const lang = await page.evaluate(() => (window as any).__ttsLang);
    expect(lang).toBe('zh-CN');
  });

  test('TTS toggle: click to speak, click to stop', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    await page.fill('#input', 'Текст для чтения');
    await page.waitForTimeout(300);

    // Mock speechSynthesis
    await page.evaluate(() => {
      let speaking = false;
      Object.defineProperty(window.speechSynthesis, 'speaking', { get: () => speaking, configurable: true });
      window.speechSynthesis.speak = () => { speaking = true; };
      window.speechSynthesis.cancel = () => { speaking = false; };
    });

    await page.click('#tts-btn');
    const btnText1 = await page.textContent('#tts-btn');
    expect(btnText1).toBe('🔇');

    await page.click('#tts-btn');
    const btnText2 = await page.textContent('#tts-btn');
    expect(btnText2).toBe('🔊');
  });
});
