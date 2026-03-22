import { describe, it, expect } from 'vitest';
import { u8toBase64url, base64urlToU8 } from '../../src/utils';
import { serializeContact, contactCheckBytes } from '../../src/wire';
import { generateKeyPair } from '../../src/crypto';

// Reproduce tryParseInviteToken logic (main.ts has DOM deps)
function tryParseInviteToken(text: string): Uint8Array | null {
  let clean = text.replace(/\s/g, '');
  const hashIdx = clean.indexOf('#');
  if (hashIdx !== -1) clean = clean.slice(hashIdx + 1);
  if (!/^[A-Za-z0-9_-]{43,46}$/.test(clean)) return null;
  try {
    const decoded = base64urlToU8(clean);
    if (decoded.length === 34) {
      const pub = decoded.slice(0, 32);
      const [a, b] = contactCheckBytes(pub);
      if (decoded[32] === a && decoded[33] === b) return pub;
    }
    if (decoded.length === 32) return decoded;
  } catch { /* not valid base64 */ }
  return null;
}

function makeInviteToken(publicKey: Uint8Array): string {
  return u8toBase64url(serializeContact(publicKey));
}

describe('invite token roundtrip', () => {
  it('generates and parses 46-char token', async () => {
    const { publicKey } = await generateKeyPair();
    const token = makeInviteToken(publicKey);
    expect(token.length).toBe(46); // 34 bytes → 46 base64url chars
    expect(tryParseInviteToken(token)).toEqual(publicKey);
  });

  it('parses raw 32-byte base64url (43 chars)', async () => {
    const { publicKey } = await generateKeyPair();
    const raw43 = u8toBase64url(publicKey);
    expect(raw43.length).toBe(43);
    expect(tryParseInviteToken(raw43)).toEqual(publicKey);
  });
});

describe('invite token validation', () => {
  it('rejects too-short input', () => {
    expect(tryParseInviteToken('abc')).toBeNull();
    expect(tryParseInviteToken('ABCDEF1234567890')).toBeNull();
  });

  it('rejects too-long input', () => {
    expect(tryParseInviteToken('A'.repeat(50))).toBeNull();
  });

  it('rejects non-base64url chars', () => {
    expect(tryParseInviteToken('A'.repeat(43) + '!')).toBeNull();
  });

  it('rejects 46 chars that decode to wrong check bytes', () => {
    const wrong = new Uint8Array(34);
    wrong[32] = 0xFF;
    wrong[33] = 0xFF;
    expect(tryParseInviteToken(u8toBase64url(wrong))).toBeNull();
  });
});

describe('invite link URL parsing', () => {
  it('extracts token from HTTPS URL with hash', async () => {
    const { publicKey } = await generateKeyPair();
    const token = makeInviteToken(publicKey);
    expect(tryParseInviteToken(`https://example.com/#${token}`)).toEqual(publicKey);
  });

  it('extracts token from file:// URL', async () => {
    const { publicKey } = await generateKeyPair();
    const token = makeInviteToken(publicKey);
    expect(tryParseInviteToken(`file:///home/user/app.html#${token}`)).toEqual(publicKey);
  });

  it('extracts token from bare hash fragment', async () => {
    const { publicKey } = await generateKeyPair();
    const token = makeInviteToken(publicKey);
    expect(tryParseInviteToken(`#${token}`)).toEqual(publicKey);
  });

  it('rejects URL with invalid hash content', () => {
    expect(tryParseInviteToken('https://example.com/#tooshort')).toBeNull();
  });
});
