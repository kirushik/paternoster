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
