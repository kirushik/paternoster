import { describe, it, expect } from 'vitest';
import {
  serializeWire, deserializeWire, makeHeader, headerClass, headerComp,
  CLASS_CONTACT, CLASS_INTRO, CLASS_MSG,
  COMP_LITERAL, COMP_SQUASH_SMAZ,
  type WireMessage, type WireIntroduction, type WireContactToken,
} from '../../src/wire';

describe('wire format roundtrip', () => {
  it('MSG roundtrips', () => {
    const header = makeHeader(CLASS_MSG, COMP_SQUASH_SMAZ);
    const payload = crypto.getRandomValues(new Uint8Array(50));
    const wire = serializeWire({ header, payload });
    const parsed = deserializeWire(wire);
    expect(parsed).not.toBeNull();
    expect(headerClass(parsed!.header)).toBe(CLASS_MSG);
    expect(headerComp(parsed!.header)).toBe(COMP_SQUASH_SMAZ);
    expect((parsed as WireMessage).payload).toEqual(payload);
  });

  it('INTRO roundtrips', () => {
    const header = makeHeader(CLASS_INTRO, COMP_SQUASH_SMAZ);
    const ephemeralKey = crypto.getRandomValues(new Uint8Array(32));
    const payload = crypto.getRandomValues(new Uint8Array(50));
    const wire = serializeWire({ header, ephemeralPublicKey: ephemeralKey, payload });
    const parsed = deserializeWire(wire);
    expect(parsed).not.toBeNull();
    expect(headerClass(parsed!.header)).toBe(CLASS_INTRO);
    expect((parsed as WireIntroduction).ephemeralPublicKey).toEqual(ephemeralKey);
    expect((parsed as WireIntroduction).payload).toEqual(payload);
  });

  it('CONTACT roundtrips', () => {
    const header = makeHeader(CLASS_CONTACT, COMP_LITERAL);
    const pubKey = crypto.getRandomValues(new Uint8Array(32));
    const wire = serializeWire({ header, publicKey: pubKey });
    const parsed = deserializeWire(wire);
    expect(parsed).not.toBeNull();
    expect(headerClass(parsed!.header)).toBe(CLASS_CONTACT);
    expect((parsed as WireContactToken).publicKey).toEqual(pubKey);
  });
});

describe('wire format structure', () => {
  it('CONTACT is exactly 33 bytes', () => {
    const header = makeHeader(CLASS_CONTACT, COMP_LITERAL);
    const wire = serializeWire({ header, publicKey: new Uint8Array(32) });
    expect(wire.length).toBe(33);
    expect(headerClass(wire[0])).toBe(CLASS_CONTACT);
  });

  it('MSG header encodes class and compression', () => {
    const header = makeHeader(CLASS_MSG, COMP_SQUASH_SMAZ);
    const wire = serializeWire({ header, payload: new Uint8Array(20) });
    expect(headerClass(wire[0])).toBe(CLASS_MSG);
    expect(headerComp(wire[0])).toBe(COMP_SQUASH_SMAZ);
    expect(wire.length).toBe(21); // 1 header + 20 payload
  });

  it('INTRO includes 32-byte ephemeral key after header', () => {
    const header = makeHeader(CLASS_INTRO, COMP_LITERAL);
    const ephKey = new Uint8Array(32).fill(0xAB);
    const wire = serializeWire({ header, ephemeralPublicKey: ephKey, payload: new Uint8Array(20) });
    expect(headerClass(wire[0])).toBe(CLASS_INTRO);
    expect(wire.length).toBe(53); // 1 + 32 + 20
    expect(wire.slice(1, 33)).toEqual(ephKey);
  });

  it('header byte has version bits set', () => {
    const header = makeHeader(CLASS_MSG, COMP_LITERAL);
    // Version bits (top 2) should be 01
    expect((header >> 6) & 0x03).toBe(1);
  });
});

describe('wire deserialization rejects invalid input', () => {
  it('returns null for empty data', () => {
    expect(deserializeWire(new Uint8Array([]))).toBeNull();
  });

  it('returns null for single byte', () => {
    expect(deserializeWire(new Uint8Array([makeHeader(CLASS_MSG, COMP_LITERAL)]))).toBeNull();
  });

  it('returns null for unknown version', () => {
    // Version 00 (old V1 type bytes like 0x10, 0x12, 0x20)
    expect(deserializeWire(new Uint8Array([0x10, 0x00, 0x00]))).toBeNull();
    expect(deserializeWire(new Uint8Array([0x12, 0x00, 0x00]))).toBeNull();
    expect(deserializeWire(new Uint8Array([0x20, 0x00, 0x00]))).toBeNull();
  });

  it('returns null for too-short CONTACT', () => {
    const header = makeHeader(CLASS_CONTACT, COMP_LITERAL);
    expect(deserializeWire(new Uint8Array([header, 0x01, 0x02]))).toBeNull();
  });

  it('returns null for too-short INTRO', () => {
    const header = makeHeader(CLASS_INTRO, COMP_LITERAL);
    expect(deserializeWire(new Uint8Array(11).fill(header))).toBeNull();
  });

  it('returns null for CONTACT with trailing bytes', () => {
    const header = makeHeader(CLASS_CONTACT, COMP_LITERAL);
    const data = new Uint8Array(34);
    data[0] = header;
    expect(deserializeWire(data)).toBeNull();
  });

  it('returns null for reserved class', () => {
    // Class 11 (reserved)
    const header = 0b01_11_00_00;
    const data = new Uint8Array(50);
    data[0] = header;
    expect(deserializeWire(data)).toBeNull();
  });
});

describe('header byte encoding', () => {
  it('compression modes are distinct', () => {
    expect(COMP_LITERAL).not.toBe(COMP_SQUASH_SMAZ);
    expect(makeHeader(CLASS_MSG, COMP_LITERAL)).not.toBe(makeHeader(CLASS_MSG, COMP_SQUASH_SMAZ));
  });

  it('classes are distinct', () => {
    expect(CLASS_CONTACT).not.toBe(CLASS_INTRO);
    expect(CLASS_INTRO).not.toBe(CLASS_MSG);
    expect(makeHeader(CLASS_CONTACT, COMP_LITERAL)).not.toBe(makeHeader(CLASS_MSG, COMP_LITERAL));
  });

  it('round-trips class and compression through header', () => {
    for (const cls of [CLASS_CONTACT, CLASS_INTRO, CLASS_MSG]) {
      for (const comp of [COMP_LITERAL, COMP_SQUASH_SMAZ]) {
        const h = makeHeader(cls, comp);
        expect(headerClass(h)).toBe(cls);
        expect(headerComp(h)).toBe(comp);
      }
    }
  });
});
