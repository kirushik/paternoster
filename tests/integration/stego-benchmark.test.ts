import { describe, it, expect } from 'vitest';
import { stegoEncode, stegoDecode } from '../../src/stego';
import { type ThemeId } from '../../src/dictionaries';
import { MAX_STEGO_CHARS } from '../../src/constants';

const THEMES: ThemeId[] = ['БОЖЕ', 'РОССИЯ', 'СССР', 'БУХАЮ', 'КИТАЙ', 'PATER', '🙂', 'hex', 'TRUMP'];

/** Deterministic pseudo-random bytes (simple LCG, seed-based). */
function seededBytes(n: number, seed = 42): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
    out[i] = (s >>> 24) & 0xFF;
  }
  return out;
}

describe('stego output stays within transport limits', () => {
  for (const themeId of THEMES) {
    it(`${themeId}: 1000 bytes produces stego under ${MAX_STEGO_CHARS} chars`, () => {
      const input = seededBytes(1000);
      const encoded = stegoEncode(input, themeId);
      expect(encoded.length).toBeLessThan(MAX_STEGO_CHARS);
    });
  }

  it('worst-case theme (БУХАЮ ~12x) exceeds limit at ~4300 bytes', () => {
    // БУХАЮ has ~11.8x expansion, so 50000/11.8 ≈ 4237 bytes is the threshold.
    // tab1 and tab2 have identical average token lengths (5.875 chars each),
    // so Math.random() table switching has zero effect on expected output length.
    const input = seededBytes(4300);
    const encoded = stegoEncode(input, 'БУХАЮ');
    expect(encoded.length).toBeGreaterThan(MAX_STEGO_CHARS);
  });

  it('TRUMP (~23x expansion) exceeds limit at ~2600 bytes', () => {
    // Theoretical threshold is ~2173 bytes (50000/23), but TRUMP has highly
    // variable token lengths (5–18 chars) and Math.random() tab switching.
    // 2600 bytes provides comfortable margin against low-expansion runs.
    const input = seededBytes(2600);
    const encoded = stegoEncode(input, 'TRUMP');
    expect(encoded.length).toBeGreaterThan(MAX_STEGO_CHARS);
  });

  it('РОССИЯ (~8x expansion) exceeds limit at ~7500 bytes', () => {
    // РОССИЯ tab1 (emoji, ~2 chars avg) and tab2 (words, ~6 chars avg) have
    // asymmetric lengths, so output length has higher variance. Using 7500 bytes
    // (expected ~59,700 chars) provides safe margin even at 5σ deviation.
    const input = seededBytes(7500);
    const encoded = stegoEncode(input, 'РОССИЯ');
    expect(encoded.length).toBeGreaterThan(MAX_STEGO_CHARS);
  });
});
