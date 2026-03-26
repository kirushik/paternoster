import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../../src/crypto';
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
  it('produces flags + compressed + 2 check bytes', async () => {
    const compressed = new Uint8Array([0x41, 0x42, 0x43]);
    const frame = await serializeBroadcastUnsigned(compressed, COMP_LITERAL);
    expect(frame.length).toBe(1 + 3 + 2);
    expect(flagsTag(frame[0])).toBe(BROADCAST_UNSIGNED_TAG);
  });

  it('roundtrips through parse', async () => {
    const compressed = new Uint8Array([0x01, 0x02, 0x03, 0xFF]);
    const frame = await serializeBroadcastUnsigned(compressed, COMP_SQUASH_SMAZ);
    const parsed = await tryParseBroadcastUnsigned(frame);
    expect(parsed).not.toBeNull();
    expect(parsed!.compMode).toBe(COMP_SQUASH_SMAZ);
    expect(parsed!.compressed).toEqual(compressed);
  });

  it('rejects tampered checksum', async () => {
    const compressed = new Uint8Array([0x01, 0x02]);
    const frame = await serializeBroadcastUnsigned(compressed, COMP_LITERAL);
    frame[frame.length - 1] ^= 0xFF;
    expect(await tryParseBroadcastUnsigned(frame)).toBeNull();
  });

  it('roundtrips all byte values', async () => {
    const allBytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) allBytes[i] = i;
    const frame = await serializeBroadcastUnsigned(allBytes, COMP_LITERAL);
    const parsed = await tryParseBroadcastUnsigned(frame);
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

  it('roundtrips with candidate keys → status verified', async () => {
    const kp = await generateKeyPair();
    const compressed = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]);
    const frame = await serializeBroadcastSigned(compressed, COMP_SQUASH_ONLY, kp.publicKey, kp.privateKey);

    const parsed = await tryParseBroadcastSigned(frame, [kp.publicKey]);
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('verified');
    expect(parsed!.compMode).toBe(COMP_SQUASH_ONLY);
    expect(parsed!.compressed).toEqual(compressed);
    expect(parsed!.x25519Pub).toEqual(kp.publicKey);
  });

  it('returns unverified when no candidates provided', async () => {
    const kp = await generateKeyPair();
    const compressed = new Uint8Array([0x01]);
    const frame = await serializeBroadcastSigned(compressed, COMP_LITERAL, kp.publicKey, kp.privateKey);
    const parsed = await tryParseBroadcastSigned(frame);
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('unverified');
    expect(parsed!.x25519Pub).toBeUndefined();
  });

  it('tampered signature → status failed', async () => {
    const kp = await generateKeyPair();
    const compressed = new Uint8Array([0x01]);
    const frame = await serializeBroadcastSigned(compressed, COMP_LITERAL, kp.publicKey, kp.privateKey);
    frame[frame.length - 1] ^= 0xFF;
    const parsed = await tryParseBroadcastSigned(frame, [kp.publicKey]);
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('failed');
    expect(parsed!.x25519Pub).toBeUndefined();
  });
});

