/**
 * Frame classification: determine the type and contents of decoded stego bytes.
 *
 * Pure logic — no DOM, no global state. Used by main.ts for the auto-detection
 * pipeline, and directly testable in unit/integration tests.
 */

import { decrypt, decryptIntro, seedCompMode, CLASS_MSG } from './crypto';
import { decompress } from './compress';
import { couldBeMsg, couldBeIntro, splitIntro, tryParseContact } from './wire';
import {
  tryParseBroadcastSigned,
  tryParseBroadcastUnsigned,
} from './broadcast';
import { u8eq } from './utils';

// ── Known-key entry ──────────────────────────────────────

export interface KnownKey {
  name: string;
  key: Uint8Array;
  contactId?: string;
}

// ── Classification results (discriminated union) ─────────

export interface ClassifiedMsg {
  type: 'msg';
  plaintext: string;
  senderName: string;
  contactId?: string;
}

export interface ClassifiedIntro {
  type: 'intro';
  senderPub: Uint8Array;
  plaintext: string;
}

export interface ClassifiedBroadcastSigned {
  type: 'broadcast_signed';
  plaintext: string;
  status: 'verified' | 'unverified' | 'failed';
  fingerprint: Uint8Array;
  x25519Pub?: Uint8Array;
}

export interface ClassifiedBroadcastUnsigned {
  type: 'broadcast_unsigned';
  plaintext: string;
}

export interface ClassifiedContact {
  type: 'contact';
  publicKey: Uint8Array;
}

export interface ClassifiedUnknown {
  type: 'unknown';
}

export type ClassifiedFrame =
  | ClassifiedMsg
  | ClassifiedIntro
  | ClassifiedBroadcastSigned
  | ClassifiedBroadcastUnsigned
  | ClassifiedContact
  | ClassifiedUnknown;

// ── Classification (regular messaging mode) ──────────────

/**
 * Classify decoded stego bytes in regular messaging mode.
 *
 * Trial order: MSG → INTRO → BROADCAST_SIGNED → CONTACT → BROADCAST_UNSIGNED → unknown.
 * This order matters: MSG and INTRO are tried first because they use authenticated
 * encryption (GCM tag), making false positives negligible (~2^-64). CONTACT uses a
 * 2-byte check (1/65536 false positive). Broadcast unsigned is last because its
 * check is weakest.
 */
export async function classifyFrame(
  bytes: Uint8Array,
  myPrivateKey: Uint8Array,
  myPublicKey: Uint8Array,
  knownKeys: KnownKey[],
): Promise<ClassifiedFrame> {
  // 1. Try as MSG
  if (couldBeMsg(bytes)) {
    const keysToTry = buildKeyList(knownKeys, myPublicKey);
    for (const { name, key, contactId } of keysToTry) {
      try {
        const decrypted = await decrypt(bytes, myPrivateKey, key, key, myPublicKey, CLASS_MSG);
        const compMode = seedCompMode(bytes[0]);
        const plaintext = decompress(decrypted, compMode);
        return { type: 'msg', plaintext, senderName: name, contactId };
      } catch {
        // Auth failed — try next key
      }
    }
  }

  // 2. Try as INTRO
  if (couldBeIntro(bytes)) {
    try {
      const { ephPub, payload } = splitIntro(bytes);
      const decrypted = await decryptIntro(payload, myPrivateKey, ephPub, ephPub, myPublicKey);
      if (decrypted.length >= 33) {
        const compMode = decrypted[0];
        const senderPub = decrypted.slice(1, 33);
        const plaintext = decompress(decrypted.slice(33), compMode);
        return { type: 'intro', senderPub, plaintext };
      }
    } catch {
      // Not an intro
    }
  }

  // 3. Try as BROADCAST_SIGNED
  const candidateKeys = [myPublicKey, ...knownKeys.map(k => k.key)];
  const signed = await tryParseBroadcastSigned(bytes, candidateKeys);
  if (signed) {
    try {
      const plaintext = decompress(signed.compressed, signed.compMode);
      return {
        type: 'broadcast_signed',
        plaintext,
        status: signed.status,
        fingerprint: signed.fingerprint,
        x25519Pub: signed.x25519Pub,
      };
    } catch {
      // Decompression failed
    }
  }

  // 4. Try as CONTACT
  const contactPub = await tryParseContact(bytes);
  if (contactPub) {
    return { type: 'contact', publicKey: contactPub };
  }

  // 5. Try as BROADCAST_UNSIGNED
  const unsigned = await tryParseBroadcastUnsigned(bytes);
  if (unsigned) {
    try {
      const plaintext = decompress(unsigned.compressed, unsigned.compMode);
      return { type: 'broadcast_unsigned', plaintext };
    } catch {
      // Decompression failed
    }
  }

  return { type: 'unknown' };
}

