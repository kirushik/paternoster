import { describe, it, expect } from 'vitest';
import { stegoEncode, stegoDecode } from '../../src/stego';
import { THEMES, type ThemeId } from '../../src/dictionaries';

// Helper: generate test byte arrays
function allBytes(): Uint8Array {
  const a = new Uint8Array(256);
  for (let i = 0; i < 256; i++) a[i] = i;
  return a;
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

describe('stego roundtrip per theme', () => {
  const themes: ThemeId[] = ['БОЖЕ', 'РОССИЯ', 'СССР', 'БУХАЮ', 'КИТАЙ', 'PATER', '🙂', 'hex'];

  for (const themeId of themes) {
    describe(`theme: ${themeId}`, () => {
      it('roundtrips all 256 byte values', () => {
        const input = allBytes();
        const encoded = stegoEncode(input, themeId);
        const decoded = stegoDecode(encoded);
        expect(decoded).not.toBeNull();
        expect(decoded!.bytes).toEqual(input);
      });

      it('roundtrips short data (1 byte)', () => {
        for (const b of [0, 1, 127, 128, 255]) {
          const input = new Uint8Array([b]);
          const encoded = stegoEncode(input, themeId);
          const decoded = stegoDecode(encoded);
          expect(decoded).not.toBeNull();
          expect(decoded!.bytes).toEqual(input);
        }
      });

      it('roundtrips random 50-byte data', () => {
        const input = randomBytes(50);
        const encoded = stegoEncode(input, themeId);
        const decoded = stegoDecode(encoded);
        expect(decoded).not.toBeNull();
        expect(decoded!.bytes).toEqual(input);
      });

      it('auto-detects theme correctly', () => {
        const input = randomBytes(10);
        const encoded = stegoEncode(input, themeId);
        const decoded = stegoDecode(encoded);
        expect(decoded).not.toBeNull();
        // hex may or may not be detected as 'hex' specifically
        if (themeId !== 'hex') {
          expect(decoded!.theme).toBe(themeId);
        }
      });
    });
  }
});

describe('stego auto-detection', () => {
  it('returns null for plain Russian text', () => {
    const result = stegoDecode('Привет, как дела?');
    expect(result).toBeNull();
  });

  it('does not confuse themes', () => {
    const input = randomBytes(20);
    const bozhe = stegoEncode(input, 'БОЖЕ');
    const pater = stegoEncode(input, 'PATER');
    const rossiya = stegoEncode(input, 'РОССИЯ');

    expect(stegoDecode(bozhe)!.theme).toBe('БОЖЕ');
    expect(stegoDecode(pater)!.theme).toBe('PATER');
    expect(stegoDecode(rossiya)!.theme).toBe('РОССИЯ');
  });

  it('КИТАЙ detection works for CJK-starting text', () => {
    const input = new Uint8Array([10, 20, 30]);
    const encoded = stegoEncode(input, 'КИТАЙ');
    const decoded = stegoDecode(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.theme).toBe('КИТАЙ');
  });
});

describe('stego FE0F robustness', () => {
  it('model-16 decodes with FE0F stripped', () => {
    const input = randomBytes(10);
    let encoded = stegoEncode(input, 'РОССИЯ');
    // Strip all FE0F
    encoded = encoded.replace(/\uFE0F/g, '');
    const decoded = stegoDecode(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.bytes).toEqual(input);
  });

  it('model-256 decodes with FE0F stripped', () => {
    const input = randomBytes(10);
    let encoded = stegoEncode(input, '🙂');
    encoded = encoded.replace(/\uFE0F/g, '');
    const decoded = stegoDecode(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.bytes).toEqual(input);
  });
});

describe('large payload roundtrip (safety counter regression)', () => {
  const model16Themes: ThemeId[] = ['РОССИЯ', 'СССР', 'БУХАЮ'];

  for (const themeId of model16Themes) {
    it(`roundtrips 6000 random bytes through ${themeId} (model-16)`, () => {
      const input = randomBytes(6000);
      const encoded = stegoEncode(input, themeId);
      const decoded = stegoDecode(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded!.bytes).toEqual(input);
    });
  }

  it('roundtrips 6000 random bytes through all themes', () => {
    const allThemes: ThemeId[] = ['БОЖЕ', 'РОССИЯ', 'СССР', 'БУХАЮ', 'КИТАЙ', 'PATER', '🙂', 'hex'];
    const input = randomBytes(6000);
    for (const themeId of allThemes) {
      const encoded = stegoEncode(input, themeId);
      const decoded = stegoDecode(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded!.bytes).toEqual(input);
    }
  });

  for (const themeId of model16Themes) {
    it(`auto-detects theme correctly for large payload in ${themeId}`, () => {
      const input = randomBytes(6000);
      const encoded = stegoEncode(input, themeId);
      const decoded = stegoDecode(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded!.theme).toBe(themeId);
    });
  }
});

describe('model-16 boundary and stress tests', () => {
  const model16Themes: ThemeId[] = ['РОССИЯ', 'СССР', 'БУХАЮ'];

  // Old safety counter was 10000 iterations = 5000 bytes. Test boundaries.
  for (const themeId of model16Themes) {
    it(`roundtrips exactly 4999 bytes through ${themeId}`, () => {
      const input = randomBytes(4999);
      const encoded = stegoEncode(input, themeId);
      const decoded = stegoDecode(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded!.bytes).toEqual(input);
    });

    it(`roundtrips exactly 5000 bytes through ${themeId}`, () => {
      const input = randomBytes(5000);
      const encoded = stegoEncode(input, themeId);
      const decoded = stegoDecode(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded!.bytes).toEqual(input);
    });

    it(`roundtrips exactly 5001 bytes through ${themeId}`, () => {
      const input = randomBytes(5001);
      const encoded = stegoEncode(input, themeId);
      const decoded = stegoDecode(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded!.bytes).toEqual(input);
    });
  }

  for (const themeId of model16Themes) {
    it(`roundtrips 10000 bytes through ${themeId}`, () => {
      const input = randomBytes(10000);
      const encoded = stegoEncode(input, themeId);
      const decoded = stegoDecode(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded!.bytes).toEqual(input);
    });

    it(`roundtrips 20000 bytes through ${themeId}`, () => {
      const input = randomBytes(20000);
      const encoded = stegoEncode(input, themeId);
      const decoded = stegoDecode(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded!.bytes).toEqual(input);
    });
  }
});

describe('truncated large encoded text', () => {
  const model16Themes: ThemeId[] = ['РОССИЯ', 'СССР', 'БУХАЮ'];

  for (const themeId of model16Themes) {
    it(`truncated large ${themeId} message does not crash`, () => {
      const input = randomBytes(6000);
      const encoded = stegoEncode(input, themeId);
      // Truncate at various points
      for (const fraction of [0.25, 0.5, 0.75]) {
        const truncated = encoded.substring(0, Math.floor(encoded.length * fraction));
        expect(() => stegoDecode(truncated)).not.toThrow();
      }
    });
  }
});

describe('malformed input does not hang', () => {
  it('long random ASCII string returns null promptly', () => {
    const garbage = 'abcdefghijklmnopqrstuvwxyz '.repeat(1000);
    const start = performance.now();
    const result = stegoDecode(garbage);
    const elapsed = performance.now() - start;
    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(1000); // must complete within 1 second
  });

  it('long random Cyrillic string returns null promptly', () => {
    const garbage = 'Это просто обычный русский текст без всякого смысла. '.repeat(200);
    const start = performance.now();
    const result = stegoDecode(garbage);
    const elapsed = performance.now() - start;
    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('stego handles edge cases', () => {
  it('empty input encodes to empty or padding-only', () => {
    // hex produces empty string
    const hex = stegoEncode(new Uint8Array([]), 'hex');
    expect(hex).toBe('');

    // model-4096/1024 themes produce padding tokens (roundtrip to empty)
    for (const themeId of ['БОЖЕ', 'КИТАЙ', '🙂'] as const) {
      const encoded = stegoEncode(new Uint8Array([]), themeId);
      expect(encoded.length).toBeGreaterThan(0);
      const decoded = stegoDecode(encoded);
      if (decoded !== null) {
        expect(decoded.bytes).toEqual(new Uint8Array([]));
      }
    }
  });

  it('truncated encoded text does not crash', () => {
    const input = randomBytes(20);
    const encoded = stegoEncode(input, 'БОЖЕ');
    // Take only first half
    const truncated = encoded.substring(0, Math.floor(encoded.length / 2));
    // Should not throw — may return null or partial data
    const decoded = stegoDecode(truncated);
    if (decoded !== null) {
      // Partial decode: fewer bytes than original
      expect(decoded.bytes.length).toBeLessThan(input.length);
    }
  });
});
