/**
 * Wire format: headerless frames. Every frame starts with random bytes.
 *
 * Frame structures:
 *   MSG:     [seed:6][ciphertext][tag:8]           — seed[0] top 2 bits = comp mode
 *   INTRO:   [eph_pub:32][ciphertext][tag:8]     — no seed; ephemeral ECDH provides uniqueness
 *   CONTACT: [pub:32][check:1]                     — check byte at the END
 *
 * Frame type is determined by trial decryption (MSG/INTRO) or check byte (CONTACT).
 * See docs/crypto.md for full spec.
 */

import { concatU8 } from './utils';
import { SEED_LENGTH } from './crypto';

// ── Compression mode constants (2-bit values, stored in seed[0] bits 7-6) ──

export const COMP_LITERAL     = 0; // 0b00
export const COMP_SQUASH_SMAZ = 1; // 0b01
export const COMP_SQUASH_ONLY = 2; // 0b10
// 3 = reserved

// ── CONTACT check byte ─────────────────────────────────

/** Compute 2 check bytes for a CONTACT frame. 1/65536 false positive rate. */
export function contactCheckBytes(pub: Uint8Array): [number, number] {
  let a = 0x5A, b = 0xA5;
  for (let i = 0; i < pub.length; i++) {
    a ^= pub[i];
    b ^= pub[i] ^ (i & 0xFF);
  }
  return [a, b];
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
export function serializeContact(publicKey: Uint8Array): Uint8Array {
  const [a, b] = contactCheckBytes(publicKey);
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
export function tryParseContact(data: Uint8Array): Uint8Array | null {
  if (data.length !== 34) return null;
  const pub = data.slice(0, 32);
  const [a, b] = contactCheckBytes(pub);
  if (data[32] !== a || data[33] !== b) return null;
  return pub;
}

/** Split INTRO bytes: first 32 = eph_pub, rest = encrypted payload (seed + ciphertext + tag). */
export function splitIntro(data: Uint8Array): { ephPub: Uint8Array; payload: Uint8Array } {
  return {
    ephPub: data.slice(0, 32),
    payload: data.slice(32),
  };
}
