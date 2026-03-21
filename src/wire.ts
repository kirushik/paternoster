/**
 * Wire format: serialize/deserialize message and contact token structures.
 *
 * Outer framing:
 *   Type 0x10 — encrypted message, no sender key
 *   Type 0x11 — encrypted message, with sender key
 *   Type 0x20 — contact token (unencrypted)
 */

import { concatU8 } from './utils';

export const MSG_NO_SENDER = 0x10;
export const MSG_WITH_SENDER = 0x11;
export const CONTACT_TOKEN = 0x20;

export interface WireMessage {
  type: typeof MSG_NO_SENDER | typeof MSG_WITH_SENDER;
  senderPublicKey?: Uint8Array; // 32 bytes, only for MSG_WITH_SENDER
  payload: Uint8Array; // [IV][ciphertext] — the encrypted compressed blob
}

export interface WireContactToken {
  type: typeof CONTACT_TOKEN;
  publicKey: Uint8Array; // 32 bytes
}

export type WireFrame = WireMessage | WireContactToken;

/** Serialize a wire frame to bytes. */
export function serializeWire(frame: WireFrame): Uint8Array {
  if (frame.type === CONTACT_TOKEN) {
    return concatU8(new Uint8Array([frame.type]), frame.publicKey);
  }
  if (frame.type === MSG_WITH_SENDER) {
    return concatU8(new Uint8Array([frame.type]), frame.senderPublicKey!, frame.payload);
  }
  // MSG_NO_SENDER
  return concatU8(new Uint8Array([frame.type]), frame.payload);
}

/** Deserialize bytes into a wire frame. Returns null if invalid. */
export function deserializeWire(data: Uint8Array): WireFrame | null {
  if (data.length < 2) return null;
  const type = data[0];

  if (type === CONTACT_TOKEN) {
    if (data.length < 33) return null;
    return { type, publicKey: data.slice(1, 33) };
  }

  if (type === MSG_WITH_SENDER) {
    if (data.length < 46) return null; // 1 + 32 + 12 + at least 1
    return {
      type,
      senderPublicKey: data.slice(1, 33),
      payload: data.slice(33),
    };
  }

  if (type === MSG_NO_SENDER) {
    if (data.length < 14) return null; // 1 + 12 + at least 1
    return { type, payload: data.slice(1) };
  }

  return null;
}
