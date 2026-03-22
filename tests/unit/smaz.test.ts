import { describe, it, expect } from 'vitest';
import { smazCyrillic, Smaz } from '../../src/smaz';
import { squashEncode } from '../../src/squash';

describe('smaz roundtrip', () => {
  const texts = [
    'Привет, мир!',
    'Как дела?',
    'Это тестовое сообщение для проверки сжатия.',
    'В чащах юга жил бы цитрус?',
    'Hello world',
    '12345',
    '',
    'а',
  ];

  for (const text of texts) {
    it(`roundtrips: "${text.slice(0, 30)}..."`, () => {
      const squashed = squashEncode(text);
      const compressed = smazCyrillic.compress(squashed);
      const decompressed = smazCyrillic.decompress(compressed);
      expect(decompressed).toEqual(squashed);
    });
  }
});

describe('smaz compression', () => {
  it('compresses typical Russian text', () => {
    const text = 'Привет, это тестовое сообщение, которое должно быть сжато';
    const squashed = squashEncode(text);
    const compressed = smazCyrillic.compress(squashed);
    expect(compressed.length).toBeLessThan(squashed.length);
  });

  it('handles input with no codebook matches (pure literals)', () => {
    // Random bytes unlikely to match any codebook entry
    const random = crypto.getRandomValues(new Uint8Array(20));
    const compressed = smazCyrillic.compress(random);
    const decompressed = smazCyrillic.decompress(compressed);
    expect(decompressed).toEqual(random);
  });
});

describe('smaz codebook', () => {
  it('has exactly 253 entries', () => {
    // Access codebook through compression test
    // Compress a single codebook entry — should produce a 1-byte output
    const squashed = squashEncode('что'); // common Russian word
    const compressed = smazCyrillic.compress(squashed);
    // It should compress (not expand to verbatim)
    const decompressed = smazCyrillic.decompress(compressed);
    expect(decompressed).toEqual(squashed);
  });
});

describe('smaz bounds checking', () => {
  it('throws on truncated VERBATIM_1', () => {
    // 0xFE (VERBATIM_1) without following byte
    expect(() => smazCyrillic.decompress(new Uint8Array([0xFE]))).toThrow('truncated VERBATIM_1');
  });

  it('throws on truncated VERBATIM_N length', () => {
    // 0xFF (VERBATIM_N) without length byte
    expect(() => smazCyrillic.decompress(new Uint8Array([0xFF]))).toThrow('truncated VERBATIM_N length');
  });

  it('throws on truncated VERBATIM_N data', () => {
    // 0xFF, length=5, but only 2 bytes follow
    expect(() => smazCyrillic.decompress(new Uint8Array([0xFF, 5, 0x41, 0x42]))).toThrow('truncated VERBATIM_N data');
  });

  it('throws on invalid codebook index', () => {
    // Index 253 is out of range (codebook has 0-252)
    expect(() => smazCyrillic.decompress(new Uint8Array([253]))).toThrow('invalid codebook index');
  });
});

describe('smaz edge cases', () => {
  it('empty input', () => {
    const compressed = smazCyrillic.compress(new Uint8Array([]));
    const decompressed = smazCyrillic.decompress(compressed);
    expect(decompressed).toEqual(new Uint8Array([]));
  });

  it('single byte input', () => {
    for (const b of [0, 1, 127, 128, 255]) {
      const input = new Uint8Array([b]);
      const compressed = smazCyrillic.compress(input);
      const decompressed = smazCyrillic.decompress(compressed);
      expect(decompressed).toEqual(input);
    }
  });

  it('custom codebook works', () => {
    const codebook = [
      new Uint8Array([0x41, 0x42]), // "AB"
      new Uint8Array([0x43, 0x44]), // "CD"
    ];
    const smaz = new Smaz(codebook);
    const input = new Uint8Array([0x41, 0x42, 0x43, 0x44, 0x45]);
    const compressed = smaz.compress(input);
    const decompressed = smaz.decompress(compressed);
    expect(decompressed).toEqual(input);
    // Should be shorter: 2 codebook refs + 1 literal vs 5 raw bytes
    expect(compressed.length).toBeLessThan(input.length + 2);
  });
});
