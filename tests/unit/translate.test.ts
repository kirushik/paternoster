import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasTranslationAPI, canTranslateFrom, translateText, disposeTranslators } from '../../src/translate';

describe('translate module', () => {
  afterEach(() => {
    disposeTranslators();
    vi.unstubAllGlobals();
  });

  test('hasTranslationAPI() returns false when Translator is absent', () => {
    expect(hasTranslationAPI()).toBe(false);
  });

  test('hasTranslationAPI() returns true when Translator exists', () => {
    vi.stubGlobal('Translator', {
      availability: vi.fn(),
      create: vi.fn(),
    });
    expect(hasTranslationAPI()).toBe(true);
  });

  test('canTranslateFrom() returns "unavailable" when API is absent', async () => {
    expect(await canTranslateFrom('zh')).toBe('unavailable');
  });

  test('canTranslateFrom() returns "unavailable" when API throws', async () => {
    vi.stubGlobal('Translator', {
      availability: vi.fn().mockRejectedValue(new Error('fail')),
    });
    expect(await canTranslateFrom('zh')).toBe('unavailable');
  });

  test('canTranslateFrom() forwards the API result', async () => {
    vi.stubGlobal('Translator', {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn(),
    });
    expect(await canTranslateFrom('zh')).toBe('available');
    expect(globalThis.Translator!.availability).toHaveBeenCalledWith({
      sourceLanguage: 'zh',
      targetLanguage: 'ru',
    });
  });

  describe('translateText()', () => {
    const mockTranslator = {
      translate: vi.fn().mockResolvedValue('переведено'),
      destroy: vi.fn(),
    };

    beforeEach(() => {
      mockTranslator.translate.mockClear();
      mockTranslator.destroy.mockClear();
      vi.stubGlobal('Translator', {
        availability: vi.fn().mockResolvedValue('available'),
        create: vi.fn().mockResolvedValue(mockTranslator),
      });
    });

    test('creates translator and returns translated text', async () => {
      const result = await translateText('你好', 'zh');
      expect(result).toBe('переведено');
      expect(globalThis.Translator!.create).toHaveBeenCalledWith({
        sourceLanguage: 'zh',
        targetLanguage: 'ru',
      });
      expect(mockTranslator.translate).toHaveBeenCalledWith('你好');
    });

    test('caches translator for same language', async () => {
      await translateText('你好', 'zh');
      await translateText('世界', 'zh');
      expect(globalThis.Translator!.create).toHaveBeenCalledTimes(1);
      expect(mockTranslator.translate).toHaveBeenCalledTimes(2);
    });

    test('creates new translator for different language', async () => {
      await translateText('你好', 'zh');
      await translateText('hello', 'en');
      expect(globalThis.Translator!.create).toHaveBeenCalledTimes(2);
    });
  });

  test('disposeTranslators() calls destroy on cached translators', async () => {
    const mockTranslator = {
      translate: vi.fn().mockResolvedValue('ok'),
      destroy: vi.fn(),
    };
    vi.stubGlobal('Translator', {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn().mockResolvedValue(mockTranslator),
    });

    await translateText('test', 'zh');
    disposeTranslators();
    expect(mockTranslator.destroy).toHaveBeenCalledTimes(1);

    // After dispose, next translateText should create a new translator
    await translateText('test2', 'zh');
    expect(globalThis.Translator!.create).toHaveBeenCalledTimes(2);
  });
});
