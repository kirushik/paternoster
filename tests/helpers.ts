/**
 * Shared test utilities for frame construction and common setup.
 *
 * Consolidates helpers that were duplicated across detect.test.ts,
 * conversation-protocol.test.ts, pipeline.test.ts, and others.
 */

import {
  generateKeyPair,
  encrypt,
  encryptIntro,
  CLASS_MSG,
} from '../src/crypto';
import { compress } from '../src/compress';
import {
  serializeMsg,
  serializeIntro,
} from '../src/wire';
import { concatU8 } from '../src/utils';
import { THEMES, type ThemeId } from '../src/dictionaries';

/** All theme IDs — use this instead of hardcoding the list. */
export const ALL_THEME_IDS: ThemeId[] = THEMES.map(t => t.id);

/** Keypair type returned by generateKeyPair(). */
export interface Identity {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

/** Create a MSG wire frame (compress → encrypt → serialize). */
export async function makeMsgFrame(
  senderPriv: Uint8Array, senderPub: Uint8Array,
  recipientPub: Uint8Array, plaintext: string,
): Promise<Uint8Array> {
  const { payload, compMode } = compress(plaintext);
  const encrypted = await encrypt(payload, senderPriv, recipientPub, senderPub, recipientPub, CLASS_MSG, compMode);
  return serializeMsg(encrypted);
}

/** Create an INTRO wire frame (compress → ephemeral ECDH → encrypt → serialize). */
export async function makeIntroFrame(
  senderPub: Uint8Array, recipientPub: Uint8Array, plaintext: string,
): Promise<Uint8Array> {
  const { payload, compMode } = compress(plaintext);
  const eph = await generateKeyPair();
  const introPayload = concatU8(new Uint8Array([compMode]), senderPub, payload);
  const encrypted = await encryptIntro(introPayload, eph.privateKey, recipientPub, eph.publicKey, recipientPub);
  return serializeIntro(eph.publicKey, encrypted);
}
