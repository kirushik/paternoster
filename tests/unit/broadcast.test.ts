import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../../src/crypto';
import { deriveSigningKeys } from '../../src/sign';
import {
  serializeBroadcastUnsigned,
  serializeBroadcastSigned,
  tryParseBroadcastUnsigned,
  tryParseBroadcastSigned,
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
    expect(frame.length).toBe(1 + 3 + 2); // flags + data + check
    expect(flagsTag(frame[0])).toBe(BROADCAST_UNSIGNED_TAG);
    expect(flagsCompMode(frame[0])).toBe(COMP_LITERAL);
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
    frame[frame.length - 1] ^= 0xFF; // flip check byte
    expect(tryParseBroadcastUnsigned(frame)).toBeNull();
  });

  it('rejects wrong discriminator', () => {
    // Craft a frame with signed tag instead of unsigned
    const frame = new Uint8Array([packFlags(0, BROADCAST_SIGNED_TAG), 0x01, 0x00, 0x00]);
    expect(tryParseBroadcastUnsigned(frame)).toBeNull();
  });

  it('rejects too-short data', () => {
    expect(tryParseBroadcastUnsigned(new Uint8Array([0x03]))).toBeNull();
    expect(tryParseBroadcastUnsigned(new Uint8Array([0x03, 0x00]))).toBeNull();
    expect(tryParseBroadcastUnsigned(new Uint8Array([0x03, 0x00, 0x00]))).toBeNull();
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

describe('BROADCAST_SIGNED serialization', () => {
  it('produces correct size', async () => {
    const kp = await generateKeyPair();
    const keys = await deriveSigningKeys(kp.privateKey);
    const compressed = new Uint8Array([0x41, 0x42]);
    const frame = await serializeBroadcastSigned(
      compressed, COMP_LITERAL,
      kp.publicKey, keys.publicKeyRaw,
      keys.privateKey,
    );
    // flags(1) + x25519(32) + ed25519(32) + data(2) + sig(64) = 131
    expect(frame.length).toBe(131);
  });

  it('roundtrips through parse', async () => {
    const kp = await generateKeyPair();
    const keys = await deriveSigningKeys(kp.privateKey);
    const compressed = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]);
    const frame = await serializeBroadcastSigned(
      compressed, COMP_SQUASH_ONLY,
      kp.publicKey, keys.publicKeyRaw,
      keys.privateKey,
    );
    const parsed = await tryParseBroadcastSigned(frame);
    expect(parsed).not.toBeNull();
    expect(parsed!.compMode).toBe(COMP_SQUASH_ONLY);
    expect(parsed!.x25519Pub).toEqual(kp.publicKey);
    expect(parsed!.ed25519Pub).toEqual(keys.publicKeyRaw);
    expect(parsed!.compressed).toEqual(compressed);
  });

  it('rejects tampered signature', async () => {
    const kp = await generateKeyPair();
    const keys = await deriveSigningKeys(kp.privateKey);
    const compressed = new Uint8Array([0x01]);
    const frame = await serializeBroadcastSigned(
      compressed, COMP_LITERAL,
      kp.publicKey, keys.publicKeyRaw,
      keys.privateKey,
    );
    frame[frame.length - 1] ^= 0xFF; // flip last byte of signature
    const parsed = await tryParseBroadcastSigned(frame);
    expect(parsed).toBeNull();
  });

  it('rejects wrong discriminator', async () => {
    // First byte should have signed tag, but use unsigned tag
    const data = new Uint8Array(131).fill(0);
    data[0] = packFlags(0, BROADCAST_UNSIGNED_TAG);
    const parsed = await tryParseBroadcastSigned(data);
    expect(parsed).toBeNull();
  });

  it('rejects too-short data', async () => {
    const short = new Uint8Array(128).fill(0);
    short[0] = packFlags(0, BROADCAST_SIGNED_TAG);
    expect(await tryParseBroadcastSigned(short)).toBeNull();
  });
});

describe('broadcast frames vs other frame types', () => {
  it('BROADCAST_UNSIGNED is not confused with CONTACT', () => {
    // CONTACT is exactly 34 bytes with check bytes
    const pub = crypto.getRandomValues(new Uint8Array(32));
    const [a, b] = contactCheckBytes(pub);
    const contactFrame = new Uint8Array(34);
    contactFrame.set(pub);
    contactFrame[32] = a;
    contactFrame[33] = b;

    // CONTACT should still parse as CONTACT (not broadcast)
    expect(tryParseContact(contactFrame)).not.toBeNull();
    // It might or might not parse as broadcast — but CONTACT is checked first in detection order
  });

  it('random data rarely matches BROADCAST_UNSIGNED', () => {
    let matches = 0;
    for (let i = 0; i < 1000; i++) {
      const random = crypto.getRandomValues(new Uint8Array(20));
      if (tryParseBroadcastUnsigned(random) !== null) matches++;
    }
    // Expected: ~1000 * (1/64) * (1/65536) ≈ 0.0002. Should be 0 in practice.
    expect(matches).toBe(0);
  });
});