// ── Classification (broadcast mode) ──────────────────────

/**
 * Classify decoded stego bytes in broadcast mode.
 *
 * Different priority: broadcasts first, then P2P frames.
 * Returns null if nothing recognized (caller should encode as broadcast).
 */
export async function classifyFrameBroadcastMode(
  bytes: Uint8Array,
  myPrivateKey: Uint8Array,
  myPublicKey: Uint8Array,
  knownKeys: KnownKey[],
): Promise<ClassifiedFrame | null> {
  // 1. Try as signed broadcast (stays in broadcast mode)
  const candidateKeys = [myPublicKey, ...knownKeys.map(k => k.key)];
  const signed = await tryParseBroadcastSigned(bytes, candidateKeys);
  if (signed) {
    try {
      const plaintext = decompress(signed.compressed, signed.compMode);
      return {
        type: 'broadcast_signed',
        plaintext,
        status: signed.status,
        fingerprint: signed.fingerprint,
        x25519Pub: signed.x25519Pub,
      };
    } catch { /* fall through */ }
  }

  // 2. Try as unsigned broadcast (stays in broadcast mode)
  const unsigned = await tryParseBroadcastUnsigned(bytes);
  if (unsigned) {
    try {
      const plaintext = decompress(unsigned.compressed, unsigned.compMode);
      return { type: 'broadcast_unsigned', plaintext };
    } catch { /* fall through */ }
  }

  // 3. Try as MSG (triggers exit from broadcast mode)
  if (couldBeMsg(bytes)) {
    const keysToTry = buildKeyList(knownKeys, myPublicKey);
    for (const { name, key, contactId } of keysToTry) {
      try {
        const decrypted = await decrypt(bytes, myPrivateKey, key, key, myPublicKey, CLASS_MSG);
        const compMode = seedCompMode(bytes[0]);
        const plaintext = decompress(decrypted, compMode);
        return { type: 'msg', plaintext, senderName: name, contactId };
      } catch {
        // Auth failed — try next key
      }
    }
  }

  // 4. Try as INTRO (triggers exit from broadcast mode)
  if (couldBeIntro(bytes)) {
    try {
      const { ephPub, payload } = splitIntro(bytes);
      const decrypted = await decryptIntro(payload, myPrivateKey, ephPub, ephPub, myPublicKey);
      if (decrypted.length >= 33) {
        const compMode = decrypted[0];
        const senderPub = decrypted.slice(1, 33);
        const plaintext = decompress(decrypted.slice(33), compMode);
        return { type: 'intro', senderPub, plaintext };
      }
    } catch { /* fall through */ }
  }

  // 5. Try as CONTACT (triggers exit from broadcast mode)
  const contactPub = await tryParseContact(bytes);
  if (contactPub) {
    return { type: 'contact', publicKey: contactPub };
  }

  return null;
}

// ── Helpers ──────────────────────────────────────────────

function buildKeyList(knownKeys: KnownKey[], myPublicKey: Uint8Array): KnownKey[] {
  const keys = [...knownKeys];
  if (!keys.some(k => u8eq(k.key, myPublicKey))) {
    keys.push({ name: 'Я', key: myPublicKey });
  }
  return keys;
}
