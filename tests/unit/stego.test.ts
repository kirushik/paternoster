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

  it('does not confuse themes with different prefixes', () => {
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

describe('stego handles edge cases', () => {
  it('empty input encodes to prefix+suffix or empty', () => {
    const bozhe = stegoEncode(new Uint8Array([]), 'БОЖЕ');
    expect(bozhe.length).toBeGreaterThan(0); // prefix + suffix with no data tokens
    // Decoding prefix+suffix alone returns null (no byte data between markers)
    // or an empty-bytes result depending on decoder — either is acceptable
    const decoded = stegoDecode(bozhe);
    if (decoded !== null) {
      expect(decoded.bytes).toEqual(new Uint8Array([]));
    }

    const hex = stegoEncode(new Uint8Array([]), 'hex');
    expect(hex).toBe('');
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
