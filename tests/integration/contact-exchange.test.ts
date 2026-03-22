import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../../src/crypto';
import { stegoEncode, stegoDecode } from '../../src/stego';
import { serializeContact, tryParseContact, contactCheckByte } from '../../src/wire';
import { type ThemeId } from '../../src/dictionaries';

describe('contact token exchange via stego', () => {
  const themes: ThemeId[] = ['БОЖЕ', 'РОССИЯ', 'СССР', 'БУХАЮ', 'КИТАЙ', 'PATER', '🙂', 'hex'];

  for (const themeId of themes) {
    it(`contact token roundtrips through ${themeId}`, async () => {
      const { publicKey } = await generateKeyPair();

      const wire = serializeContact(publicKey);
      const stegoText = stegoEncode(wire, themeId);

      const decoded = stegoDecode(stegoText);
      expect(decoded).not.toBeNull();

      const parsed = tryParseContact(decoded!.bytes);
      expect(parsed).not.toBeNull();
      expect(parsed).toEqual(publicKey);
    });
  }
});

describe('contact token structure', () => {
  it('wire format is 33 bytes (32-byte key + check byte at end)', async () => {
    const { publicKey } = await generateKeyPair();
    const wire = serializeContact(publicKey);
    expect(wire.length).toBe(33);
    expect(wire.slice(0, 32)).toEqual(publicKey);
    expect(wire[32]).toBe(contactCheckByte(publicKey));
  });

  it('starts with public key bytes (random), not a fixed header', async () => {
    const key1 = (await generateKeyPair()).publicKey;
    const key2 = (await generateKeyPair()).publicKey;
    const wire1 = serializeContact(key1);
    const wire2 = serializeContact(key2);
    // First bytes should differ (they're random public keys)
    // With overwhelming probability at least one byte differs
    expect(wire1[0]).not.toBe(wire2[0]); // may rarely fail, but very unlikely
  });
});
