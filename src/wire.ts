/**
 * Wire format: serialize/deserialize message and contact token structures.
 *
 * Outer framing:
 *   Type 0x10 — encrypted message, no sender key (key exchange confirmed)
 *   Type 0x12 — encrypted message with ephemeral key (introduction / key exchange unconfirmed)
 *                Sender's real public key is INSIDE the encrypted envelope.
 *   Type 0x20 — contact token (unencrypted)
 */

import { concatU8 } from './utils';

export const MSG_STANDARD = 0x10;
export const MSG_INTRODUCTION = 0x12;
export const CONTACT_TOKEN = 0x20;

export interface WireMessage {
  type: typeof MSG_STANDARD;
  payload: Uint8Array; // [IV:12][ciphertext+tag]
}

export interface WireIntroduction {
  type: typeof MSG_INTRODUCTION;
  ephemeralPublicKey: Uint8Array; // 32 bytes — throwaway key, reveals nothing about sender
  payload: Uint8Array; // [IV:12][ciphertext(sender_pub:32 + compressed_message)]
}

export interface WireContactToken {
  type: typeof CONTACT_TOKEN;
  publicKey: Uint8Array; // 32 bytes
}

export type WireFrame = WireMessage | WireIntroduction | WireContactToken;

/** Serialize a wire frame to bytes. */
export function serializeWire(frame: WireFrame): Uint8Array {
  if (frame.type === CONTACT_TOKEN) {
    return concatU8(new Uint8Array([frame.type]), frame.publicKey);
  }
  if (frame.type === MSG_INTRODUCTION) {
    return concatU8(new Uint8Array([frame.type]), frame.ephemeralPublicKey, frame.payload);
  }
  // MSG_STANDARD
  return concatU8(new Uint8Array([frame.type]), frame.payload);
}

/** Deserialize bytes into a wire frame. Returns null if invalid. */
export function deserializeWire(data: Uint8Array): WireFrame | null {
  if (data.length < 2) return null;
  const type = data[0];

  if (type === CONTACT_TOKEN) {
    if (data.length !== 33) return null;
    return { type, publicKey: data.slice(1, 33) };
  }

  if (type === MSG_INTRODUCTION) {
    if (data.length < 46) return null; // 1 + 32 + 12 + at least 1
    return {
      type,
      ephemeralPublicKey: data.slice(1, 33),
      payload: data.slice(33),
    };
  }

  if (type === MSG_STANDARD) {
    if (data.length < 14) return null; // 1 + 12 + at least 1
    return { type, payload: data.slice(1) };
  }

  return null;
}
