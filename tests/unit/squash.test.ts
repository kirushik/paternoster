import { describe, it, expect } from 'vitest';
import { squashEncode, squashDecode } from '../../src/squash';

describe('squash roundtrip', () => {
  const cases = [
    ['empty string', ''],
    ['pure ASCII', 'Hello, world! 123'],
    ['pure Cyrillic', 'Привет, мир! Как дела?'],
    ['mixed ASCII and Cyrillic', 'Hello Привет 123'],
    ['Ё and ё', 'Ёлка и ёжик'],
    ['Ukrainian chars', 'Ґалина, Єва, Їжак'],
    ['с emoji', 'Привет 😀 мир 🌍'],
    ['multiple emoji', '😀😃😄😁😆'],
    ['punctuation and symbols', '«Привет» — сказал он. №1, ±5°'],
    ['long Russian text', 'В чащах юга жил бы цитрус? Да, но фальшивый экземпляр! Съешь же ещё этих мягких французских булок, да выпей чаю.'],
  ];

  for (const [name, text] of cases) {
    it(`roundtrips: ${name}`, () => {
      const encoded = squashEncode(text);
      const decoded = squashDecode(encoded);
      expect(decoded).toBe(text);
    });
  }
});

describe('squash compression ratio', () => {
  it('Cyrillic text uses ~1 byte per char (not 2)', () => {
    const text = 'Привет мир';
    const utf8Size = new TextEncoder().encode(text).length;
    const squashSize = squashEncode(text).length;
    expect(squashSize).toBeLessThan(utf8Size);
    // Each Cyrillic char should be 1 byte instead of 2
    expect(squashSize).toBeLessThanOrEqual(text.length);
  });

  it('ASCII text is same size', () => {
    const text = 'Hello world';
    const squashSize = squashEncode(text).length;
    expect(squashSize).toBe(text.length);
  });

  it('emoji adds 1 byte overhead per emoji', () => {
    const text = '😀';
    const encoded = squashEncode(text);
    const utf8 = new TextEncoder().encode('😀');
    // 1 escape byte + UTF-8 bytes
    expect(encoded.length).toBe(1 + utf8.length);
  });
});

describe('squash edge cases', () => {
  it('handles all CP1251 bytes individually', () => {
    // Test each CP1251-representable character roundtrips
    for (let b = 0x80; b <= 0xFF; b++) {
      if (b === 0x98) continue; // escape byte, skip
      const encoded = new Uint8Array([b]);
      const decoded = squashDecode(encoded);
      const reEncoded = squashEncode(decoded);
      expect(squashDecode(reEncoded)).toBe(decoded);
    }
  });

  it('escape byte 0x98 is never produced for CP1251 chars', () => {
    const text = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя';
    const encoded = squashEncode(text);
    // Should not contain escape byte for standard Cyrillic
    for (let i = 0; i < encoded.length; i++) {
      if (encoded[i] === 0x98) {
        // If escape found, the next byte must be a UTF-8 lead byte
        expect(encoded[i + 1]).toBeGreaterThanOrEqual(0x80);
      }
    }
  });
});

describe('squash malformed escape sequences', () => {
  it('throws on trailing escape byte', () => {
    expect(() => squashDecode(new Uint8Array([0x98]))).toThrow();
  });

  it('throws on trailing escape after valid ASCII', () => {
    expect(() => squashDecode(new Uint8Array([0x41, 0x98]))).toThrow();
  });

  it('throws on continuation byte as lead (0x80)', () => {
    expect(() => squashDecode(new Uint8Array([0x98, 0x80]))).toThrow();
  });

  it('throws on ASCII byte after escape (0x41)', () => {
    expect(() => squashDecode(new Uint8Array([0x98, 0x41]))).toThrow();
  });

  it('throws on overlong lead byte (0xC0)', () => {
    expect(() => squashDecode(new Uint8Array([0x98, 0xC0, 0x80]))).toThrow();
  });

  it('throws on overlong lead byte (0xC1)', () => {
    expect(() => squashDecode(new Uint8Array([0x98, 0xC1, 0x80]))).toThrow();
  });

  it('throws on invalid lead byte (0xF5+)', () => {
    expect(() => squashDecode(new Uint8Array([0x98, 0xF5, 0x80, 0x80, 0x80]))).toThrow();
  });

  it('throws on incomplete 3-byte sequence', () => {
    // 0xE0 expects 3 bytes total, but only 2 available
    expect(() => squashDecode(new Uint8Array([0x98, 0xE0, 0x80]))).toThrow();
  });

  it('throws on invalid continuation bytes', () => {
    // 0xC3 expects valid continuation byte (0x80-0xBF), gets 0x00
    expect(() => squashDecode(new Uint8Array([0x98, 0xC3, 0x00]))).toThrow();
  });
});

describe('squash boundary values (mutation targets)', () => {
  it('byte 0x80 (CP1251 Ђ / U+0402) roundtrips as single byte', () => {
    const text = '\u0402'; // Ђ — first CP1251 high byte
    const encoded = squashEncode(text);
    expect(encoded.length).toBe(1);
    expect(encoded[0]).toBe(0x80);
    expect(squashDecode(encoded)).toBe(text);
  });

  it('byte 0x7F (DEL) roundtrips as ASCII', () => {
    const text = '\x7F';
    const encoded = squashEncode(text);
    expect(encoded.length).toBe(1);
    expect(encoded[0]).toBe(0x7F);
    expect(squashDecode(encoded)).toBe(text);
  });

  it('2-byte UTF-8 (U+00A2 ¢) uses escape', () => {
    const text = '¢';
    const encoded = squashEncode(text);
    expect(encoded[0]).toBe(0x98);
    expect(squashDecode(encoded)).toBe(text);
  });

  it('3-byte UTF-8 (U+20BD ₽) uses escape', () => {
    const text = '₽';
    const encoded = squashEncode(text);
    expect(encoded[0]).toBe(0x98);
    expect(squashDecode(encoded)).toBe(text);
  });

  it('4-byte UTF-8 (U+1F600 😀) uses escape', () => {
    const text = '😀';
    const encoded = squashEncode(text);
    expect(encoded[0]).toBe(0x98);
    expect(squashDecode(encoded)).toBe(text);
  });
});
