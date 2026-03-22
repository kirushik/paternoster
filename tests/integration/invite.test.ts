import { describe, it, expect } from 'vitest';
import { u8toBase64url, base64urlToU8 } from '../../src/utils';
import { serializeContact, contactCheckByte } from '../../src/wire';
import { generateKeyPair } from '../../src/crypto';

// Reproduce tryParseInviteToken logic (main.ts has DOM deps, so we test directly)
function tryParseInviteToken(text: string): Uint8Array | null {
  let clean = text.replace(/\s/g, '');
  const hashIdx = clean.indexOf('#');
  if (hashIdx !== -1) {
    clean = clean.slice(hashIdx + 1);
  }
  if (!/^[A-Za-z0-9_-]{43,44}$/.test(clean)) return null;
  try {
    const decoded = base64urlToU8(clean);
    // CONTACT: [pub:32][check:1] — check byte at the END
    if (decoded.length === 33 && decoded[32] === contactCheckByte(decoded.slice(0, 32))) {
      return decoded.slice(0, 32);
    }
    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // not valid base64
  }
  return null;
}

function makeInviteToken(publicKey: Uint8Array): string {
  const wire = serializeContact(publicKey);
  return u8toBase64url(wire);
}

describe('invite token roundtrip', () => {
  it('generates and parses 44-char token', async () => {
    const { publicKey } = await generateKeyPair();
    const token = makeInviteToken(publicKey);
    expect(token.length).toBe(44);

    const parsed = tryParseInviteToken(token);
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(publicKey);
  });

  it('parses raw 32-byte base64url (43 chars)', async () => {
    const { publicKey } = await generateKeyPair();
    const raw43 = u8toBase64url(publicKey);
    expect(raw43.length).toBe(43);

    const parsed = tryParseInviteToken(raw43);
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(publicKey);
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
    expect(tryParseInviteToken('A'.repeat(42) + '!!')).toBeNull();
  });

  it('space-stripped input that becomes valid length is accepted', () => {
    const result = tryParseInviteToken('A'.repeat(43) + ' ');
    expect(result).not.toBeNull();
  });

  it('rejects 44 chars that decode to wrong check byte', () => {
    const wrongCheck = new Uint8Array(33);
    wrongCheck[32] = 0xFF; // wrong check byte for all-zero key
    const token = u8toBase64url(wrongCheck);
    expect(tryParseInviteToken(token)).toBeNull();
  });
});

describe('invite link URL parsing', () => {
  it('extracts token from full HTTPS URL with hash', async () => {
    const { publicKey } = await generateKeyPair();
    const token = makeInviteToken(publicKey);
    const url = `https://example.com/paternoster/#${token}`;
    expect(tryParseInviteToken(url)).toEqual(publicKey);
  });

  it('extracts token from different domain', async () => {
    const { publicKey } = await generateKeyPair();
    const token = makeInviteToken(publicKey);
    const url = `https://some-other-site.org/app#${token}`;
    expect(tryParseInviteToken(url)).toEqual(publicKey);
  });

  it('extracts token from file:// URL', async () => {
    const { publicKey } = await generateKeyPair();
    const token = makeInviteToken(publicKey);
    const url = `file:///home/user/paternoster.html#${token}`;
    expect(tryParseInviteToken(url)).toEqual(publicKey);
  });

  it('extracts token from bare hash fragment', async () => {
    const { publicKey } = await generateKeyPair();
    const token = makeInviteToken(publicKey);
    expect(tryParseInviteToken(`#${token}`)).toEqual(publicKey);
  });

  it('rejects URL with invalid hash content', () => {
    expect(tryParseInviteToken('https://example.com/#tooshort')).toBeNull();
  });

  it('rejects URL with no hash', () => {
    expect(tryParseInviteToken('https://example.com/page')).toBeNull();
  });

  it('rejects URL with empty hash', () => {
    expect(tryParseInviteToken('https://example.com/#')).toBeNull();
  });
});
