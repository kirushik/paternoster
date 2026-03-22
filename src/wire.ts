/**
 * Wire format: headerless frames. Every frame starts with random bytes.
 *
 * Frame structures:
 *   MSG:     [seed:6][ciphertext][tag:12]          — seed[0] top 2 bits = comp mode
 *   INTRO:   [eph_pub:32][seed:6][ciphertext][tag:12] — seed at byte 32
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

/** Compute the check byte for a CONTACT frame. XOR-fold with salt. */
export function contactCheckByte(pub: Uint8Array): number {
  let check = 0x5A; // salt to avoid check=0 for zero key
  for (let i = 0; i < pub.length; i++) check ^= pub[i];
  return check;
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

/** Serialize a CONTACT frame: pub + check byte at the end. */
export function serializeContact(publicKey: Uint8Array): Uint8Array {
  return concatU8(publicKey, new Uint8Array([contactCheckByte(publicKey)]));
}

// ── Parse helpers (no type detection — caller tries each) ──

/** Minimum MSG size: seed(6) + ciphertext(1) + tag(12) = 19 bytes. */
const MIN_MSG_SIZE = SEED_LENGTH + 1 + 12;

/** Minimum INTRO size: eph_pub(32) + seed(6) + ciphertext(1) + tag(12) = 51 bytes. */
const MIN_INTRO_SIZE = 32 + SEED_LENGTH + 1 + 12;

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
  if (data.length !== 33) return null;
  const pub = data.slice(0, 32);
  if (data[32] !== contactCheckByte(pub)) return null;
  return pub;
}

/** Split INTRO bytes: first 32 = eph_pub, rest = encrypted payload (seed + ciphertext + tag). */
export function splitIntro(data: Uint8Array): { ephPub: Uint8Array; payload: Uint8Array } {
  return {
    ephPub: data.slice(0, 32),
    payload: data.slice(32),
  };
}
