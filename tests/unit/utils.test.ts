import { describe, it, expect } from 'vitest';
import { u8hex, hexU8, u8toBase64url, base64urlToU8, concatU8, u8eq, contactCode, charCount } from '../../src/utils';

describe('u8hex', () => {
  it('encodes empty array', () => {
    expect(u8hex(new Uint8Array([]))).toBe('');
  });
  it('encodes single byte', () => {
    expect(u8hex(new Uint8Array([0x0A]))).toBe('0A');
    expect(u8hex(new Uint8Array([0xFF]))).toBe('FF');
    expect(u8hex(new Uint8Array([0x00]))).toBe('00');
  });
  it('encodes all byte values', () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    const hex = u8hex(all);
    expect(hex.length).toBe(512);
    expect(hex.startsWith('000102')).toBe(true);
    expect(hex.endsWith('FDFEFF')).toBe(true);
  });
  it('produces uppercase', () => {
    expect(u8hex(new Uint8Array([0xab, 0xcd]))).toBe('ABCD');
  });
});

describe('hexU8', () => {
  it('decodes valid hex', () => {
    expect(hexU8('0A')).toEqual(new Uint8Array([0x0A]));
    expect(hexU8('ABCD')).toEqual(new Uint8Array([0xAB, 0xCD]));
  });
  it('handles lowercase', () => {
    expect(hexU8('abcd')).toEqual(new Uint8Array([0xAB, 0xCD]));
  });
  it('returns empty for empty string', () => {
    expect(hexU8('')).toEqual(new Uint8Array([]));
  });
  it('throws on odd-length hex', () => {
    expect(() => hexU8('ABC')).toThrow('Invalid hex');
  });
  it('throws on invalid chars', () => {
    expect(() => hexU8('GGXX')).toThrow('Invalid hex');
  });
  it('strips whitespace', () => {
    expect(hexU8('AB CD')).toEqual(new Uint8Array([0xAB, 0xCD]));
  });
});

describe('u8hex / hexU8 roundtrip', () => {
  it('roundtrips all byte values', () => {
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i;
    expect(hexU8(u8hex(original))).toEqual(original);
  });
});

describe('u8toBase64url / base64urlToU8', () => {
  it('roundtrips empty', () => {
    expect(base64urlToU8(u8toBase64url(new Uint8Array([])))).toEqual(new Uint8Array([]));
  });
  it('roundtrips 32 bytes (key-sized)', () => {
    const data = new Uint8Array(32);
    for (let i = 0; i < 32; i++) data[i] = i * 8;
    expect(base64urlToU8(u8toBase64url(data))).toEqual(data);
  });
  it('roundtrips data with 0x00 bytes', () => {
    const data = new Uint8Array([0, 0, 0, 255, 255, 255]);
    expect(base64urlToU8(u8toBase64url(data))).toEqual(data);
  });
  it('produces URL-safe characters (no +, /, =)', () => {
    const data = new Uint8Array([255, 254, 253, 252, 251]);
    const encoded = u8toBase64url(data);
    expect(encoded).not.toMatch(/[+/=]/);
  });
  it('produces 43 chars for 32 bytes', () => {
    expect(u8toBase64url(new Uint8Array(32)).length).toBe(43);
  });
  it('produces 44 chars for 33 bytes', () => {
    expect(u8toBase64url(new Uint8Array(33)).length).toBe(44);
  });
});

