/**
 * Wire format: serialize/deserialize message and contact token structures.
 *
 * Unified header byte: VV CC MM FF
 *   VV = version (01), CC = class, MM = compression, FF = flags
 *   See docs/crypto.md for full spec.
 *
 * Frame structures:
 *   MSG:     [H:1][seed:6][ciphertext][tag:12]
 *   INTRO:   [H:1][eph_pub:32][seed:6][ciphertext(sender_pub:32 + payload)][tag:12]
 *   CONTACT: [H:1][pubkey:32]
 */

import { concatU8 } from './utils';
import { SEED_LENGTH } from './crypto';

// ── Header byte layout ──────────────────────────────────
// Bits: VV CC MM FF

// Version (top 2 bits)
const VERSION = 0b01_00_00_00; // 0x40

// Class (bits 5-4)
export const CLASS_CONTACT = 0b00_00_00_00;
export const CLASS_INTRO   = 0b00_01_00_00; // 0x10
export const CLASS_MSG     = 0b00_10_00_00; // 0x20

// Compression (bits 3-2)
export const COMP_LITERAL     = 0b00_00_00_00;
export const COMP_SQUASH_SMAZ = 0b00_00_01_00; // 0x04
export const COMP_SQUASH_ONLY = 0b00_00_10_00; // 0x08 — squash (CP1251) without smaz
// 0b00_00_11_00 reserved for future (e.g., tinyphrase)

// Masks for parsing
const VERSION_MASK = 0b11_00_00_00;
const CLASS_MASK   = 0b00_11_00_00;
const COMP_MASK    = 0b00_00_11_00;

/** Build a header byte from class and compression mode. */
export function makeHeader(classVal: number, compVal: number): number {
  return VERSION | classVal | compVal;
}

/** Extract class from header. */
export function headerClass(header: number): number {
  return header & CLASS_MASK;
}

/** Extract compression mode from header. */
export function headerComp(header: number): number {
  return header & COMP_MASK;
}

// ── Interfaces ──────────────────────────────────────────

export interface WireMessage {
  header: number;
  payload: Uint8Array; // [seed:6][ciphertext+96-bit tag]
}

export interface WireIntroduction {
  header: number;
  ephemeralPublicKey: Uint8Array; // 32 bytes
  payload: Uint8Array;            // [seed:6][ciphertext(sender_pub:32 + compressed)+96-bit tag]
}

export interface WireContactToken {
  header: number;
  publicKey: Uint8Array; // 32 bytes
}

export type WireFrame = WireMessage | WireIntroduction | WireContactToken;

// ── Serialize ───────────────────────────────────────────

/** Serialize a wire frame to bytes. */
export function serializeWire(frame: WireFrame): Uint8Array {
  if ('publicKey' in frame) {
    return concatU8(new Uint8Array([frame.header]), frame.publicKey);
  }
  if ('ephemeralPublicKey' in frame) {
    return concatU8(new Uint8Array([frame.header]), frame.ephemeralPublicKey, frame.payload);
  }
  // MSG
  return concatU8(new Uint8Array([frame.header]), frame.payload);
}

// ── Deserialize ─────────────────────────────────────────

/** Deserialize bytes into a wire frame. Returns null if invalid. */
export function deserializeWire(data: Uint8Array): WireFrame | null {
  if (data.length < 2) return null;
  const header = data[0];

  // Check version bits
  if ((header & VERSION_MASK) !== VERSION) return null;

  const cls = header & CLASS_MASK;

  if (cls === CLASS_CONTACT) {
    if (data.length !== 33) return null;
    return { header, publicKey: data.slice(1, 33) };
  }

  if (cls === CLASS_INTRO) {
    // H:1 + eph_pub:32 + seed:6 + at least 1 byte ciphertext + tag:12
    if (data.length < 1 + 32 + SEED_LENGTH + 1 + 12) return null;
    return {
      header,
      ephemeralPublicKey: data.slice(1, 33),
      payload: data.slice(33),
    };
  }

  if (cls === CLASS_MSG) {
    // H:1 + seed:6 + at least 1 byte ciphertext + tag:12
    if (data.length < 1 + SEED_LENGTH + 1 + 12) return null;
    return { header, payload: data.slice(1) };
  }

  return null;
}
