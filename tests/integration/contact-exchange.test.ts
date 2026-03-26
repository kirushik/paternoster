import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../../src/crypto';
import { stegoEncode, stegoDecode } from '../../src/stego';
import { serializeContact, tryParseContact, contactCheckBytes } from '../../src/wire';
import { type ThemeId } from '../../src/dictionaries';

describe('contact token exchange via stego', () => {
  const themes: ThemeId[] = ['БОЖЕ', 'РОССИЯ', 'СССР', 'БУХАЮ', 'КИТАЙ', 'PATER', '🙂', 'hex'];

  for (const themeId of themes) {
    it(`contact token roundtrips through ${themeId}`, async () => {
      const { publicKey } = await generateKeyPair();
      const wire = await serializeContact(publicKey);
      const stegoText = stegoEncode(wire, themeId);
      const decoded = stegoDecode(stegoText);
      expect(decoded).not.toBeNull();
      const parsed = await tryParseContact(decoded!.bytes);
      expect(parsed).not.toBeNull();
      expect(parsed).toEqual(publicKey);
    });
  }
});

describe('contact token structure', () => {
  it('wire format is 34 bytes (32-byte key + 2 check bytes)', async () => {
    const { publicKey } = await generateKeyPair();
    const wire = await serializeContact(publicKey);
    expect(wire.length).toBe(34);
    expect(wire.slice(0, 32)).toEqual(publicKey);
    const [a, b] = await contactCheckBytes(publicKey);
    expect(wire[32]).toBe(a);
    expect(wire[33]).toBe(b);
  });
});
