import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../../src/crypto';
import { xeddsaSign, xeddsaVerify, montgomeryToEdwards, checkEd25519Support } from '../../src/sign';

describe('Ed25519 support check', () => {
  it('reports Ed25519 availability', async () => {
    const supported = await checkEd25519Support();
    expect(typeof supported).toBe('boolean');
    expect(supported).toBe(true);
  });
});

describe('XEdDSA sign and verify', () => {
  it('signs and verifies a message', async () => {
    const kp = await generateKeyPair();
    const data = new TextEncoder().encode('hello broadcast');
    const sig = await xeddsaSign(kp.privateKey, data);
    expect(sig.length).toBe(64);
    const valid = await xeddsaVerify(kp.publicKey, sig, data);
    expect(valid).toBe(true);
  });

  it('produces deterministic signatures', async () => {
    const kp = await generateKeyPair();
    const data = new TextEncoder().encode('deterministic');
    const sig1 = await xeddsaSign(kp.privateKey, data);
    const sig2 = await xeddsaSign(kp.privateKey, data);
    expect(sig1).toEqual(sig2);
  });

  it('rejects tampered message', async () => {
    const kp = await generateKeyPair();
    const data = new TextEncoder().encode('hello broadcast');
    const sig = await xeddsaSign(kp.privateKey, data);
    const tampered = new TextEncoder().encode('hello tampered');
    expect(await xeddsaVerify(kp.publicKey, sig, tampered)).toBe(false);
  });

  it('rejects wrong key', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const data = new TextEncoder().encode('hello');
    const sig = await xeddsaSign(kp1.privateKey, data);
    expect(await xeddsaVerify(kp2.publicKey, sig, data)).toBe(false);
  });

  it('signs empty data', async () => {
    const kp = await generateKeyPair();
    const data = new Uint8Array(0);
    const sig = await xeddsaSign(kp.privateKey, data);
    expect(sig.length).toBe(64);
    expect(await xeddsaVerify(kp.publicKey, sig, data)).toBe(true);
  });

  it('signs long data', async () => {
    const kp = await generateKeyPair();
    const data = new Uint8Array(10000).fill(0x42);
    const sig = await xeddsaSign(kp.privateKey, data);
    expect(await xeddsaVerify(kp.publicKey, sig, data)).toBe(true);
  });
});

describe('XEdDSA sign→verify consistency', () => {
  it('signature verifies with both xeddsaVerify and raw Web Crypto Ed25519', async () => {
    const kp = await generateKeyPair();
    const data = new TextEncoder().encode('consistency check');
    const sig = await xeddsaSign(kp.privateKey, data);

    // Method 1: xeddsaVerify (converts montgomery→edwards internally)
    const ok1 = await xeddsaVerify(kp.publicKey, sig, data);

    // Method 2: manually convert and use Web Crypto directly
    const edPub = montgomeryToEdwards(kp.publicKey);
    const pubKey = await crypto.subtle.importKey('raw', edPub, 'Ed25519', false, ['verify']);
    const ok2 = await crypto.subtle.verify('Ed25519', pubKey, sig, data);

    expect(ok1).toBe(true);
    expect(ok2).toBe(true);
  });

  it('verifies across 10 random keypairs', async () => {
    for (let i = 0; i < 10; i++) {
      const kp = await generateKeyPair();
      const data = new TextEncoder().encode(`test ${i}`);
      const sig = await xeddsaSign(kp.privateKey, data);
      const ok = await xeddsaVerify(kp.publicKey, sig, data);
      expect(ok).toBe(true);
    }
  });
});

describe('montgomeryToEdwards', () => {
  it('produces 32-byte output', async () => {
    const kp = await generateKeyPair();
    const edwards = montgomeryToEdwards(kp.publicKey);
    expect(edwards.length).toBe(32);
  });

  it('produces different output for different keys', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const e1 = montgomeryToEdwards(kp1.publicKey);
    const e2 = montgomeryToEdwards(kp2.publicKey);
    expect(e1).not.toEqual(e2);
  });

  it('produces valid Ed25519 public key (importable)', async () => {
    const kp = await generateKeyPair();
    const edwards = montgomeryToEdwards(kp.publicKey);
    // Should import without throwing
    const pubKey = await crypto.subtle.importKey('raw', edwards, 'Ed25519', false, ['verify']);
    expect(pubKey.type).toBe('public');
  });
});
