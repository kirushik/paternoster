/**
 * Translation decoy: shows a "translation" of themed steganographic text.
 *
 * Uses the Chrome Translator API (Built-in AI, Chrome 138+). On-device,
 * no data sent to servers. Progressive enhancement: gracefully absent
 * in browsers without the API.
 *
 * API reference: https://developer.chrome.com/docs/ai/translator-api
 */

// ── Type declarations for the Translator API (Chrome 138+) ──

type TranslatorAvailability = 'available' | 'downloadable' | 'unavailable';

interface TranslatorInstance {
  translate(text: string): Promise<string>;
  destroy(): void;
}

interface TranslatorConstructor {
  availability(opts: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorAvailability>;
  create(opts: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorInstance>;
}

declare global {
  // eslint-disable-next-line no-var
  var Translator: TranslatorConstructor | undefined;
}

// ── Module state ────────────────────────────────────────────

const TARGET_LANG = 'ru';
const cache = new Map<string, TranslatorInstance>();

// ── Public API ──────────────────────────────────────────────

/** Check if the Translator API exists in this browser. */
export function hasTranslationAPI(): boolean {
  return typeof globalThis.Translator !== 'undefined';
}

/**
 * Check whether translation from `sourceLang` to Russian is available.
 * Returns 'available', 'downloadable', or 'unavailable'.
 */
export async function canTranslateFrom(sourceLang: string): Promise<TranslatorAvailability> {
  if (!hasTranslationAPI()) return 'unavailable';
  try {
    return await globalThis.Translator!.availability({
      sourceLanguage: sourceLang,
      targetLanguage: TARGET_LANG,
    });
  } catch {
    return 'unavailable';
  }
}

/** Translate text from `sourceLang` to Russian. Caches translator per language. */
export async function translateText(text: string, sourceLang: string): Promise<string> {
  if (!hasTranslationAPI()) {
    throw new Error('Translator API is not available');
  }
  let translator = cache.get(sourceLang);
  if (!translator) {
    translator = await globalThis.Translator!.create({
      sourceLanguage: sourceLang,
      targetLanguage: TARGET_LANG,
    });
    cache.set(sourceLang, translator);
  }
  return translator.translate(text);
}

/** Dispose cached translators (call on theme change to free resources). */
export function disposeTranslators(): void {
  for (const t of cache.values()) {
    try { t.destroy(); } catch { /* ignore */ }
  }
  cache.clear();
}
