import { test, expect, type Page } from '@playwright/test';
import { selectTheme } from './helpers';

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

/**
 * Replace speechSynthesis.speak/cancel with test doubles.
 *
 * The fake voices created by mockVoices() are plain objects, not real
 * SpeechSynthesisVoice instances. When tts.ts does `utterance.voice = voice`,
 * Chromium throws a TypeError. To avoid this, the interceptor also overrides
 * getVoices() to return [] so no voice is matched and the assignment is skipped.
 * cancel() is also replaced so the native implementation doesn't interfere.
 */
async function mockSpeak(page: Page, onSpeak: string): Promise<void> {
  await page.evaluate((body) => {
    Object.defineProperty(window.speechSynthesis, 'cancel', {
      value: () => {},
      writable: true,
      configurable: true,
    });
    // Return empty voices so tts.ts skips the utterance.voice assignment
    window.speechSynthesis.getVoices = () => [];
    Object.defineProperty(window.speechSynthesis, 'speak', {
      value: new Function('u', body),
      writable: true,
      configurable: true,
    });
  }, onSpeak);
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
    await expect(page.locator('#output')).not.toBeEmpty();

    await page.evaluate(() => { (window as any).__ttsCallArgs = null; });
    await mockSpeak(page, `window.__ttsCallArgs = { text: u.text, lang: u.lang };`);

    await page.click('#tts-btn');
    await page.waitForFunction(() => (window as any).__ttsCallArgs !== null);

    const args = await page.evaluate(() => (window as any).__ttsCallArgs);
    expect(args).not.toBeNull();
    expect(args.text).toBeTruthy();
    expect(args.lang).toBe('ru-RU');
  });

  test('TTS uses correct language for PATER theme', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await mockVoices(page, ['ru-RU', 'la']);

    await selectTheme(page, 'PATER');
    await page.fill('#input', 'Test message');
    await expect(page.locator('#output')).not.toBeEmpty();

    await page.evaluate(() => { (window as any).__ttsLang = null; });
    await mockSpeak(page, `window.__ttsLang = u.lang;`);

    await page.click('#tts-btn');
    await page.waitForFunction(() => (window as any).__ttsLang !== null);

    const lang = await page.evaluate(() => (window as any).__ttsLang);
    expect(lang).toBe('la');
  });

  test('TTS uses English for TRUMP theme', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await mockVoices(page, ['ru-RU', 'en-US']);

    await selectTheme(page, 'TRUMP');
    await page.fill('#input', 'Test message');
    await expect(page.locator('#output')).not.toBeEmpty();

    await page.evaluate(() => { (window as any).__ttsLang = null; });
    await mockSpeak(page, `window.__ttsLang = u.lang;`);

    await page.click('#tts-btn');
    await page.waitForFunction(() => (window as any).__ttsLang !== null);

    const lang = await page.evaluate(() => (window as any).__ttsLang);
    expect(lang).toBe('en-US');
  });

  test('TTS uses Chinese for КИТАЙ theme', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await mockVoices(page, ['ru-RU', 'zh-CN']);

    await selectTheme(page, 'КИТАЙ');
    await page.fill('#input', 'Test');
    await expect(page.locator('#output')).not.toBeEmpty();

    await page.evaluate(() => { (window as any).__ttsLang = null; });
    await mockSpeak(page, `window.__ttsLang = u.lang;`);

    await page.click('#tts-btn');
    await page.waitForFunction(() => (window as any).__ttsLang !== null);

    const lang = await page.evaluate(() => (window as any).__ttsLang);
    expect(lang).toBe('zh-CN');
  });

  test('TTS toggle: click to speak, click to stop', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#input');
    await mockVoices(page, ['ru-RU']);

    await page.fill('#input', 'Текст для чтения');
    await expect(page.locator('#output')).not.toBeEmpty();

    // Full mock: speak sets speaking=true, cancel sets speaking=false
    await page.evaluate(() => {
      let speaking = false;
      Object.defineProperty(window.speechSynthesis, 'speaking', { get: () => speaking, configurable: true });
      Object.defineProperty(window.speechSynthesis, 'cancel', {
        value: () => { speaking = false; },
        writable: true,
        configurable: true,
      });
      // Return empty voices so tts.ts skips utterance.voice assignment
      window.speechSynthesis.getVoices = () => [];
      Object.defineProperty(window.speechSynthesis, 'speak', {
        value: () => { speaking = true; },
        writable: true,
        configurable: true,
      });
    });

    await page.click('#tts-btn');
    const btnText1 = await page.textContent('#tts-btn');
    expect(btnText1).toBe('🔇');

    await page.click('#tts-btn');
    const btnText2 = await page.textContent('#tts-btn');
    expect(btnText2).toBe('🔊');
  });
});
