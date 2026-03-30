import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../../src/crypto';
import { hexU8 } from '../../src/utils';
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

  it('known test vector: specific Montgomery u → expected Edwards y', () => {
    // Use the known keypair from XEdDSA fixed test vector section
    const montPub = hexU8('599C8C9CF749CDA7C8B3974D89BA671DCED3C3FDF7D2FFD039BAE55A1135AA4D');
    const edwards = montgomeryToEdwards(montPub);
    // The Edwards point must be exactly 32 bytes and deterministic
    expect(edwards.length).toBe(32);
    // Verify it's consistent across calls
    expect(montgomeryToEdwards(montPub)).toEqual(edwards);
    // Snapshot the exact conversion output to catch arithmetic regressions
    const edHex = Array.from(edwards).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    expect(edHex).toMatchInlineSnapshot(`"FE942805E98AB654699E0E9298A73BC9C45C0FF41C81F9834BBE61127B0D8640"`);
  });
});

describe('XEdDSA fixed test vector', () => {
  // Hardcoded vector generated by our implementation. The signature is deterministic
  // (SHA-512 nonce), so the same privkey + message always produce the same signature.
  // This catches implementation regressions and can be cross-checked against
  // external XEdDSA implementations (libxeddsa, xeddsa-rs) for external correctness.
  const PRIV = '0054BDCCE3BC33E350E63464B9FACAC961FC9FFD508563A0FB87752813C36558';
  const PUB  = '599C8C9CF749CDA7C8B3974D89BA671DCED3C3FDF7D2FFD039BAE55A1135AA4D';
  const SIG  = '2DF791CE9ADA01BDFE2858AB0CAA601758D77A839FD73B577D2AD3529BFBF6DC1ED466670D3C4A0C09B785BC3E66077C0C3BC9F46AD52D95AF52601B3C131605';
  const MSG  = 'xeddsa test vector';

  it('produces expected signature for known key+message', async () => {
    const sig = await xeddsaSign(hexU8(PRIV), new TextEncoder().encode(MSG));
    expect(Array.from(sig).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()).toBe(SIG);
  });

  it('signature verifies against known public key', async () => {
    expect(await xeddsaVerify(hexU8(PUB), hexU8(SIG), new TextEncoder().encode(MSG))).toBe(true);
  });
});

describe('malformed signatures', () => {
  it('empty signature returns false', async () => {
    const kp = await generateKeyPair();
    const data = new TextEncoder().encode('test');
    expect(await xeddsaVerify(kp.publicKey, new Uint8Array(0), data)).toBe(false);
  });

  it('too-short signature (32 bytes) returns false', async () => {
    const kp = await generateKeyPair();
    const data = new TextEncoder().encode('test');
    expect(await xeddsaVerify(kp.publicKey, new Uint8Array(32), data)).toBe(false);
  });

  it('almost-right signature (63 bytes) returns false', async () => {
    const kp = await generateKeyPair();
    const data = new TextEncoder().encode('test');
    expect(await xeddsaVerify(kp.publicKey, new Uint8Array(63), data)).toBe(false);
  });

  it('too-long signature (65 bytes) returns false', async () => {
    const kp = await generateKeyPair();
    const data = new TextEncoder().encode('test');
    expect(await xeddsaVerify(kp.publicKey, new Uint8Array(65), data)).toBe(false);
  });

  it('oversized signature (128 bytes) returns false', async () => {
    const kp = await generateKeyPair();
    const data = new TextEncoder().encode('test');
    expect(await xeddsaVerify(kp.publicKey, new Uint8Array(128), data)).toBe(false);
  });

  it('all-zero 64-byte signature returns false', async () => {
    const kp = await generateKeyPair();
    const data = new TextEncoder().encode('test');
    expect(await xeddsaVerify(kp.publicKey, new Uint8Array(64).fill(0x00), data)).toBe(false);
  });

  it('all-0xFF 64-byte signature returns false', async () => {
    const kp = await generateKeyPair();
    const data = new TextEncoder().encode('test');
    expect(await xeddsaVerify(kp.publicKey, new Uint8Array(64).fill(0xFF), data)).toBe(false);
  });
});

describe('broadcast signature is publicly verifiable (NOT deniable)', () => {
  it('a third party with only the public key can verify authorship', async () => {
    const alice = await generateKeyPair();
    const data = new TextEncoder().encode('public announcement');
    const sig = await xeddsaSign(alice.privateKey, data);

    // A third party (no private key) converts the X25519 public key to Edwards
    // and verifies using only the public key — proving the signature is NOT deniable
    const edPub = montgomeryToEdwards(alice.publicKey);
    const pubKey = await crypto.subtle.importKey('raw', edPub, 'Ed25519', false, ['verify']);
    const thirdPartyCanVerify = await crypto.subtle.verify('Ed25519', pubKey, sig, data);
    expect(thirdPartyCanVerify).toBe(true);
  });
});

describe('montgomeryToEdwards edge cases (degenerate inputs)', () => {
  // Torsion points — not reachable by honest X25519 key generation, but a malicious
  // CONTACT frame could contain them. Must fail gracefully, not crash.

  it('u=0 (order-2 point) → verify returns false', async () => {
    const u0 = new Uint8Array(32); // all zeros
    expect(await xeddsaVerify(u0, new Uint8Array(64), new Uint8Array([1]))).toBe(false);
  });

  it('u=1 (order-4 point) → verify returns false', async () => {
    const u1 = new Uint8Array(32);
    u1[0] = 1;
    expect(await xeddsaVerify(u1, new Uint8Array(64), new Uint8Array([1]))).toBe(false);
  });

  it('u=p-1 (division by zero in conversion) → verify returns false', async () => {
    // p-1 = 2^255 - 20 in little-endian: EC FF FF ... FF 7F
    const uPm1 = new Uint8Array(32).fill(0xFF);
    uPm1[0] = 0xEC;
    uPm1[31] = 0x7F;
    expect(await xeddsaVerify(uPm1, new Uint8Array(64), new Uint8Array([1]))).toBe(false);
  });

  it('all-0xFF key → verify returns false', async () => {
    const uMax = new Uint8Array(32).fill(0xFF);
    expect(await xeddsaVerify(uMax, new Uint8Array(64), new Uint8Array([1]))).toBe(false);
  });
});