describe('concatU8', () => {
  it('concatenates two arrays', () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3, 4]);
    expect(concatU8(a, b)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });
  it('handles empty arrays', () => {
    expect(concatU8(new Uint8Array([]), new Uint8Array([1]))).toEqual(new Uint8Array([1]));
    expect(concatU8()).toEqual(new Uint8Array([]));
  });
  it('concatenates many arrays', () => {
    const result = concatU8(
      new Uint8Array([1]),
      new Uint8Array([2]),
      new Uint8Array([3]),
    );
    expect(result).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('u8eq', () => {
  it('equal arrays', () => {
    expect(u8eq(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
  });
  it('different lengths', () => {
    expect(u8eq(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
  it('different content', () => {
    expect(u8eq(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
  });
  it('both empty', () => {
    expect(u8eq(new Uint8Array([]), new Uint8Array([]))).toBe(true);
  });
});

describe('contactCode', () => {
  it('returns 4 groups of 4 hex chars', async () => {
    const key = new Uint8Array(32).fill(0xAB);
    const code = await contactCode(key);
    expect(code).toMatch(/^[0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}$/);
  });

  it('is deterministic', async () => {
    const key = new Uint8Array(32).fill(0x42);
    const code1 = await contactCode(key);
    const code2 = await contactCode(key);
    expect(code1).toBe(code2);
  });

  it('different keys produce different codes', async () => {
    const key1 = new Uint8Array(32).fill(0x01);
    const key2 = new Uint8Array(32).fill(0x02);
    const code1 = await contactCode(key1);
    const code2 = await contactCode(key2);
    expect(code1).not.toBe(code2);
  });
});

describe('hexU8 edge cases (mutation targets)', () => {
  it('rejects string with non-hex prefix', () => {
    expect(() => hexU8('ZZ0102')).toThrow('Invalid hex string');
  });

  it('rejects string with non-hex suffix', () => {
    expect(() => hexU8('0102ZZ')).toThrow('Invalid hex string');
  });

  it('rejects string with non-hex in middle', () => {
    expect(() => hexU8('01GG02')).toThrow('Invalid hex string');
  });
});

describe('u8eq edge cases (mutation targets)', () => {
  it('detects difference at last byte', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 5]);
    expect(u8eq(a, b)).toBe(false);
  });

  it('detects difference at first byte', () => {
    const a = new Uint8Array([0, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(u8eq(a, b)).toBe(false);
  });

  it('single-byte arrays', () => {
    expect(u8eq(new Uint8Array([0]), new Uint8Array([0]))).toBe(true);
    expect(u8eq(new Uint8Array([0]), new Uint8Array([1]))).toBe(false);
  });
});

describe('charCount', () => {
  it('counts BMP Russian text', () => {
    expect(charCount('Привет')).toBe(6);
  });
  it('counts supplementary-plane emoji as single codepoints', () => {
    // Each emoji is 1 codepoint but 2 UTF-16 code units
    expect(charCount('😀🎉')).toBe(2);
    expect('😀🎉'.length).toBe(4); // confirms .length overcounts
  });
  it('counts CJK characters', () => {
    expect(charCount('你好世界')).toBe(4);
  });
  it('returns 0 for empty string', () => {
    expect(charCount('')).toBe(0);
  });
  it('counts mixed Russian + emoji', () => {
    expect(charCount('Привет 😀')).toBe(8);
  });
  it('counts ASCII', () => {
    expect(charCount('hello')).toBe(5);
  });
});

describe('base64url edge cases (mutation targets)', () => {
  it('roundtrips data requiring 1 padding char', () => {
    // 2 bytes = 3 base64 chars, needs 1 = padding
    const data = new Uint8Array([0xFF, 0xFE]);
    expect(base64urlToU8(u8toBase64url(data))).toEqual(data);
  });

  it('roundtrips data requiring 2 padding chars', () => {
    // 1 byte = 2 base64 chars, needs 2 == padding
    const data = new Uint8Array([0x42]);
    expect(base64urlToU8(u8toBase64url(data))).toEqual(data);
  });

  it('last byte is preserved exactly', () => {
    // Specifically test that the last byte isn't corrupted by off-by-one
    const data = new Uint8Array([0x00, 0xFF]);
    const roundtripped = base64urlToU8(u8toBase64url(data));
    expect(roundtripped[0]).toBe(0x00);
    expect(roundtripped[1]).toBe(0xFF);
  });
});
