import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../../src/crypto';
import { stegoEncode, stegoDecode } from '../../src/stego';
import { serializeWire, deserializeWire, CONTACT_TOKEN } from '../../src/wire';
import { type ThemeId } from '../../src/dictionaries';

describe('contact token exchange via stego', () => {
  const themes: ThemeId[] = ['БОЖЕ', 'РОССИЯ', 'СССР', 'БУХАЮ', 'КИТАЙ', 'PATER', '🙂', 'hex'];

  for (const themeId of themes) {
    it(`contact token roundtrips through ${themeId}`, async () => {
      const { publicKey } = await generateKeyPair();

      // Create token
      const wire = serializeWire({ type: CONTACT_TOKEN, publicKey });
      const stegoText = stegoEncode(wire, themeId);

      // Parse back
      const decoded = stegoDecode(stegoText);
      expect(decoded).not.toBeNull();

      const frame = deserializeWire(decoded!.bytes);
      expect(frame).not.toBeNull();
      expect(frame!.type).toBe(CONTACT_TOKEN);
      expect((frame as any).publicKey).toEqual(publicKey);
    });
  }
});

describe('contact token structure', () => {
  it('wire format is 33 bytes (0x20 + 32-byte key)', async () => {
    const { publicKey } = await generateKeyPair();
    const wire = serializeWire({ type: CONTACT_TOKEN, publicKey });
    expect(wire.length).toBe(33);
    expect(wire[0]).toBe(0x20);
    expect(wire.slice(1)).toEqual(publicKey);
  });
});
