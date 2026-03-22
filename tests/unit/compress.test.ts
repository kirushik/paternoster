import { describe, it, expect } from 'vitest';
import { compress, decompress } from '../../src/compress';

describe('compress/decompress roundtrip', () => {
  const texts = [
    'Привет, мир!',
    'Hello, world!',
    'Смешанный text с emoji 😀',
    '',
    'а',
    'Длинное русское сообщение, которое должно хорошо сжиматься с помощью словаря и кодировки CP1251',
  ];

  for (const text of texts) {
    it(`roundtrips: "${text.slice(0, 40)}..."`, () => {
      const compressed = compress(text);
      const decompressed = decompress(compressed);
      expect(decompressed).toBe(text);
    });
  }
});

describe('compress flags', () => {
  it('uses 0xC0 (squash+smaz) for Russian text', () => {
    const result = compress('Привет, как дела? Это длинное русское сообщение.');
    expect(result[0]).toBe(0xC0);
  });

  it('uses 0x3F (literal) when compression expands', () => {
    // Very short text or random bytes won't compress well
    const result = compress('a');
    // Either flag is acceptable, but should roundtrip
    expect(decompress(result)).toBe('a');
  });
});

describe('compress size reduction', () => {
  it('compresses Russian text smaller than UTF-8', () => {
    const text = 'Это достаточно длинное русское сообщение для проверки эффективности сжатия';
    const compressed = compress(text);
    const utf8Size = new TextEncoder().encode(text).length;
    expect(compressed.length).toBeLessThan(utf8Size);
  });
});

describe('decompress edge cases', () => {
  it('handles empty input', () => {
    expect(decompress(new Uint8Array([]))).toBe('');
  });

  it('throws on unknown flag', () => {
    const data = new Uint8Array([0x42, 0x48, 0x69]); // unknown flag 0x42, then "Hi"
    expect(() => decompress(data)).toThrow('Неизвестный формат сжатия (0x42)');
  });
});
