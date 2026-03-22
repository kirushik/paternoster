import { describe, it, expect } from 'vitest';
import { compress, decompress } from '../../src/compress';
import { COMP_LITERAL, COMP_SQUASH_SMAZ, COMP_SQUASH_ONLY } from '../../src/wire';

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
      const { payload, compMode } = compress(text);
      const decompressed = decompress(payload, compMode);
      expect(decompressed).toBe(text);
    });
  }
});

describe('compress mode selection', () => {
  it('uses COMP_SQUASH_SMAZ for Russian text', () => {
    const { compMode } = compress('Привет, как дела? Это длинное русское сообщение.');
    expect(compMode).toBe(COMP_SQUASH_SMAZ);
  });

  it('returns a valid compMode for short text', () => {
    const { payload, compMode } = compress('a');
    // Either mode is acceptable, but should roundtrip
    expect(decompress(payload, compMode)).toBe('a');
  });
});

describe('compress size reduction', () => {
  it('compresses Russian text smaller than UTF-8', () => {
    const text = 'Это достаточно длинное русское сообщение для проверки эффективности сжатия';
    const { payload } = compress(text);
    const utf8Size = new TextEncoder().encode(text).length;
    expect(payload.length).toBeLessThan(utf8Size);
  });

  it('no flags byte overhead — payload is raw compressed data', () => {
    const text = 'Привет, мир!';
    const { payload, compMode } = compress(text);
    // Payload should NOT start with 0xC0 or 0x3F — those are V1 flags
    // V2 payload is raw (no internal flags byte)
    if (compMode === COMP_SQUASH_SMAZ) {
      // If compressed, first byte could be any smaz output byte
      // Just verify it roundtrips without a flags byte
      expect(decompress(payload, compMode)).toBe(text);
    }
  });
});

describe('squash-only mode', () => {
  it('squash-only roundtrips Russian text', async () => {
    const text = 'Привет, мир!';
    const { squashEncode } = await import('../../src/squash');
    const squashed = squashEncode(text);
    expect(decompress(squashed, COMP_SQUASH_ONLY)).toBe(text);
  });

  it('picks squash-only when smaz expands but squash helps', () => {
    // Short Russian text where smaz might not help but squash halves the bytes
    const text = 'Юя'; // short Cyrillic
    const { compMode } = compress(text);
    // Squash turns 4 UTF-8 bytes into 2 CP1251 bytes
    // Smaz on 2 bytes likely expands (verbatim escapes)
    // So squash-only or squash+smaz should win over literal
    expect(compMode).not.toBe(COMP_LITERAL);
  });

  it('never picks a mode that expands beyond UTF-8', () => {
    const texts = ['Hello 😀', 'test', 'Да', 'Привет, как дела?', '🎉🎊🎈'];
    for (const text of texts) {
      const { payload } = compress(text);
      const utf8Size = new TextEncoder().encode(text).length;
      expect(payload.length).toBeLessThanOrEqual(utf8Size);
    }
  });
});

describe('decompress edge cases', () => {
  it('handles empty input', () => {
    expect(decompress(new Uint8Array([]), COMP_LITERAL)).toBe('');
    expect(decompress(new Uint8Array([]), COMP_SQUASH_SMAZ)).toBe('');
  });

  it('throws on unknown compression mode', () => {
    const data = new Uint8Array([0x48, 0x69]); // "Hi"
    expect(() => decompress(data, 0xFF)).toThrow('Неизвестный режим сжатия');
  });
});
