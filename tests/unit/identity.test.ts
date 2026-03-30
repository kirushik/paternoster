import { describe, it, expect, beforeAll } from 'vitest';
import { exportIdentity, importIdentity, PBKDF2_ITERATIONS } from '../../src/identity';
import { generateKeyPair } from '../../src/crypto';

describe('identity export/import', () => {
  let privateKey: Uint8Array;
  let publicKey: Uint8Array;
  const passphrase = 'test-passphrase-123';

  beforeAll(async () => {
    const kp = await generateKeyPair();
    privateKey = kp.privateKey;
    publicKey = kp.publicKey;
  });

  it('roundtrips with correct passphrase', async () => {
    const blob = await exportIdentity(privateKey, publicKey, passphrase);
    const result = await importIdentity(blob, passphrase);
    expect(result.privateKey).toEqual(privateKey);
    expect(result.publicKey).toEqual(publicKey);
  });

  it('produces different blobs each time (random salt/IV)', async () => {
    const blob1 = await exportIdentity(privateKey, publicKey, passphrase);
    const blob2 = await exportIdentity(privateKey, publicKey, passphrase);
    expect(blob1).not.toBe(blob2);
  });

  it('throws on wrong passphrase', async () => {
    const blob = await exportIdentity(privateKey, publicKey, passphrase);
    await expect(importIdentity(blob, 'wrong-passphrase')).rejects.toThrow('Неверный пароль');
  });

  it('throws on corrupted blob', async () => {
    const blob = await exportIdentity(privateKey, publicKey, passphrase);
    const corrupted = blob.slice(0, -5) + 'XXXXX';
    await expect(importIdentity(corrupted, passphrase)).rejects.toThrow();
  });

  it('throws on too-short blob', async () => {
    await expect(importIdentity('AAAA', passphrase)).rejects.toThrow('Неверный формат');
  });

  it('PBKDF2 iteration count is pinned at 100k', () => {
    expect(PBKDF2_ITERATIONS).toBe(100_000);
  });

  it('rejects blob with mismatched keypair', async () => {
    // Export with real private key but fake public key
    const fakePublic = new Uint8Array(32).fill(0xFF);
    const blob = await exportIdentity(privateKey, fakePublic, passphrase);
    await expect(importIdentity(blob, passphrase)).rejects.toThrow('ключи не совпадают');
  });
});
