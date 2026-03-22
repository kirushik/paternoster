import { describe, it, expect } from 'vitest';
import {
  serializeMsg, serializeIntro, serializeContact,
  couldBeMsg, couldBeIntro, splitIntro, tryParseContact,
  contactCheckByte,
  COMP_LITERAL, COMP_SQUASH_SMAZ, COMP_SQUASH_ONLY,
} from '../../src/wire';

describe('MSG serialization', () => {
  it('serializes as raw payload (no header)', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const wire = serializeMsg(payload);
    expect(wire).toEqual(payload);
  });

  it('starts with random bytes (the seed)', () => {
    const payload = crypto.getRandomValues(new Uint8Array(20));
    const wire = serializeMsg(payload);
    // First byte is from the seed — should be the same as input (no header prepended)
    expect(wire[0]).toBe(payload[0]);
  });
});

describe('INTRO serialization', () => {
  it('is eph_pub + payload with no header', () => {
    const ephKey = new Uint8Array(32).fill(0xAB);
    const payload = new Uint8Array([1, 2, 3]);
    const wire = serializeIntro(ephKey, payload);
    expect(wire.length).toBe(35); // 32 + 3
    expect(wire.slice(0, 32)).toEqual(ephKey);
    expect(wire.slice(32)).toEqual(payload);
  });

  it('starts with random bytes (the ephemeral key)', () => {
    const ephKey = crypto.getRandomValues(new Uint8Array(32));
    const wire = serializeIntro(ephKey, new Uint8Array(20));
    expect(wire[0]).toBe(ephKey[0]); // No header byte prepended
  });
});

describe('CONTACT serialization', () => {
  it('is pub + check byte at the end', () => {
    const pub = crypto.getRandomValues(new Uint8Array(32));
    const wire = serializeContact(pub);
    expect(wire.length).toBe(33);
    expect(wire.slice(0, 32)).toEqual(pub);
    expect(wire[32]).toBe(contactCheckByte(pub));
  });

  it('starts with random bytes (the public key)', () => {
    const pub = crypto.getRandomValues(new Uint8Array(32));
    const wire = serializeContact(pub);
    expect(wire[0]).toBe(pub[0]); // Public key byte, not a header
  });
});

describe('CONTACT check byte', () => {
  it('is deterministic for the same key', () => {
    const pub = crypto.getRandomValues(new Uint8Array(32));
    expect(contactCheckByte(pub)).toBe(contactCheckByte(pub));
  });

  it('differs for different keys', () => {
    const pub1 = crypto.getRandomValues(new Uint8Array(32));
    const pub2 = crypto.getRandomValues(new Uint8Array(32));
    // Random keys will almost certainly have different check bytes
    // (1/256 chance of collision — acceptable for a probabilistic test)
    expect(contactCheckByte(pub1)).not.toBe(contactCheckByte(pub2));
  });

  it('is not zero for all-zero key', () => {
    const pub = new Uint8Array(32); // all zeros
    expect(contactCheckByte(pub)).toBe(0x5A); // salt value
  });
});

describe('tryParseContact', () => {
  it('parses valid contact token', () => {
    const pub = crypto.getRandomValues(new Uint8Array(32));
    const wire = serializeContact(pub);
    const parsed = tryParseContact(wire);
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(pub);
  });

  it('rejects wrong length', () => {
    expect(tryParseContact(new Uint8Array(32))).toBeNull();
    expect(tryParseContact(new Uint8Array(34))).toBeNull();
  });

  it('rejects wrong check byte', () => {
    const pub = crypto.getRandomValues(new Uint8Array(32));
    const wire = serializeContact(pub);
    wire[32] ^= 0xFF; // flip all check bits
    expect(tryParseContact(wire)).toBeNull();
  });
});

describe('length checks', () => {
  it('couldBeMsg requires minimum 19 bytes', () => {
    expect(couldBeMsg(new Uint8Array(18))).toBe(false);
    expect(couldBeMsg(new Uint8Array(19))).toBe(true);
    expect(couldBeMsg(new Uint8Array(100))).toBe(true);
  });

  it('couldBeIntro requires minimum 51 bytes', () => {
    expect(couldBeIntro(new Uint8Array(50))).toBe(false);
    expect(couldBeIntro(new Uint8Array(51))).toBe(true);
    expect(couldBeIntro(new Uint8Array(200))).toBe(true);
  });
});

describe('splitIntro', () => {
  it('splits first 32 bytes as eph_pub, rest as payload', () => {
    const data = new Uint8Array(60);
    data.fill(0xAA, 0, 32);
    data.fill(0xBB, 32, 60);
    const { ephPub, payload } = splitIntro(data);
    expect(ephPub.length).toBe(32);
    expect(ephPub.every(b => b === 0xAA)).toBe(true);
    expect(payload.length).toBe(28);
    expect(payload.every(b => b === 0xBB)).toBe(true);
  });
});

describe('compression mode constants', () => {
  it('are 2-bit values (0-2)', () => {
    expect(COMP_LITERAL).toBe(0);
    expect(COMP_SQUASH_SMAZ).toBe(1);
    expect(COMP_SQUASH_ONLY).toBe(2);
  });

  it('are distinct', () => {
    const modes = [COMP_LITERAL, COMP_SQUASH_SMAZ, COMP_SQUASH_ONLY];
    expect(new Set(modes).size).toBe(3);
  });
});
