import { concatU8 } from './utils';

const SALT = new TextEncoder().encode('paternoster-v1');
const INFO = new TextEncoder().encode('aes-gcm-256');
const IV_LENGTH = 12;

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
  // X25519 private keys may need PKCS8 export; extract the 32-byte raw key from the DER structure
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
  // X25519 base point: u-coordinate = 9 (little-endian)
  const basePoint = new Uint8Array(32);
  basePoint[0] = 9;
  const basePub = await importPublicKey(basePoint);
  const pubBytes = await crypto.subtle.deriveBits(
    { name: 'X25519', public: basePub }, privKey, 256,
  );
  return new Uint8Array(pubBytes);
}

/** Derive a shared AES-GCM key from ECDH shared secret via HKDF. */
async function deriveAESKey(sharedBits: ArrayBuffer): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: INFO },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt plaintext bytes. Returns [12-byte IV][ciphertext+tag]. */
export async function encrypt(
  plaintext: Uint8Array,
  myPrivateKey: Uint8Array,
  theirPublicKey: Uint8Array,
): Promise<Uint8Array> {
  const myKey = await importPrivateKey(myPrivateKey);
  const theirKey = await importPublicKey(theirPublicKey);
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: theirKey },
    myKey,
    256,
  );
  const aesKey = await deriveAESKey(sharedBits);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext as BufferSource);
  return concatU8(iv, new Uint8Array(ciphertext));
}

/** Decrypt ciphertext bytes. Input: [12-byte IV][ciphertext+tag]. */
export async function decrypt(
  data: Uint8Array,
  myPrivateKey: Uint8Array,
  theirPublicKey: Uint8Array,
): Promise<Uint8Array> {
  const myKey = await importPrivateKey(myPrivateKey);
  const theirKey = await importPublicKey(theirPublicKey);
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: theirKey },
    myKey,
    256,
  );
  const aesKey = await deriveAESKey(sharedBits);
  const iv = data.slice(0, IV_LENGTH);
  const ciphertext = data.slice(IV_LENGTH);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext);
  return new Uint8Array(decrypted);
}
