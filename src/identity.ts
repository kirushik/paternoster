/**
 * Identity export/import: passphrase-protected backup of keypair.
 *
 * Export format: base64url of [16-byte salt][12-byte IV][ciphertext+tag]
 * Inner plaintext: [32-byte privateKey][32-byte publicKey]
 *
 * Key derivation: PBKDF2-SHA256 (100 000 iterations) → AES-256-GCM
 */

import { concatU8, u8toBase64url, base64urlToU8, u8eq } from './utils';
import { derivePublicKey } from './crypto';

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

/** Derive an AES-GCM key from a passphrase and salt using PBKDF2. */
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(passphrase);
  const keyMaterial = await crypto.subtle.importKey('raw', raw as BufferSource, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Export a keypair as a passphrase-protected base64url string. */
export async function exportIdentity(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
  passphrase: string,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const aesKey = await deriveKey(passphrase, salt);
  const plaintext = concatU8(privateKey, publicKey);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext as BufferSource),
  );
  return u8toBase64url(concatU8(salt, iv, ciphertext));
}

/** Import a keypair from a passphrase-protected base64url string. Throws on wrong passphrase or corruption. */
export async function importIdentity(
  blob: string,
  passphrase: string,
): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
  const data = base64urlToU8(blob);
  if (data.length < SALT_LENGTH + IV_LENGTH + 64 + 16) {
    throw new Error('Неверный формат резервной копии');
  }
  const salt = data.slice(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = data.slice(SALT_LENGTH + IV_LENGTH);
  const aesKey = await deriveKey(passphrase, salt);
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext),
    );
  } catch {
    throw new Error('Неверный пароль или повреждённая копия');
  }
  if (plaintext.length !== 64) {
    throw new Error('Неверный формат резервной копии');
  }
  const privateKey = plaintext.slice(0, 32);
  const publicKey = plaintext.slice(32);

  // Validate that the public key matches the private key
  const derived = await derivePublicKey(privateKey);
  if (!u8eq(derived, publicKey)) {
    throw new Error('Повреждённая копия: ключи не совпадают');
  }

  return { privateKey, publicKey };
}
