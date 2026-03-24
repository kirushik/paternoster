/**
 * Broadcast wire format: public one-to-many messages.
 *
 * Two frame types share a flags byte layout:
 *   Bits 7-6: compMode (same as MSG seed[0])
 *   Bits 5-0: frame discriminator (0x02 = signed, 0x03 = unsigned)
 *
 * BROADCAST_UNSIGNED: [flags:1][compressed:N][check:2]
 *   - XOR-fold checksum over flags||compressed (same algo as CONTACT)
 *   - 3 bytes overhead
 *
 * BROADCAST_SIGNED:   [flags:1][x25519_pub:32][ed25519_pub:32][compressed:N][ed25519_sig:64]
 *   - Ed25519 signature covers flags||x25519_pub||ed25519_pub||compressed
 *   - 129 bytes overhead
 */

import { concatU8 } from './utils';
import {
  BROADCAST_SIGNED_TAG,
  BROADCAST_UNSIGNED_TAG,
  contactCheckBytes,
} from './wire';
import { signData, verifySignature } from './sign';

// ── Flags byte helpers ───────────────────────────────────

/** Pack compMode and frame discriminator into a single flags byte. */
export function packFlags(compMode: number, tag: number): number {
  return ((compMode & 0x03) << 6) | (tag & 0x3F);
}

/** Extract compMode from flags byte. */
export function flagsCompMode(flags: number): number {
  return (flags >> 6) & 0x03;
}

/** Extract frame discriminator from flags byte. */
export function flagsTag(flags: number): number {
  return flags & 0x3F;
}

// ── Serialize ────────────────────────────────────────────

/**
 * Serialize an unsigned broadcast frame.
 * [flags:1][compressed:N][check:2]
 */
export function serializeBroadcastUnsigned(
  compressed: Uint8Array,
  compMode: number,
): Uint8Array {
  const flags = packFlags(compMode, BROADCAST_UNSIGNED_TAG);
  const body = concatU8(new Uint8Array([flags]), compressed);
  const [a, b] = contactCheckBytes(body);
  return concatU8(body, new Uint8Array([a, b]));
}

/**
 * Serialize a signed broadcast frame.
 * [flags:1][x25519_pub:32][ed25519_pub:32][compressed:N][ed25519_sig:64]
 */
export async function serializeBroadcastSigned(
  compressed: Uint8Array,
  compMode: number,
  x25519Pub: Uint8Array,
  ed25519Pub: Uint8Array,
  ed25519PrivateKey: CryptoKey,
): Promise<Uint8Array> {
  const flags = packFlags(compMode, BROADCAST_SIGNED_TAG);
  const data = concatU8(
    new Uint8Array([flags]),
    x25519Pub,
    ed25519Pub,
    compressed,
  );
  const signature = await signData(ed25519PrivateKey, data);
  return concatU8(data, signature);
}

// ── Parse ────────────────────────────────────────────────

export interface BroadcastUnsigned {
  compMode: number;
  compressed: Uint8Array;
}

export interface BroadcastSigned {
  compMode: number;
  x25519Pub: Uint8Array;
  ed25519Pub: Uint8Array;
  compressed: Uint8Array;
}

/** Minimum unsigned size: flags(1) + compressed(1) + check(2) = 4 bytes. */
const MIN_UNSIGNED_SIZE = 4;

/** Minimum signed size: flags(1) + x25519(32) + ed25519(32) + compressed(0) + sig(64) = 129 bytes. */
const MIN_SIGNED_SIZE = 129;

/**
 * Try to parse as BROADCAST_UNSIGNED.
 * Returns parsed frame or null if discriminator/checksum doesn't match.
 */
export function tryParseBroadcastUnsigned(data: Uint8Array): BroadcastUnsigned | null {
  if (data.length < MIN_UNSIGNED_SIZE) return null;
  if (flagsTag(data[0]) !== BROADCAST_UNSIGNED_TAG) return null;

  const body = data.slice(0, data.length - 2);
  const [a, b] = contactCheckBytes(body);
  if (data[data.length - 2] !== a || data[data.length - 1] !== b) return null;

  return {
    compMode: flagsCompMode(data[0]),
    compressed: body.slice(1),
  };
}

/**
 * Try to parse as BROADCAST_SIGNED.
 * Returns parsed frame or null if discriminator/signature doesn't match.
 */
export async function tryParseBroadcastSigned(data: Uint8Array): Promise<BroadcastSigned | null> {
  if (data.length < MIN_SIGNED_SIZE) return null;
  if (flagsTag(data[0]) !== BROADCAST_SIGNED_TAG) return null;

  const signedData = data.slice(0, data.length - 64);
  const signature = data.slice(data.length - 64);
  const ed25519Pub = signedData.slice(33, 65);

  const valid = await verifySignature(ed25519Pub, signature, signedData);
  if (!valid) return null;

  return {
    compMode: flagsCompMode(data[0]),
    x25519Pub: signedData.slice(1, 33),
    ed25519Pub,
    compressed: signedData.slice(65),
  };
}
