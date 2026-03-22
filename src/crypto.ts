import { concatU8 } from './utils';

const SALT_PREFIX = new TextEncoder().encode('paternoster-v2');
export const SEED_LENGTH = 6;
const TAG_LENGTH = 96; // bits (12 bytes)
const OKM_LENGTH = 44; // 32-byte key + 12-byte IV

/** Check if the browser supports X25519. Throws a user-friendly error if not. */
export async function checkX25519Support(): Promise<void> {
  try {
    await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  } catch {
    throw new Error(
      'Ваш браузер не поддерживает X25519.\n' +
      'Используйте современную версию Chrome, Firefox или Safari.'
    );
  }
}

/** Generate a new X25519 key pair and return raw bytes. */
export async function generateKeyPair(): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
  const keyPair = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']) as CryptoKeyPair;
  const [privateKey, publicKey] = await Promise.all([
    exportPrivateKey(keyPair.privateKey),
    exportPublicKey(keyPair.publicKey),
  ]);
  return { privateKey, publicKey };
}

/** Export a CryptoKey public key to 32-byte Uint8Array. */
export async function exportPublicKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

/** Export a CryptoKey private key to 32-byte Uint8Array. */
export async function exportPrivateKey(key: CryptoKey): Promise<Uint8Array> {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', key);
  const pkcs8Bytes = new Uint8Array(pkcs8);
  // PKCS8 for X25519: 48 bytes total. The raw 32-byte key starts at offset 16.
  return pkcs8Bytes.slice(pkcs8Bytes.length - 32);
}

/** Import raw 32-byte public key into CryptoKey. */
export async function importPublicKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'X25519' }, true, []);
}

/** Import raw 32-byte private key into CryptoKey. */
export async function importPrivateKey(raw: Uint8Array): Promise<CryptoKey> {
  // Wrap the 32-byte key in PKCS8 ASN.1 structure for X25519
  const pkcs8Header = new Uint8Array([
    0x30, 0x2e,             // SEQUENCE (46 bytes)
    0x02, 0x01, 0x00,       // INTEGER 0 (version)
    0x30, 0x05,             // SEQUENCE (5 bytes) - AlgorithmIdentifier
    0x06, 0x03, 0x2b, 0x65, 0x6e, // OID 1.3.101.110 (X25519)
    0x04, 0x22,             // OCTET STRING (34 bytes)
    0x04, 0x20,             // OCTET STRING (32 bytes) - the actual key
  ]);
  const pkcs8 = concatU8(pkcs8Header, raw);
  return crypto.subtle.importKey('pkcs8', pkcs8 as BufferSource, { name: 'X25519' }, true, ['deriveBits']);
}

/** Derive X25519 public key from raw private key bytes (scalar mult against base point). */
export async function derivePublicKey(rawPrivate: Uint8Array): Promise<Uint8Array> {
  const privKey = await importPrivateKey(rawPrivate);
  const basePoint = new Uint8Array(32);
  basePoint[0] = 9;
  const basePub = await importPublicKey(basePoint);
  const pubBytes = await crypto.subtle.deriveBits(
    { name: 'X25519', public: basePub }, privKey, 256,
  );
  return new Uint8Array(pubBytes);
}

/**
 * Compute direction byte for domain separation.
 * 0x00 if senderPub < recipientPub (lexicographic), 0x01 otherwise.
 */
export function directionByte(senderPub: Uint8Array, recipientPub: Uint8Array): number {
  for (let i = 0; i < 32; i++) {
    if (senderPub[i] < recipientPub[i]) return 0x00;
    if (senderPub[i] > recipientPub[i]) return 0x01;
  }
  return 0x00; // equal keys (self-encryption)
}

/**
 * Derive per-message AES key + IV from ECDH shared secret and a random seed.
 *
 * PRK = HKDF-Extract(salt = "paternoster-v2" || seed, IKM = sharedBits)
 * OKM = HKDF-Expand(PRK, info = [headerByte, dirByte], L = 44)
 * key = OKM[0..31], iv = OKM[32..43]
 */
async function deriveKeyIV(
  sharedBits: ArrayBuffer,
  seed: Uint8Array,
  headerByte: number,
  dirByte: number,
): Promise<{ key: CryptoKey; iv: Uint8Array }> {
  const salt = concatU8(SALT_PREFIX, seed);
  const info = new Uint8Array([headerByte, dirByte]);

  const keyMaterial = await crypto.subtle.importKey(
    'raw', sharedBits, 'HKDF', false, ['deriveBits'],
  );
  const okm = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    keyMaterial,
    OKM_LENGTH * 8,
  ));

  const key = await crypto.subtle.importKey(
    'raw', okm.slice(0, 32) as BufferSource,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
  const iv = okm.slice(32, 44);

  return { key, iv };
}

/**
 * Encrypt plaintext bytes. Returns [6-byte seed][ciphertext+96-bit tag].
 * Header byte is bound as AAD (authenticated but not encrypted).
 */
export async function encrypt(
  plaintext: Uint8Array,
  myPrivateKey: Uint8Array,
  theirPublicKey: Uint8Array,
  senderPub: Uint8Array,
  recipientPub: Uint8Array,
  headerByte: number,
): Promise<Uint8Array> {
  const myKey = await importPrivateKey(myPrivateKey);
  const theirKey = await importPublicKey(theirPublicKey);
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: theirKey }, myKey, 256,
  );

  const seed = crypto.getRandomValues(new Uint8Array(SEED_LENGTH));
  const dirByte = directionByte(senderPub, recipientPub);
  const { key, iv } = await deriveKeyIV(sharedBits, seed, headerByte, dirByte);

  const aad = new Uint8Array([headerByte]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, tagLength: TAG_LENGTH, additionalData: aad as BufferSource },
    key, plaintext as BufferSource,
  );

  return concatU8(seed, new Uint8Array(ciphertext));
}

/**
 * Decrypt ciphertext bytes. Input: [6-byte seed][ciphertext+96-bit tag].
 * Header byte is checked as AAD — tampered headers cause decryption failure.
 */
export async function decrypt(
  data: Uint8Array,
  myPrivateKey: Uint8Array,
  theirPublicKey: Uint8Array,
  senderPub: Uint8Array,
  recipientPub: Uint8Array,
  headerByte: number,
): Promise<Uint8Array> {
  const seed = data.slice(0, SEED_LENGTH);
  const ciphertext = data.slice(SEED_LENGTH);

  const myKey = await importPrivateKey(myPrivateKey);
  const theirKey = await importPublicKey(theirPublicKey);
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: theirKey }, myKey, 256,
  );

  const dirByte = directionByte(senderPub, recipientPub);
  const { key, iv } = await deriveKeyIV(sharedBits, seed, headerByte, dirByte);

  const aad = new Uint8Array([headerByte]);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, tagLength: TAG_LENGTH, additionalData: aad as BufferSource },
    key, ciphertext,
  );
  return new Uint8Array(decrypted);
}
