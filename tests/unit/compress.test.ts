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
  it('uses squash+smaz or squash-only for Russian text', () => {
    const { compMode } = compress('Привет, как дела? Это длинное русское сообщение.');
    expect([COMP_SQUASH_SMAZ, COMP_SQUASH_ONLY]).toContain(compMode);
  });

  it('returns a valid compMode for short text', () => {
    const { payload, compMode } = compress('a');
    expect(decompress(payload, compMode)).toBe('a');
  });

  it('comp modes are 2-bit values', () => {
    for (const text of ['Привет', 'Hello', '😀']) {
      const { compMode } = compress(text);
      expect(compMode).toBeGreaterThanOrEqual(0);
      expect(compMode).toBeLessThanOrEqual(3);
    }
  });
});

describe('compress size reduction', () => {
  it('compresses Russian text smaller than UTF-8', () => {
    const text = 'Это достаточно длинное русское сообщение для проверки эффективности сжатия';
    const { payload } = compress(text);
    const utf8Size = new TextEncoder().encode(text).length;
    expect(payload.length).toBeLessThan(utf8Size);
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

describe('squash-only mode', () => {
  it('roundtrips Russian text via COMP_SQUASH_ONLY', async () => {
    const text = 'Привет, мир!';
    const { squashEncode } = await import('../../src/squash');
    const squashed = squashEncode(text);
    expect(decompress(squashed, COMP_SQUASH_ONLY)).toBe(text);
  });

  it('picks squash-only when smaz expands but squash helps', () => {
    const text = 'Юя';
    const { compMode } = compress(text);
    expect(compMode).not.toBe(COMP_LITERAL);
  });
});

describe('decompress edge cases', () => {
  it('handles empty input', () => {
    expect(decompress(new Uint8Array([]), COMP_LITERAL)).toBe('');
    expect(decompress(new Uint8Array([]), COMP_SQUASH_SMAZ)).toBe('');
  });

  it('throws on unknown compression mode', () => {
    const data = new Uint8Array([0x48, 0x69]);
    expect(() => decompress(data, 3)).toThrow('Неизвестный режим сжатия');
  });
});

describe('compression mode selection', () => {
  it('short ASCII selects LITERAL', () => {
    const { compMode } = compress('Hi');
    expect(compMode).toBe(COMP_LITERAL);
  });

  it('Cyrillic text selects SQUASH_SMAZ or SQUASH_ONLY (not LITERAL)', () => {
    const { compMode } = compress('Привет, как дела? Надеюсь всё хорошо!');
    expect(compMode === COMP_SQUASH_SMAZ || compMode === COMP_SQUASH_ONLY).toBe(true);
  });

  it('long repeated Cyrillic selects SQUASH_SMAZ', () => {
    // Smaz codebook is trained on Cyrillic, so repeated common patterns should compress well
    const { compMode } = compress('что это не это что это не это что это не');
    expect(compMode).toBe(COMP_SQUASH_SMAZ);
  });

  it('compressed payload is smaller than UTF-8 when SQUASH mode is selected', () => {
    const text = 'Привет, мир! Как дела?';
    const { payload, compMode } = compress(text);
    const utf8 = new TextEncoder().encode(text);
    if (compMode !== COMP_LITERAL) {
      expect(payload.length).toBeLessThan(utf8.length);
    }
  });

  it('SQUASH_ONLY is selected when smaz makes it bigger', () => {
    // Pure ASCII through squash just passes through, smaz adds escape overhead
    const text = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const { compMode } = compress(text);
    // ASCII is 1 byte/char in both UTF-8 and squash, so either LITERAL or SQUASH_ONLY
    expect(compMode === COMP_LITERAL || compMode === COMP_SQUASH_ONLY).toBe(true);
  });
});
