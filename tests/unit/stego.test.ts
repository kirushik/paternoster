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
  const themes: ThemeId[] = ['БОЖЕ', 'РОССИЯ', 'СССР', 'БУХАЮ', 'КИТАЙ', 'PATER', '🙂', 'hex', 'TRUMP'];

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

  it('returns null for plain English text', () => {
    const result = stegoDecode('The weather is nice today and I like pizza');
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
  const model16Themes: ThemeId[] = ['РОССИЯ', 'СССР', 'БУХАЮ', 'TRUMP'];

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
  const model16Themes: ThemeId[] = ['РОССИЯ', 'СССР', 'БУХАЮ', 'TRUMP'];

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
  const model16Themes: ThemeId[] = ['РОССИЯ', 'СССР', 'БУХАЮ', 'TRUMP'];

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

    // model-4096/1024 themes produce padding tokens that must roundtrip to empty
    for (const themeId of ['БОЖЕ', 'КИТАЙ', '🙂'] as const) {
      const encoded = stegoEncode(new Uint8Array([]), themeId);
      expect(encoded.length).toBeGreaterThan(0);
      const decoded = stegoDecode(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded!.bytes).toEqual(new Uint8Array([]));
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

describe('stego output is non-deterministic', () => {
  // Model-16 uses random tab1/tab2 switching
  const model16Themes: ThemeId[] = ['РОССИЯ', 'СССР', 'БУХАЮ', 'TRUMP'];
  // Model-4096 flat uses random cosmetic spaces
  const model4096FlatThemes: ThemeId[] = ['КИТАЙ'];

  for (const themeId of [...model16Themes, ...model4096FlatThemes]) {
    it(`encoding same payload twice through ${themeId} produces varied output`, () => {
      // КИТАЙ (model-4096 flat) adds spaces with only 5% probability per token,
      // so use longer payload and more trials to make identical runs negligible.
      const is4096Flat = model4096FlatThemes.includes(themeId);
      const input = randomBytes(is4096Flat ? 200 : 20);
      const trials = is4096Flat ? 30 : 10;
      const outputs = new Set<string>();
      for (let i = 0; i < trials; i++) {
        outputs.add(stegoEncode(input, themeId));
      }
      expect(outputs.size).toBeGreaterThanOrEqual(2);
    });
  }

  // Model-4096 structured (БОЖЕ, PATER) are deterministic: connectors are derived
  // from data bits, not randomized. This is correct — the "rand" field in their
  // theme config is 0, so no tab switching occurs. Non-determinism applies only
  // to model-16 (tab switching) and model-4096 flat (random cosmetic spaces).
});

describe('trailing whitespace tolerance for model-16', () => {
  const model16Themes: ThemeId[] = ['РОССИЯ', 'СССР', 'БУХАЮ', 'TRUMP'];

  for (const themeId of model16Themes) {
    it(`${themeId} decodes correctly after trimEnd()`, () => {
      const input = randomBytes(20);
      const encoded = stegoEncode(input, themeId);
      const trimmed = encoded.trimEnd();
      const decoded = stegoDecode(trimmed);
      expect(decoded).not.toBeNull();
      expect(decoded!.bytes).toEqual(input);
    });
  }
});

describe('auto-detection null for diverse non-encoded text', () => {
  const samples = [
    ['Chinese sentence', '今天天气很好，我们去公园散步吧。这是一个普通的句子。'],
    ['Latin prayer-like text', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.'],
    ['URL', 'https://example.com/path?query=value&foo=bar#section'],
    ['JSON', '{"name": "Alice", "age": 30, "contacts": ["Bob", "Carol"]}'],
    ['Python snippet', 'def hello():\n    print("Hello, World!")\n    return 42'],
    ['emoji-heavy casual text', 'Hey 😊 how are you 🤔 lets go 🎉🎊💃🕺 party tonight!!! 🔥🔥'],
    ['numbers only', '31415926535897932384626433832795028841971'],
  ] as const;

  for (const [label, text] of samples) {
    it(`returns null for ${label}`, () => {
      expect(stegoDecode(text)).toBeNull();
    });
  }
});

describe('stego decoder robustness (mutation targets)', () => {
  it('hex decoder rejects odd-length hex', () => {
    expect(stegoDecode('ABC')).toBeNull(); // 3 chars = odd
  });

  it('hex decoder strips whitespace from hex input', () => {
    const bytes = new Uint8Array([0xDE, 0xAD]);
    const encoded = stegoEncode(bytes, 'hex');
    // Inject spaces between every char — decoder should strip them
    const withSpaces = encoded.split('').join(' ');
    const decoded = stegoDecode(withSpaces);
    expect(decoded).not.toBeNull();
    expect(decoded!.bytes).toEqual(bytes);
  });

  it('hex decoder is case-insensitive on decode', () => {
    // stegoEncode produces uppercase, but lowercase should also decode
    const decoded = stegoDecode('deadbeef');
    expect(decoded).not.toBeNull();
    expect(decoded!.bytes).toEqual(new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]));
  });

  it('auto-detect returns null for empty string', () => {
    expect(stegoDecode('')).toBeNull();
  });

  it('auto-detect returns null for whitespace-only', () => {
    expect(stegoDecode('   \n\t  ')).toBeNull();
  });

  it('model-4096 flat decoder rejects out-of-range codepoints', () => {
    // КИТАЙ uses CJK base. A string of ASCII should not decode as КИТАЙ
    const decoded = stegoDecode('Hello world this is plain ASCII text');
    // Should not match КИТАЙ theme
    if (decoded !== null) {
      expect(decoded.theme).not.toBe('КИТАЙ');
    }
  });
});
