import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../../src/crypto';
import { stegoEncode, stegoDecode } from '../../src/stego';
import { serializeWire, deserializeWire, makeHeader, headerClass, CLASS_CONTACT, COMP_LITERAL } from '../../src/wire';
import { type ThemeId } from '../../src/dictionaries';

describe('contact token exchange via stego', () => {
  const themes: ThemeId[] = ['БОЖЕ', 'РОССИЯ', 'СССР', 'БУХАЮ', 'КИТАЙ', 'PATER', '🙂', 'hex'];

  for (const themeId of themes) {
    it(`contact token roundtrips through ${themeId}`, async () => {
      const { publicKey } = await generateKeyPair();

      // Create token
      const header = makeHeader(CLASS_CONTACT, COMP_LITERAL);
      const wire = serializeWire({ header, publicKey });
      const stegoText = stegoEncode(wire, themeId);

      // Parse back
      const decoded = stegoDecode(stegoText);
      expect(decoded).not.toBeNull();

      const frame = deserializeWire(decoded!.bytes);
      expect(frame).not.toBeNull();
      expect(headerClass(frame!.header)).toBe(CLASS_CONTACT);
      expect((frame as any).publicKey).toEqual(publicKey);
    });
  }
});

describe('contact token structure', () => {
  it('wire format is 33 bytes (header + 32-byte key)', async () => {
    const { publicKey } = await generateKeyPair();
    const header = makeHeader(CLASS_CONTACT, COMP_LITERAL);
    const wire = serializeWire({ header, publicKey });
    expect(wire.length).toBe(33);
    expect(headerClass(wire[0])).toBe(CLASS_CONTACT);
    expect(wire.slice(1)).toEqual(publicKey);
  });
});
