import { describe, it, expect } from 'vitest';
import { exportIdentity, importIdentity } from '../../src/identity';

describe('identity export/import', () => {
  const privateKey = new Uint8Array(32).fill(0xAA);
  const publicKey = new Uint8Array(32).fill(0xBB);
  const passphrase = 'test-passphrase-123';

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
});
