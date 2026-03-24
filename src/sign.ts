/**
 * Ed25519 digital signatures derived from X25519 identity keys.
 *
 * The Ed25519 seed is deterministically derived from the X25519 private key
 * via HKDF-SHA256, so the user manages a single keypair. The Ed25519 public
 * key is extracted by importing the PKCS8 private key and exporting as JWK.
 *
 * Used exclusively for broadcast message signing (publish.html creates,
 * index.html verifies).
 */

import { concatU8, base64urlToU8 } from './utils';

const SIGN_SALT = new TextEncoder().encode('paternoster-sign-v1');
const SIGN_INFO = new TextEncoder().encode('ed25519');

/**
 * PKCS8 header for Ed25519 (RFC 8410).
 * Identical to the X25519 header in crypto.ts except OID byte: 0x6e → 0x70.
 */
const ED25519_PKCS8_HEADER = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05,
  0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

export interface SigningKeys {
  privateKey: CryptoKey;
  publicKeyRaw: Uint8Array; // 32 bytes
}

/** Check if the browser supports Ed25519 signing. */
export async function checkEd25519Support(): Promise<boolean> {
  try {
    const kp = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    // If generateKey didn't throw, Ed25519 is supported.
    void kp;
    return true;
  } catch {
    return false;
  }
}

/**
 * Derive an Ed25519 signing keypair from an X25519 private key.
 *
 * seed = HKDF-Expand(HKDF-Extract(salt, x25519_priv), info, 32)
 * The seed is imported as an Ed25519 PKCS8 private key, then the public key
 * is extracted via JWK export.
 */
export async function deriveSigningKeys(x25519PrivateKey: Uint8Array): Promise<SigningKeys> {
  // HKDF: extract + expand to get 32-byte Ed25519 seed
  const hkdfKey = await crypto.subtle.importKey(
    'raw', x25519PrivateKey as BufferSource, 'HKDF', false, ['deriveBits'],
  );
  const seed = new Uint8Array(await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: SIGN_SALT as BufferSource,
      info: SIGN_INFO as BufferSource,
    },
    hkdfKey,
    256,
  ));

  // Wrap as PKCS8 and import as Ed25519 private key
  const pkcs8 = concatU8(ED25519_PKCS8_HEADER, seed);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', pkcs8 as BufferSource, 'Ed25519', true, ['sign'],
  );

  // Extract public key via JWK export (the `x` field is the 32-byte public key)
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  const publicKeyRaw = base64urlToU8(jwk.x!);

  return { privateKey, publicKeyRaw };
}

/** Sign data with an Ed25519 private key. Returns 64-byte signature. */
export async function signData(privateKey: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, data as BufferSource));
}

/** Verify an Ed25519 signature. Returns true if valid. */
export async function verifySignature(
  publicKeyRaw: Uint8Array,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  try {
    const pubKey = await crypto.subtle.importKey(
      'raw', publicKeyRaw as BufferSource, 'Ed25519', false, ['verify'],
    );
    return await crypto.subtle.verify('Ed25519', pubKey, signature as BufferSource, data as BufferSource);
  } catch {
    // Ed25519 not supported or invalid key — treat as unverifiable
    return false;
  }
}
