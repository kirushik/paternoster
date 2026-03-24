import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../../src/crypto';
import {
  serializeBroadcastUnsigned,
  serializeBroadcastSigned,
  tryParseBroadcastUnsigned,
  tryParseBroadcastSigned,
  pubFingerprint,
  packFlags,
  flagsCompMode,
  flagsTag,
} from '../../src/broadcast';
import {
  COMP_LITERAL, COMP_SQUASH_SMAZ, COMP_SQUASH_ONLY,
  BROADCAST_SIGNED_TAG, BROADCAST_UNSIGNED_TAG,
  contactCheckBytes, tryParseContact,
} from '../../src/wire';

describe('flags byte packing', () => {
  it('packs and extracts compMode correctly', () => {
    for (const mode of [COMP_LITERAL, COMP_SQUASH_SMAZ, COMP_SQUASH_ONLY]) {
      const flags = packFlags(mode, BROADCAST_UNSIGNED_TAG);
      expect(flagsCompMode(flags)).toBe(mode);
      expect(flagsTag(flags)).toBe(BROADCAST_UNSIGNED_TAG);
    }
  });

  it('packs signed tag correctly', () => {
    const flags = packFlags(COMP_LITERAL, BROADCAST_SIGNED_TAG);
    expect(flagsTag(flags)).toBe(BROADCAST_SIGNED_TAG);
    expect(flagsCompMode(flags)).toBe(COMP_LITERAL);
  });
});

describe('BROADCAST_UNSIGNED serialization', () => {
  it('produces flags + compressed + 2 check bytes', () => {
    const compressed = new Uint8Array([0x41, 0x42, 0x43]);
    const frame = serializeBroadcastUnsigned(compressed, COMP_LITERAL);
    expect(frame.length).toBe(1 + 3 + 2);
    expect(flagsTag(frame[0])).toBe(BROADCAST_UNSIGNED_TAG);
  });

  it('roundtrips through parse', () => {
    const compressed = new Uint8Array([0x01, 0x02, 0x03, 0xFF]);
    const frame = serializeBroadcastUnsigned(compressed, COMP_SQUASH_SMAZ);
    const parsed = tryParseBroadcastUnsigned(frame);
    expect(parsed).not.toBeNull();
    expect(parsed!.compMode).toBe(COMP_SQUASH_SMAZ);
    expect(parsed!.compressed).toEqual(compressed);
  });

  it('rejects tampered checksum', () => {
    const compressed = new Uint8Array([0x01, 0x02]);
    const frame = serializeBroadcastUnsigned(compressed, COMP_LITERAL);
    frame[frame.length - 1] ^= 0xFF;
    expect(tryParseBroadcastUnsigned(frame)).toBeNull();
  });

  it('roundtrips all byte values', () => {
    const allBytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) allBytes[i] = i;
    const frame = serializeBroadcastUnsigned(allBytes, COMP_LITERAL);
    const parsed = tryParseBroadcastUnsigned(frame);
    expect(parsed).not.toBeNull();
    expect(parsed!.compressed).toEqual(allBytes);
  });
});

describe('BROADCAST_SIGNED serialization (XEdDSA, 67-byte overhead)', () => {
  it('produces correct size', async () => {
    const kp = await generateKeyPair();
    const compressed = new Uint8Array([0x41, 0x42]);
    const frame = await serializeBroadcastSigned(compressed, COMP_LITERAL, kp.publicKey, kp.privateKey);
    // flags(1) + fp(2) + data(2) + sig(64) = 69
    expect(frame.length).toBe(69);
  });

  it('roundtrips with fingerprint lookup', async () => {
    const kp = await generateKeyPair();
    const compressed = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]);
    const frame = await serializeBroadcastSigned(compressed, COMP_SQUASH_ONLY, kp.publicKey, kp.privateKey);
    const fp = await pubFingerprint(kp.publicKey);

    const parsed = await tryParseBroadcastSigned(frame, (frameFp) => {
      if (frameFp[0] === fp[0] && frameFp[1] === fp[1]) return kp.publicKey;
      return null;
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.compMode).toBe(COMP_SQUASH_ONLY);
    expect(parsed!.compressed).toEqual(compressed);
    expect(parsed!.x25519Pub).toEqual(kp.publicKey);
  });

  it('returns unverified when no lookup provided', async () => {
    const kp = await generateKeyPair();
    const compressed = new Uint8Array([0x01]);
    const frame = await serializeBroadcastSigned(compressed, COMP_LITERAL, kp.publicKey, kp.privateKey);
    // No lookup function — returns frame but x25519Pub is undefined
    const parsed = await tryParseBroadcastSigned(frame);
    expect(parsed).not.toBeNull();
    expect(parsed!.compressed).toEqual(compressed);
    expect(parsed!.x25519Pub).toBeUndefined();
  });

  it('rejects tampered signature', async () => {
    const kp = await generateKeyPair();
    const compressed = new Uint8Array([0x01]);
    const frame = await serializeBroadcastSigned(compressed, COMP_LITERAL, kp.publicKey, kp.privateKey);
    frame[frame.length - 1] ^= 0xFF;
    const fp = await pubFingerprint(kp.publicKey);
    const parsed = await tryParseBroadcastSigned(frame, (frameFp) => {
      if (frameFp[0] === fp[0] && frameFp[1] === fp[1]) return kp.publicKey;
      return null;
    });
    // Tampered: verification fails, returned without x25519Pub
    expect(parsed).not.toBeNull();
    expect(parsed!.x25519Pub).toBeUndefined();
  });
});

describe('broadcast frames vs other frame types', () => {
  it('BROADCAST_UNSIGNED is not confused with CONTACT', () => {
    const pub = crypto.getRandomValues(new Uint8Array(32));
    const [a, b] = contactCheckBytes(pub);
    const contactFrame = new Uint8Array(34);
    contactFrame.set(pub);
    contactFrame[32] = a;
    contactFrame[33] = b;
    expect(tryParseContact(contactFrame)).not.toBeNull();
  });

  it('random data rarely matches BROADCAST_UNSIGNED', () => {
    let matches = 0;
    for (let i = 0; i < 1000; i++) {
      const random = crypto.getRandomValues(new Uint8Array(20));
      if (tryParseBroadcastUnsigned(random) !== null) matches++;
    }
    expect(matches).toBe(0);
  });
});
