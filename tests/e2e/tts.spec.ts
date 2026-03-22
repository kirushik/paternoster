import { test, expect, type Page } from '@playwright/test';

/** Inject fake voices so hasVoiceForLang() returns true for the given languages. */
async function mockVoices(page: Page, langs: string[]): Promise<void> {
  await page.evaluate((ls) => {
    const fakeVoices = ls.map(lang => ({
      lang,
      name: `Fake ${lang}`,
      voiceURI: `fake:${lang}`,
      localService: true,
      default: false,
    })) as SpeechSynthesisVoice[];
    window.speechSynthesis.getVoices = () => fakeVoices;
    window.speechSynthesis.dispatchEvent(new Event('voiceschanged'));
  }, langs);
}

test.describe('TTS functionality', () => {
  test('TTS button exists', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await expect(page.locator('#tts-btn')).toBeVisible();
  });

  test('TTS button disabled when no voice for selected theme', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    // No voices → button disabled
    await page.evaluate(() => {
      window.speechSynthesis.getVoices = () => [];
      window.speechSynthesis.dispatchEvent(new Event('voiceschanged'));
    });
    await expect(page.locator('#tts-btn')).toBeDisabled();
  });

  test('TTS button enabled after matching voice becomes available', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');

    // Start with no voices
    await page.evaluate(() => {
      window.speechSynthesis.getVoices = () => [];
      window.speechSynthesis.dispatchEvent(new Event('voiceschanged'));
    });
    await expect(page.locator('#tts-btn')).toBeDisabled();

    // Russian voice loads asynchronously
    await mockVoices(page, ['ru-RU']);
    await expect(page.locator('#tts-btn')).toBeEnabled();
  });

  test('TTS button calls speechSynthesis.speak with correct text', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await mockVoices(page, ['ru-RU']);

    await page.fill('#input', 'Тест');
    await page.waitForTimeout(300);

    // Set up interceptor BEFORE clicking
    await page.evaluate(() => {
      (window as any).__ttsCallArgs = null;
      const origGetVoices = window.speechSynthesis.getVoices;
      window.speechSynthesis.speak = function(u: SpeechSynthesisUtterance) {
        (window as any).__ttsCallArgs = { text: u.text, lang: u.lang };
      };
      window.speechSynthesis.getVoices = origGetVoices;
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
    await mockVoices(page, ['ru-RU', 'la']);

    await page.selectOption('#theme-select', 'PATER');
    await page.fill('#input', 'Test message');
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      (window as any).__ttsLang = null;
      const origGetVoices = window.speechSynthesis.getVoices;
      window.speechSynthesis.speak = function(u: SpeechSynthesisUtterance) {
        (window as any).__ttsLang = u.lang;
      };
      window.speechSynthesis.getVoices = origGetVoices;
    });

    await page.click('#tts-btn');
    await page.waitForTimeout(200);

    const lang = await page.evaluate(() => (window as any).__ttsLang);
    expect(lang).toBe('la');
  });

  test('TTS uses Chinese for КИТАЙ theme', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await mockVoices(page, ['ru-RU', 'zh-CN']);

    await page.selectOption('#theme-select', 'КИТАЙ');
    await page.fill('#input', 'Test');
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      (window as any).__ttsLang = null;
      const origGetVoices = window.speechSynthesis.getVoices;
      window.speechSynthesis.speak = function(u: SpeechSynthesisUtterance) {
        (window as any).__ttsLang = u.lang;
      };
      window.speechSynthesis.getVoices = origGetVoices;
    });

    await page.click('#tts-btn');
    await page.waitForTimeout(200);

    const lang = await page.evaluate(() => (window as any).__ttsLang);
    expect(lang).toBe('zh-CN');
  });

  test('TTS toggle: click to speak, click to stop', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await mockVoices(page, ['ru-RU']);

    await page.fill('#input', 'Текст для чтения');
    await page.waitForTimeout(300);

    // Mock speechSynthesis
    await page.evaluate(() => {
      let speaking = false;
      const origGetVoices = window.speechSynthesis.getVoices;
      Object.defineProperty(window.speechSynthesis, 'speaking', { get: () => speaking, configurable: true });
      window.speechSynthesis.speak = () => { speaking = true; };
      window.speechSynthesis.cancel = () => { speaking = false; };
      window.speechSynthesis.getVoices = origGetVoices;
    });

    await page.click('#tts-btn');
    const btnText1 = await page.textContent('#tts-btn');
    expect(btnText1).toBe('🔇');

    await page.click('#tts-btn');
    const btnText2 = await page.textContent('#tts-btn');
    expect(btnText2).toBe('🔊');
  });
});
