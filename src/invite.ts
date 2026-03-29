/**
 * Invite token parsing and generation.
 *
 * Invite tokens are compact base64url representations of public keys,
 * used for sharing contact information via links, QR codes, or paste.
 * Pure logic — no DOM dependencies.
 */

import { base64urlToU8, u8toBase64url } from './utils';
import { contactCheckBytes, serializeContact } from './wire';

/**
 * Try to parse a base64url invite token. Returns the 32-byte public key or null.
 *
 * Accepts:
 * - 46-char base64url (32-byte key + 2 check bytes = 34 bytes)
 * - Full URL with hash fragment: https://any-domain.com/path#TOKEN
 */
export async function tryParseInviteToken(text: string): Promise<Uint8Array | null> {
  let clean = text.replace(/\s/g, '');
  const hashIdx = clean.indexOf('#');
  if (hashIdx !== -1) {
    clean = clean.slice(hashIdx + 1);
  }
  if (!/^[A-Za-z0-9_-]{43,46}$/.test(clean)) return null;

  try {
    const decoded = base64urlToU8(clean);
    if (decoded.length === 34) {
      const pub = decoded.slice(0, 32);
      const [a, b] = await contactCheckBytes(pub);
      if (decoded[32] === a && decoded[33] === b) return pub;
    }
  } catch {
    // Not valid base64
  }
  return null;
}

/** Generate a compact base64url invite token for sharing. */
export async function makeInviteToken(publicKey: Uint8Array): Promise<string> {
  const wire = await serializeContact(publicKey);
  return u8toBase64url(wire);
}