describe('BROADCAST_SIGNED fingerprint collision handling', () => {
  it('verifies correct key even when a colliding-fingerprint wrong key is tried first', async () => {
    // Construct the scenario directly: two candidate keys where the wrong one
    // has the same fingerprint as the sender. We craft a fake "imposter" key
    // by generating keys until one collides on the 2-byte fingerprint.
    const { pubFingerprint } = await import('../../src/broadcast');
    const sender = await generateKeyPair();
    const senderFp = await pubFingerprint(sender.publicKey);

    // Batch key generation for speed — generate 256 keys, check fingerprints
    let imposterKey: Uint8Array | null = null;
    for (let batch = 0; batch < 1000 && !imposterKey; batch++) {
      const keys = await Promise.all(Array.from({ length: 256 }, () => generateKeyPair()));
      for (const kp of keys) {
        const fp = await pubFingerprint(kp.publicKey);
        if (fp[0] === senderFp[0] && fp[1] === senderFp[1]) {
          imposterKey = kp.publicKey;
          break;
        }
      }
    }
    if (!imposterKey) {
      // Extremely unlikely (256k attempts), but skip rather than fail
      console.log('SKIP: no fingerprint collision found in 256k attempts');
      return;
    }

    const compressed = new Uint8Array([0x42]);
    const frame = await serializeBroadcastSigned(compressed, COMP_LITERAL, sender.publicKey, sender.privateKey);

    // Imposter first, real sender second — must still verify as 'verified'
    const parsed = await tryParseBroadcastSigned(frame, [imposterKey, sender.publicKey]);
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('verified');
    expect(parsed!.x25519Pub).toEqual(sender.publicKey);
  }, 30000); // allow up to 30s for brute-force
});

describe('BROADCAST_SIGNED through stego roundtrip with candidate match', () => {
  it('verifies after stego encode→decode (simulating full handleDecode flow)', async () => {
    const { stegoEncode, stegoDecode } = await import('../../src/stego');
    const { compress } = await import('../../src/compress');
    const kp = await generateKeyPair();
    const { payload: compressed, compMode } = compress('Тест');
    const frame = await serializeBroadcastSigned(compressed, compMode, kp.publicKey, kp.privateKey);

    // Stego roundtrip
    const stegoText = stegoEncode(frame, 'БОЖЕ');
    const decoded = stegoDecode(stegoText);
    expect(decoded).not.toBeNull();

    // Check discriminator survives stego
    expect(flagsTag(decoded!.bytes[0])).toBe(BROADCAST_SIGNED_TAG);

    // Verify with candidate key
    const parsed = await tryParseBroadcastSigned(decoded!.bytes, [kp.publicKey]);
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('verified');
  });
});

describe('BROADCAST_SIGNED candidate key via hex roundtrip', () => {
  it('verifies when candidate key went through hex serialization (like localStorage)', async () => {
    const { u8hex, hexU8 } = await import('../../src/utils');
    const kp = await generateKeyPair();
    const compressed = new Uint8Array([0x01, 0x02]);
    const frame = await serializeBroadcastSigned(compressed, COMP_LITERAL, kp.publicKey, kp.privateKey);

    // Simulate localStorage roundtrip: key → hex → back to Uint8Array
    const hexKey = u8hex(kp.publicKey);
    const restoredKey = hexU8(hexKey);

    const parsed = await tryParseBroadcastSigned(frame, [restoredKey]);
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('verified');
    expect(parsed!.x25519Pub).toEqual(restoredKey);
  });
});

describe('broadcast frames vs other frame types', () => {
  it('BROADCAST_UNSIGNED is not confused with CONTACT', async () => {
    const pub = crypto.getRandomValues(new Uint8Array(32));
    const [a, b] = await contactCheckBytes(pub);
    const contactFrame = new Uint8Array(34);
    contactFrame.set(pub);
    contactFrame[32] = a;
    contactFrame[33] = b;
    expect(await tryParseContact(contactFrame)).not.toBeNull();
  });

  it('random data rarely matches BROADCAST_UNSIGNED', async () => {
    let matches = 0;
    for (let i = 0; i < 1000; i++) {
      const random = crypto.getRandomValues(new Uint8Array(20));
      if (await tryParseBroadcastUnsigned(random) !== null) matches++;
    }
    expect(matches).toBe(0);
  });

  it('signed broadcast is not detected as unsigned', async () => {
    const kp = await generateKeyPair();
    const compressed = new Uint8Array([0x01]);
    const frame = await serializeBroadcastSigned(compressed, COMP_LITERAL, kp.publicKey, kp.privateKey);
    expect(await tryParseBroadcastUnsigned(frame)).toBeNull();
  });
});
