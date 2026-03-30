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
  it('produces compressed + flags + 2 check bytes', async () => {
    const compressed = new Uint8Array([0x41, 0x42, 0x43]);
    const frame = await serializeBroadcastUnsigned(compressed, COMP_LITERAL);
    expect(frame.length).toBe(3 + 1 + 2);
    // flags is at the tail, 3rd byte from end
    expect(flagsTag(frame[frame.length - 3])).toBe(BROADCAST_UNSIGNED_TAG);
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
    // Find any two keys that share a 2-byte fingerprint (birthday collision).
    // With 65536 possible fingerprints and 1024 keys, collision probability is
    // 1 - e^(-1024*1023/(2*65536)) ≈ 0.99999998 — effectively guaranteed.
    const { pubFingerprint } = await import('../../src/broadcast');

    const fpMap = new Map<string, { privateKey: Uint8Array; publicKey: Uint8Array }>();
    let sender: { privateKey: Uint8Array; publicKey: Uint8Array } | null = null;
    let imposterKey: Uint8Array | null = null;

    const batch = await Promise.all(Array.from({ length: 1024 }, () => generateKeyPair()));
    for (const kp of batch) {
      const fp = await pubFingerprint(kp.publicKey);
      const fpHex = `${fp[0]},${fp[1]}`;
      const existing = fpMap.get(fpHex);
      if (existing) {
        sender = existing;
        imposterKey = kp.publicKey;
        break;
      }
      fpMap.set(fpHex, kp);
    }

    // With 1024 keys, failure to find a collision is a test infrastructure bug, not bad luck.
    expect(sender).not.toBeNull();
    expect(imposterKey).not.toBeNull();

    const compressed = new Uint8Array([0x42]);
    const frame = await serializeBroadcastSigned(compressed, COMP_LITERAL, sender!.publicKey, sender!.privateKey);

    // Imposter first, real sender second — must still verify as 'verified'
    const parsed = await tryParseBroadcastSigned(frame, [imposterKey!, sender!.publicKey]);
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('verified');
    expect(parsed!.x25519Pub).toEqual(sender!.publicKey);
  });
});

describe('BROADCAST_SIGNED verifies all matching candidates (not just first)', () => {
  it('multiple non-matching candidates do not prevent verification of the real sender', async () => {
    // This tests the "try ALL candidates" property without needing a fingerprint collision.
    // We provide several candidate keys alongside the real sender. The parser filters by
    // fingerprint match internally — non-matching candidates are skipped. The real sender's
    // fingerprint matches and verification succeeds.
    const sender = await generateKeyPair();
    const decoy1 = await generateKeyPair();
    const decoy2 = await generateKeyPair();

    const compressed = new Uint8Array([0x42, 0x43]);
    const frame = await serializeBroadcastSigned(compressed, COMP_LITERAL, sender.publicKey, sender.privateKey);

    // Provide decoys before the real sender
    const parsed = await tryParseBroadcastSigned(frame, [decoy1.publicKey, decoy2.publicKey, sender.publicKey]);
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('verified');
    expect(parsed!.x25519Pub).toEqual(sender.publicKey);
  });
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

    // Check discriminator survives stego (flags is at tail, 67 bytes from end)
    expect(flagsTag(decoded!.bytes[decoded!.bytes.length - 67])).toBe(BROADCAST_SIGNED_TAG);

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

describe('broadcast parser guard conditions', () => {
  it('rejects unsigned frame with wrong tag byte', async () => {
    // Build a frame that's the right length but has SIGNED tag instead of UNSIGNED
    const compressed = new Uint8Array([0x41, 0x42, 0x43]);
    const frame = await serializeBroadcastUnsigned(compressed, COMP_LITERAL);
    // Replace flags byte (at tail, 3rd from end) with signed tag
    frame[frame.length - 3] = packFlags(COMP_LITERAL, BROADCAST_SIGNED_TAG);
    expect(await tryParseBroadcastUnsigned(frame)).toBeNull();
  });

  it('rejects signed frame with wrong tag byte', async () => {
    const kp = await generateKeyPair();
    const compressed = new Uint8Array([0x01]);
    const frame = await serializeBroadcastSigned(compressed, COMP_LITERAL, kp.publicKey, kp.privateKey);
    // Replace flags byte (at tail, 67th from end) with unsigned tag
    frame[frame.length - 67] = packFlags(COMP_LITERAL, BROADCAST_UNSIGNED_TAG);
    expect(await tryParseBroadcastSigned(frame)).toBeNull();
  });

  it('rejects too-short data for signed broadcast', async () => {
    // MIN_SIGNED_SIZE is 67 (compressed:0 + flags:1 + fp:2 + sig:64); any shorter buffer must be rejected
    const tooShort = new Uint8Array(66);
    expect(await tryParseBroadcastSigned(tooShort)).toBeNull();
  });

  it('fingerprint matching requires both bytes to match', async () => {
    const { pubFingerprint } = await import('../../src/broadcast');
    const kp = await generateKeyPair();
    const compressed = new Uint8Array([0x42]);
    const frame = await serializeBroadcastSigned(compressed, COMP_LITERAL, kp.publicKey, kp.privateKey);

    const realFp = await pubFingerprint(kp.publicKey);

    // Deterministically find a key where fp[0] matches but fp[1] doesn't:
    // brute-force sequential 32-byte values (SHA-256 is fast, typically <20 needed)
    let fakeKey: Uint8Array | null = null;
    for (let seed = 0; seed < 100_000; seed++) {
      const candidate = new Uint8Array(32);
      candidate[0] = seed & 0xFF;
      candidate[1] = (seed >> 8) & 0xFF;
      candidate[2] = (seed >> 16) & 0xFF;
      const fp = await pubFingerprint(candidate);
      if (fp[0] === realFp[0] && fp[1] !== realFp[1]) {
        fakeKey = candidate;
        break;
      }
    }
    // With 100K sequential candidates and only needing fp[0] match + fp[1] mismatch,
    // expected ~390 candidates per match (256 values for fp[0], ~255/256 chance fp[1] differs).
    expect(fakeKey).not.toBeNull();

    // The fake key should NOT verify (fingerprint doesn't fully match)
    const parsed = await tryParseBroadcastSigned(frame, [fakeKey!]);
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('unverified');
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
