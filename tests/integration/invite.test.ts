import { describe, it, expect } from 'vitest';
import { u8toBase64url, base64urlToU8 } from '../../src/utils';
import { serializeWire, CONTACT_TOKEN } from '../../src/wire';
import { generateKeyPair } from '../../src/crypto';

// Reproduce tryParseInviteToken logic (it's in main.ts which has DOM deps, so we test the logic directly)
function tryParseInviteToken(text: string): Uint8Array | null {
  const clean = text.replace(/\s/g, '');
  if (!/^[A-Za-z0-9_-]{43,44}$/.test(clean)) return null;
  try {
    const decoded = base64urlToU8(clean);
    if (decoded.length === 33 && decoded[0] === 0x20) return decoded.slice(1);
    if (decoded.length === 32) return decoded;
  } catch {
    // not valid base64
  }
  return null;
}

function makeInviteToken(publicKey: Uint8Array): string {
  const wire = serializeWire({ type: CONTACT_TOKEN, publicKey });
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
    // 'A'.repeat(43) + ' ' → strip space → 43 valid chars → parses as 32-byte key
    const result = tryParseInviteToken('A'.repeat(43) + ' ');
    expect(result).not.toBeNull(); // this is correct behavior: whitespace is stripped
  });

  it('rejects 44 chars that decode to wrong type byte', () => {
    const wrongType = new Uint8Array(33);
    wrongType[0] = 0xFF; // not CONTACT_TOKEN (0x20)
    const token = u8toBase64url(wrongType);
    expect(tryParseInviteToken(token)).toBeNull();
  });
});

describe('invite token in URL hash', () => {
  it('token extracted from hash fragment', async () => {
    const { publicKey } = await generateKeyPair();
    const token = makeInviteToken(publicKey);
    const hash = '#' + token;
    const fromHash = hash.slice(1); // remove '#'
    const parsed = tryParseInviteToken(fromHash);
    expect(parsed).toEqual(publicKey);
  });
});
