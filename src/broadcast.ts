/**
 * Broadcast wire format: public one-to-many messages.
 *
 * Flags byte layout:
 *   Bits 7-6: compMode (same as MSG seed[0])
 *   Bits 5-0: frame discriminator
 *
 * BROADCAST_UNSIGNED (0x03): [flags:1][compressed:N][check:2]
 *   3 bytes overhead.
 *
 * BROADCAST_SIGNED (0x02): [flags:1][x25519_fp:2][compressed:N][xeddsa_sig:64]
 *   67 bytes overhead. XEdDSA signature with 2-byte sender fingerprint.
 *   Recipients who have the sender as a contact can verify; others just read.
 */

import { concatU8 } from './utils';
import {
  BROADCAST_SIGNED_TAG,
  BROADCAST_UNSIGNED_TAG,
  contactCheckBytes,
} from './wire';
import { xeddsaSign, xeddsaVerify } from './sign';

// ── Flags byte helpers ───────────────────────────────────

export function packFlags(compMode: number, tag: number): number {
  return ((compMode & 0x03) << 6) | (tag & 0x3F);
}

export function flagsCompMode(flags: number): number {
  return (flags >> 6) & 0x03;
}

export function flagsTag(flags: number): number {
  return flags & 0x3F;
}

// ── Fingerprint ──────────────────────────────────────────

/** 2-byte fingerprint: first 2 bytes of SHA-256(x25519_pub). */
export async function pubFingerprint(x25519Pub: Uint8Array): Promise<Uint8Array> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', x25519Pub as BufferSource));
  return hash.slice(0, 2);
}

// ── Serialize ────────────────────────────────────────────

/** Serialize unsigned broadcast: [flags:1][compressed:N][check:2]. 3 bytes overhead. */
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
 * Serialize signed broadcast: [flags:1][fp:2][compressed:N][sig:64].
 * 67 bytes overhead. XEdDSA — signs with X25519 key directly.
 * 2-byte fingerprint for sender identification by recipients who have the contact.
 */
export async function serializeBroadcastSigned(
  compressed: Uint8Array,
  compMode: number,
  x25519Pub: Uint8Array,
  x25519Priv: Uint8Array,
): Promise<Uint8Array> {
  const flags = packFlags(compMode, BROADCAST_SIGNED_TAG);
  const fp = await pubFingerprint(x25519Pub);
  const data = concatU8(new Uint8Array([flags]), fp, compressed);
  const signature = await xeddsaSign(x25519Priv, data);
  return concatU8(data, signature);
}

// ── Parse ────────────────────────────────────────────────

export interface BroadcastUnsigned {
  compMode: number;
  compressed: Uint8Array;
}

export interface BroadcastSigned {
  compMode: number;
  fingerprint: Uint8Array;
  compressed: Uint8Array;
  /** Set after fingerprint lookup resolves the sender. */
  x25519Pub?: Uint8Array;
}

const MIN_UNSIGNED_SIZE = 4;  // flags(1) + compressed(1) + check(2)
const MIN_SIGNED_SIZE = 67;   // flags(1) + fp(2) + compressed(0) + sig(64)

/** Try to parse as BROADCAST_UNSIGNED. */
export function tryParseBroadcastUnsigned(data: Uint8Array): BroadcastUnsigned | null {
  if (data.length < MIN_UNSIGNED_SIZE) return null;
  if (flagsTag(data[0]) !== BROADCAST_UNSIGNED_TAG) return null;
  const body = data.slice(0, data.length - 2);
  const [a, b] = contactCheckBytes(body);
  if (data[data.length - 2] !== a || data[data.length - 1] !== b) return null;
  return { compMode: flagsCompMode(data[0]), compressed: body.slice(1) };
}

/**
 * Try to parse as BROADCAST_SIGNED.
 * Uses fingerprint to look up sender, then verifies XEdDSA signature.
 */
export async function tryParseBroadcastSigned(
  data: Uint8Array,
  lookupByFingerprint?: (fp: Uint8Array) => Uint8Array | null,
): Promise<BroadcastSigned | null> {
  if (data.length < MIN_SIGNED_SIZE) return null;
  if (flagsTag(data[0]) !== BROADCAST_SIGNED_TAG) return null;

  const signedData = data.slice(0, data.length - 64);
  const signature = data.slice(data.length - 64);
  const fingerprint = signedData.slice(1, 3);
  const compressed = signedData.slice(3);

  // If we have a lookup function, try to find and verify the sender
  if (lookupByFingerprint) {
    const x25519Pub = lookupByFingerprint(fingerprint);
    if (x25519Pub) {
      const valid = await xeddsaVerify(x25519Pub, signature, signedData);
      if (valid) {
        return { compMode: flagsCompMode(data[0]), fingerprint, compressed, x25519Pub };
      }
    }
  }

  // No lookup or fingerprint didn't match — return as unverified signed broadcast
  return { compMode: flagsCompMode(data[0]), fingerprint, compressed };
}
