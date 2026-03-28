/**
 * Broadcast wire format: public one-to-many messages.
 *
 * Flags byte layout:
 *   Bits 7-6: compMode (same as MSG seed[0])
 *   Bits 5-0: frame discriminator
 *
 * Fixed fields are placed at the TAIL so that the variable-length compressed
 * content leads the frame. This prevents repeatable first-token patterns in
 * steganographic output (the first few stego tokens would otherwise be
 * identical across all broadcasts from the same sender).
 *
 * BROADCAST_UNSIGNED (0x03): [compressed:N][flags:1][check:2]
 *   3 bytes overhead.
 *
 * BROADCAST_SIGNED (0x02): [compressed:N][flags:1][x25519_fp:2][xeddsa_sig:64]
 *   67 bytes overhead. XEdDSA signature with 2-byte sender fingerprint.
 *   Recipients who have the sender as a contact can verify; others just read.
 */

import { concatU8, sha256Bytes } from './utils';
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
  return sha256Bytes(x25519Pub, 2);
}

// ── Serialize ────────────────────────────────────────────

/** Serialize unsigned broadcast: [compressed:N][flags:1][check:2]. 3 bytes overhead. */
export async function serializeBroadcastUnsigned(
  compressed: Uint8Array,
  compMode: number,
): Promise<Uint8Array> {
  const flags = packFlags(compMode, BROADCAST_UNSIGNED_TAG);
  const body = concatU8(compressed, new Uint8Array([flags]));
  const [a, b] = await contactCheckBytes(body);
  return concatU8(body, new Uint8Array([a, b]));
}

/**
 * Serialize signed broadcast: [compressed:N][flags:1][fp:2][sig:64].
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
  const data = concatU8(compressed, new Uint8Array([flags]), fp);
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
  /** 'verified' = signature valid for known contact, 'failed' = fingerprint matched but sig bad, 'unverified' = no matching fingerprint */
  status: 'verified' | 'unverified' | 'failed';
  /** Set only when status === 'verified'. */
  x25519Pub?: Uint8Array;
}

const MIN_UNSIGNED_SIZE = 4;  // flags(1) + compressed(1) + check(2)
const MIN_SIGNED_SIZE = 67;   // flags(1) + fp(2) + compressed(0) + sig(64)

/** Try to parse as BROADCAST_UNSIGNED. Wire: [compressed:N][flags:1][check:2]. */
export async function tryParseBroadcastUnsigned(data: Uint8Array): Promise<BroadcastUnsigned | null> {
  if (data.length < MIN_UNSIGNED_SIZE) return null;
  const flagsPos = data.length - 3;
  if (flagsTag(data[flagsPos]) !== BROADCAST_UNSIGNED_TAG) return null;
  const body = data.slice(0, data.length - 2);
  const [a, b] = await contactCheckBytes(body);
  if (data[data.length - 2] !== a || data[data.length - 1] !== b) return null;
  return { compMode: flagsCompMode(data[flagsPos]), compressed: body.slice(0, body.length - 1) };
}

/**
 * Try to parse as BROADCAST_SIGNED.
 * Wire: [compressed:N][flags:1][fp:2][sig:64]. Flags at tail, 67 bytes from end.
 * Computes fingerprint for each candidate key and checks for a match, then verifies XEdDSA.
 */
export async function tryParseBroadcastSigned(
  data: Uint8Array,
  candidateKeys?: Uint8Array[],
): Promise<BroadcastSigned | null> {
  if (data.length < MIN_SIGNED_SIZE) return null;
  const flagsPos = data.length - 67;
  if (flagsTag(data[flagsPos]) !== BROADCAST_SIGNED_TAG) return null;

  const signedData = data.slice(0, data.length - 64);
  const signature = data.slice(data.length - 64);
  // signedData = [compressed:N][flags:1][fp:2]
  const fingerprint = signedData.slice(signedData.length - 2);
  const compressed = signedData.slice(0, signedData.length - 3);

  const base = { compMode: flagsCompMode(data[flagsPos]), fingerprint, compressed };

  // Try each candidate key: compute fingerprint, compare, verify signature.
  // Multiple candidates may share the same 2-byte fingerprint (collision-prone),
  // so we must try ALL matching candidates before concluding 'failed'.
  let sawMatchingFingerprint = false;
  if (candidateKeys) {
    for (const key of candidateKeys) {
      const fp = await pubFingerprint(key);
      if (fp[0] === fingerprint[0] && fp[1] === fingerprint[1]) {
        sawMatchingFingerprint = true;
        const valid = await xeddsaVerify(key, signature, signedData);
        if (valid) {
          return { ...base, status: 'verified' as const, x25519Pub: key };
        }
      }
    }
  }

  // At least one fingerprint matched but all verifications failed → potential forgery
  if (sawMatchingFingerprint) return { ...base, status: 'failed' as const };

  // No matching fingerprint among candidates (unknown sender)
  return { ...base, status: 'unverified' as const };
}
