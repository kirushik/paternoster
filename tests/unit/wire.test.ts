import { describe, it, expect } from 'vitest';
import {
  serializeMsg, serializeIntro, serializeContact,
  couldBeMsg, couldBeIntro, splitIntro, tryParseContact,
  contactCheckBytes,
  COMP_LITERAL, COMP_SQUASH_SMAZ, COMP_SQUASH_ONLY,
} from '../../src/wire';

describe('MSG serialization', () => {
  it('serializes as raw payload (no header)', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    expect(serializeMsg(payload)).toEqual(payload);
  });
});

describe('INTRO serialization', () => {
  it('is eph_pub + payload with no header or seed', () => {
    const ephKey = new Uint8Array(32).fill(0xAB);
    const payload = new Uint8Array([1, 2, 3]);
    const wire = serializeIntro(ephKey, payload);
    expect(wire.length).toBe(35);
    expect(wire.slice(0, 32)).toEqual(ephKey);
    expect(wire.slice(32)).toEqual(payload);
  });
});

describe('CONTACT serialization', () => {
  it('is pub + 2 check bytes at the end', async () => {
    const pub = crypto.getRandomValues(new Uint8Array(32));
    const wire = await serializeContact(pub);
    expect(wire.length).toBe(34); // 32 pub + 2 check
    expect(wire.slice(0, 32)).toEqual(pub);
    const [a, b] = await contactCheckBytes(pub);
    expect(wire[32]).toBe(a);
    expect(wire[33]).toBe(b);
  });
});

describe('CONTACT check bytes', () => {
  it('are deterministic', async () => {
    const pub = crypto.getRandomValues(new Uint8Array(32));
    expect(await contactCheckBytes(pub)).toEqual(await contactCheckBytes(pub));
  });

  it('differ for different keys', async () => {
    const pub1 = crypto.getRandomValues(new Uint8Array(32));
    const pub2 = crypto.getRandomValues(new Uint8Array(32));
    // Overwhelming probability of different check bytes
    const [a1, b1] = await contactCheckBytes(pub1);
    const [a2, b2] = await contactCheckBytes(pub2);
    expect(a1 !== a2 || b1 !== b2).toBe(true);
  });

  it('are not both zero for all-zero key', async () => {
    const pub = new Uint8Array(32);
    const [a, b] = await contactCheckBytes(pub);
    expect(a !== 0 || b !== 0).toBe(true);
  });
});

describe('tryParseContact', () => {
  it('parses valid contact token', async () => {
    const pub = crypto.getRandomValues(new Uint8Array(32));
    const wire = await serializeContact(pub);
    expect(await tryParseContact(wire)).toEqual(pub);
  });

  it('rejects wrong length', async () => {
    expect(await tryParseContact(new Uint8Array(32))).toBeNull();
    expect(await tryParseContact(new Uint8Array(33))).toBeNull();
    expect(await tryParseContact(new Uint8Array(35))).toBeNull();
  });

  it('rejects wrong check bytes', async () => {
    const pub = crypto.getRandomValues(new Uint8Array(32));
    const wire = await serializeContact(pub);
    wire[32] ^= 0xFF;
    expect(await tryParseContact(wire)).toBeNull();
  });

  it('rejects when only second check byte is wrong', async () => {
    const pub = crypto.getRandomValues(new Uint8Array(32));
    const wire = await serializeContact(pub);
    // Keep byte 32 correct, corrupt only byte 33
    wire[33] ^= 0xFF;
    expect(await tryParseContact(wire)).toBeNull();
  });

  it('rejects 33 bytes even if first 32 have valid check bytes for their prefix', async () => {
    const data = new Uint8Array(33);
    data.set(crypto.getRandomValues(new Uint8Array(33)));
    expect(await tryParseContact(data)).toBeNull();
  });

  it('rejects 35 bytes', async () => {
    const data = new Uint8Array(35);
    data.set(crypto.getRandomValues(new Uint8Array(35)));
    expect(await tryParseContact(data)).toBeNull();
  });
});

describe('length checks', () => {
  it('couldBeMsg requires minimum 15 bytes (seed:6 + ct:1 + tag:8)', () => {
    expect(couldBeMsg(new Uint8Array(14))).toBe(false);
    expect(couldBeMsg(new Uint8Array(15))).toBe(true);
  });

  it('couldBeIntro requires minimum 41 bytes (eph:32 + ct:1 + tag:8)', () => {
    expect(couldBeIntro(new Uint8Array(40))).toBe(false);
    expect(couldBeIntro(new Uint8Array(41))).toBe(true);
  });
});

describe('splitIntro', () => {
  it('splits first 32 bytes as eph_pub, rest as payload', () => {
    const data = new Uint8Array(60);
    data.fill(0xAA, 0, 32);
    data.fill(0xBB, 32, 60);
    const { ephPub, payload } = splitIntro(data);
    expect(ephPub.length).toBe(32);
    expect(payload.length).toBe(28);
  });
});

describe('compression mode constants', () => {
  it('are 2-bit values', () => {
    expect(COMP_LITERAL).toBe(0);
    expect(COMP_SQUASH_SMAZ).toBe(1);
    expect(COMP_SQUASH_ONLY).toBe(2);
  });
});

describe('wire format snapshots (protocol stability)', () => {
  it('MSG frame is identity (no envelope)', () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F]);
    const wire = serializeMsg(payload);
    expect(Array.from(wire)).toMatchInlineSnapshot(`
      [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10,
        11,
        12,
        13,
        14,
        15,
      ]
    `);
  });

  it('INTRO frame layout: 32-byte eph_pub prefix', () => {
    const ephKey = new Uint8Array(32).fill(0xAA);
    const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09]);
    const wire = serializeIntro(ephKey, payload);
    expect(wire.length).toMatchInlineSnapshot(`41`);
    expect(Array.from(wire.slice(0, 4))).toMatchInlineSnapshot(`
      [
        170,
        170,
        170,
        170,
      ]
    `);
    expect(Array.from(wire.slice(32))).toMatchInlineSnapshot(`
      [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
      ]
    `);
  });

  it('CONTACT frame layout: 32-byte pub + 2 check bytes', async () => {
    const pub = new Uint8Array(32).fill(0x42);
    const wire = await serializeContact(pub);
    expect(wire.length).toMatchInlineSnapshot(`34`);
    // Check bytes are deterministic for a given key
    expect(Array.from(wire.slice(32))).toMatchInlineSnapshot(`
      [
        175,
        57,
      ]
    `);
  });
});
