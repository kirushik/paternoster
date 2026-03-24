import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../../src/crypto';
import { deriveSigningKeys, signData, verifySignature, checkEd25519Support } from '../../src/sign';

describe('Ed25519 support check', () => {
  it('reports Ed25519 availability', async () => {
    const supported = await checkEd25519Support();
    expect(typeof supported).toBe('boolean');
    // Node.js 20+ supports Ed25519
    expect(supported).toBe(true);
  });
});

describe('Ed25519 key derivation', () => {
  it('derives deterministic keys from same X25519 input', async () => {
    const kp = await generateKeyPair();
    const keys1 = await deriveSigningKeys(kp.privateKey);
    const keys2 = await deriveSigningKeys(kp.privateKey);
    expect(keys1.publicKeyRaw).toEqual(keys2.publicKeyRaw);
  });

  it('produces 32-byte public key', async () => {
    const kp = await generateKeyPair();
    const keys = await deriveSigningKeys(kp.privateKey);
    expect(keys.publicKeyRaw.length).toBe(32);
  });

  it('different X25519 keys produce different Ed25519 keys', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const keys1 = await deriveSigningKeys(kp1.privateKey);
    const keys2 = await deriveSigningKeys(kp2.privateKey);
    expect(keys1.publicKeyRaw).not.toEqual(keys2.publicKeyRaw);
  });
});

describe('Ed25519 sign and verify', () => {
  it('signs and verifies a message', async () => {
    const kp = await generateKeyPair();
    const keys = await deriveSigningKeys(kp.privateKey);
    const data = new TextEncoder().encode('hello broadcast');
    const sig = await signData(keys.privateKey, data);
    expect(sig.length).toBe(64);
    const valid = await verifySignature(keys.publicKeyRaw, sig, data);
    expect(valid).toBe(true);
  });

  it('rejects tampered message', async () => {
    const kp = await generateKeyPair();
    const keys = await deriveSigningKeys(kp.privateKey);
    const data = new TextEncoder().encode('hello broadcast');
    const sig = await signData(keys.privateKey, data);
    const tampered = new TextEncoder().encode('hello tampered');
    const valid = await verifySignature(keys.publicKeyRaw, sig, tampered);
    expect(valid).toBe(false);
  });

  it('rejects wrong key', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const keys1 = await deriveSigningKeys(kp1.privateKey);
    const keys2 = await deriveSigningKeys(kp2.privateKey);
    const data = new TextEncoder().encode('hello');
    const sig = await signData(keys1.privateKey, data);
    const valid = await verifySignature(keys2.publicKeyRaw, sig, data);
    expect(valid).toBe(false);
  });

  it('signs empty data', async () => {
    const kp = await generateKeyPair();
    const keys = await deriveSigningKeys(kp.privateKey);
    const data = new Uint8Array(0);
    const sig = await signData(keys.privateKey, data);
    expect(sig.length).toBe(64);
    expect(await verifySignature(keys.publicKeyRaw, sig, data)).toBe(true);
  });
});
