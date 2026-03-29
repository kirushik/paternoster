/**
 * Wire format: headerless frames. Every frame starts with random/variable bytes.
 *
 * Frame structures:
 *   MSG:                [seed:6][ciphertext][tag:8]           — seed[0] top 2 bits = comp mode
 *   INTRO:              [eph_pub:32][ciphertext][tag:8]       — no seed; ephemeral ECDH provides uniqueness
 *   CONTACT:            [pub:32][check:2]                     — check bytes at the END
 *   BROADCAST_UNSIGNED: [compressed:N][flags:1][check:2]      — fixed fields at tail
 *   BROADCAST_SIGNED:   [compressed:N][flags:1][fp:2][sig:64] — fixed fields at tail
 *
 * Frame type is determined by trial decryption (MSG/INTRO), tail flags (broadcasts),
 * or check bytes (CONTACT). See docs/crypto.md for full spec.
 */

import { concatU8, sha256WithDomain } from './utils';
import { SEED_LENGTH } from './crypto';

// ── Compression mode constants (2-bit values, stored in seed[0] bits 7-6) ──

export const COMP_LITERAL     = 0; // 0b00
export const COMP_SQUASH_SMAZ = 1; // 0b01
export const COMP_SQUASH_ONLY = 2; // 0b10
// 3 = reserved

// ── Broadcast frame discriminators (6-bit values, stored in flags byte bits 5-0) ──

export const BROADCAST_SIGNED_TAG   = 0x02; // 2-byte fingerprint + XEdDSA sig (67 bytes overhead)
export const BROADCAST_UNSIGNED_TAG = 0x03;

// ── CONTACT check byte ─────────────────────────────────

const CHECK_DOMAIN = new TextEncoder().encode('paternoster-check-v2');

/** Compute 2 check bytes via truncated SHA-256. 1/65536 false positive rate. */
export async function contactCheckBytes(data: Uint8Array): Promise<[number, number]> {
  const bytes = await sha256WithDomain(data, CHECK_DOMAIN, 2);
  return [bytes[0], bytes[1]];
}

// ── Serialize ───────────────────────────────────────────

/** Serialize a MSG frame: just the raw encrypted payload (seed + ciphertext + tag). */
export function serializeMsg(payload: Uint8Array): Uint8Array {
  return payload;
}

/** Serialize an INTRO frame: eph_pub + encrypted payload. */
export function serializeIntro(ephemeralPublicKey: Uint8Array, payload: Uint8Array): Uint8Array {
  return concatU8(ephemeralPublicKey, payload);
}

/** Serialize a CONTACT frame: pub + 2 check bytes at the end. */
export async function serializeContact(publicKey: Uint8Array): Promise<Uint8Array> {
  const [a, b] = await contactCheckBytes(publicKey);
  return concatU8(publicKey, new Uint8Array([a, b]));
}

// ── Parse helpers (no type detection — caller tries each) ──

/** Minimum MSG size: seed(6) + ciphertext(1) + tag(8) = 15 bytes. */
const MIN_MSG_SIZE = SEED_LENGTH + 1 + 8;

/** Minimum INTRO size: eph_pub(32) + ciphertext(1) + tag(8) = 41 bytes. No seed — ephemeral ECDH provides uniqueness. */
const MIN_INTRO_SIZE = 32 + 1 + 8;

/** Check if data could be a MSG frame (length check only). */
export function couldBeMsg(data: Uint8Array): boolean {
  return data.length >= MIN_MSG_SIZE;
}

/** Check if data could be an INTRO frame (length check only). */
export function couldBeIntro(data: Uint8Array): boolean {
  return data.length >= MIN_INTRO_SIZE;
}

/** Try to parse as CONTACT. Returns the 32-byte public key or null. */
export async function tryParseContact(data: Uint8Array): Promise<Uint8Array | null> {
  if (data.length !== 34) return null;
  const pub = data.slice(0, 32);
  const [a, b] = await contactCheckBytes(pub);
  if (data[32] !== a || data[33] !== b) return null;
  return pub;
}

/** Split INTRO bytes: first 32 = eph_pub, rest = encrypted payload (ciphertext + tag). */
export function splitIntro(data: Uint8Array): { ephPub: Uint8Array; payload: Uint8Array } {
  return {
    ephPub: data.slice(0, 32),
    payload: data.slice(32),
  };
}
