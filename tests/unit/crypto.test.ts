/**
 * Crypto-specific unit tests targeting Stryker-identified assertion gaps.
 *
 * These complement the integration-level roundtrip tests in pipeline.test.ts
 * by testing domain separation, directionByte edge cases, and HKDF parameter
 * sensitivity directly.
 */
import { describe, it, expect } from 'vitest';
import {
  generateKeyPair,
  encrypt,
  decrypt,
  encryptIntro,
  decryptIntro,
  directionByte,
  seedCompMode,
  CLASS_MSG,
  CLASS_INTRO,
} from '../../src/crypto';

describe('directionByte edge cases', () => {
  it('keys that share a long prefix differ on later byte', () => {
    // Keys identical except byte 30
    const a = new Uint8Array(32).fill(0xAA);
    const b = new Uint8Array(32).fill(0xAA);
    a[30] = 0x01;
    b[30] = 0x02;
    expect(directionByte(a, b)).toBe(0x00);
    expect(directionByte(b, a)).toBe(0x01);
  });

  it('keys that differ only on the last byte', () => {
    const a = new Uint8Array(32).fill(0x00);
    const b = new Uint8Array(32).fill(0x00);
    a[31] = 0x01;
    b[31] = 0x02;
    expect(directionByte(a, b)).toBe(0x00);
    expect(directionByte(b, a)).toBe(0x01);
  });

  it('identical keys return 0x00', () => {
    const a = new Uint8Array(32).fill(0x42);
    expect(directionByte(a, a)).toBe(0x00);
    expect(directionByte(a, new Uint8Array(a))).toBe(0x00);
  });

  it('keys that differ on byte 0 return immediately', () => {
    const a = new Uint8Array(32).fill(0xFF);
    const b = new Uint8Array(32).fill(0xFF);
    a[0] = 0x00;
    b[0] = 0xFF;
    expect(directionByte(a, b)).toBe(0x00);
    expect(directionByte(b, a)).toBe(0x01);
  });
});

describe('seedCompMode extraction', () => {
  it('extracts 2-bit comp mode from seed byte', () => {
    expect(seedCompMode(0b00_000000)).toBe(0);
    expect(seedCompMode(0b01_000000)).toBe(1);
    expect(seedCompMode(0b10_000000)).toBe(2);
    expect(seedCompMode(0b11_000000)).toBe(3);
  });

  it('ignores lower 6 bits', () => {
    expect(seedCompMode(0b01_111111)).toBe(1);
    expect(seedCompMode(0b10_101010)).toBe(2);
  });
});

describe('class domain separation', () => {
  it('MSG encrypted data cannot be decrypted as MSG with wrong sender key', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const eve = await generateKeyPair();

    const plaintext = new Uint8Array([1, 2, 3]);
    const encrypted = await encrypt(plaintext, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG, 0);

    // Eve cannot decrypt — different ECDH shared secret
    await expect(
      decrypt(encrypted, eve.privateKey, alice.publicKey, alice.publicKey, eve.publicKey, CLASS_MSG)
    ).rejects.toThrow();
  });

  it('different compMode produces different ciphertext', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const plaintext = new Uint8Array([1, 2, 3]);

    const enc0 = await encrypt(plaintext, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG, 0);
    const enc1 = await encrypt(plaintext, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG, 1);

    // Different compMode stamped in seed[0] → different ciphertext
    expect(enc0[0] & 0xC0).not.toBe(enc1[0] & 0xC0);
    expect(seedCompMode(enc0[0])).toBe(0);
    expect(seedCompMode(enc1[0])).toBe(1);
  });

  it('direction matters — swapping sender/recipient fails', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const plaintext = new Uint8Array([1, 2, 3]);

    const encrypted = await encrypt(plaintext, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG, 0);

    // Bob decrypts correctly
    const decrypted = await decrypt(encrypted, bob.privateKey, alice.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG);
    expect(decrypted).toEqual(plaintext);

    // But swapping the direction (claiming Bob sent to Alice) should fail
    await expect(
      decrypt(encrypted, bob.privateKey, alice.publicKey, bob.publicKey, alice.publicKey, CLASS_MSG)
    ).rejects.toThrow();
  });
});

describe('INTRO vs MSG isolation', () => {
  it('INTRO ciphertext cannot be decrypted as MSG', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const eph = await generateKeyPair();

    const plaintext = new Uint8Array([1, 2, 3]);
    const encrypted = await encryptIntro(plaintext, eph.privateKey, bob.publicKey, eph.publicKey, bob.publicKey);

    // Try as MSG — should fail (different class byte in HKDF info)
    await expect(
      decrypt(encrypted, bob.privateKey, eph.publicKey, eph.publicKey, bob.publicKey, CLASS_MSG)
    ).rejects.toThrow();
  });
});
