/**
 * Property-based tests: verify invariants hold for arbitrary inputs.
 *
 * Uses fast-check to generate thousands of random inputs per property,
 * catching edge cases that hand-picked test data misses.
 */
import { describe, it, expect } from 'vitest';
import { test as fcTest, fc } from '@fast-check/vitest';

import { u8hex, hexU8, u8toBase64url, base64urlToU8, concatU8, u8eq } from '../../src/utils';
import { squashEncode, squashDecode } from '../../src/squash';
import { smazCyrillic } from '../../src/smaz';
import { compress, decompress } from '../../src/compress';
import { stegoEncode, stegoDecode } from '../../src/stego';
import { type ThemeId, THEMES } from '../../src/dictionaries';
import {
  serializeMsg, serializeIntro, serializeContact,
  couldBeMsg, couldBeIntro, tryParseContact, splitIntro,
  contactCheckBytes,
} from '../../src/wire';
import {
  generateKeyPair, encrypt, decrypt, encryptIntro, decryptIntro,
  CLASS_MSG, seedCompMode,
} from '../../src/crypto';

// ── Utility roundtrips ────────────────────────────────────

describe('property: hex roundtrip', () => {
  fcTest.prop([fc.uint8Array({ minLength: 0, maxLength: 256 })])(
    'hexU8(u8hex(bytes)) === bytes',
    (bytes) => {
      expect(hexU8(u8hex(bytes))).toEqual(bytes);
    },
  );
});

describe('property: base64url roundtrip', () => {
  fcTest.prop([fc.uint8Array({ minLength: 0, maxLength: 256 })])(
    'base64urlToU8(u8toBase64url(bytes)) === bytes',
    (bytes) => {
      expect(base64urlToU8(u8toBase64url(bytes))).toEqual(bytes);
    },
  );
});

describe('property: concatU8', () => {
  fcTest.prop([
    fc.uint8Array({ minLength: 0, maxLength: 64 }),
    fc.uint8Array({ minLength: 0, maxLength: 64 }),
    fc.uint8Array({ minLength: 0, maxLength: 64 }),
  ])(
    'concat preserves all bytes in order',
    (a, b, c) => {
      const result = concatU8(a, b, c);
      expect(result.length).toBe(a.length + b.length + c.length);
      expect(result.slice(0, a.length)).toEqual(a);
      expect(result.slice(a.length, a.length + b.length)).toEqual(b);
      expect(result.slice(a.length + b.length)).toEqual(c);
    },
  );
});

describe('property: u8eq', () => {
  fcTest.prop([fc.uint8Array({ minLength: 0, maxLength: 128 })])(
    'u8eq(a, a) is always true',
    (a) => {
      expect(u8eq(a, a)).toBe(true);
      expect(u8eq(a, new Uint8Array(a))).toBe(true);
    },
  );
});

// ── Compression roundtrips ──────────────────────────────────

describe('property: squash roundtrip', () => {
  // Generate CP1251-safe strings: ASCII + Cyrillic
  const cp1251String = fc.array(
    fc.oneof(
      fc.integer({ min: 0x20, max: 0x7e }).map(c => String.fromCharCode(c)),
      fc.integer({ min: 0x0410, max: 0x044F }).map(c => String.fromCharCode(c)),
    ),
    { minLength: 0, maxLength: 200 },
  ).map(chars => chars.join(''));

  fcTest.prop([cp1251String])(
    'squashDecode(squashEncode(text)) === text for CP1251-representable strings',
    (text) => {
      expect(squashDecode(squashEncode(text))).toBe(text);
    },
  );
});

describe('property: smaz roundtrip', () => {
  fcTest.prop([fc.uint8Array({ minLength: 0, maxLength: 300 })])(
    'decompress(compress(bytes)) === bytes',
    (bytes) => {
      const compressed = smazCyrillic.compress(bytes);
      expect(smazCyrillic.decompress(compressed)).toEqual(bytes);
    },
  );
});

describe('property: compress/decompress roundtrip', () => {
  // Generate strings that could be real messages (mix of ASCII, Cyrillic, emoji)
  const messageString = fc.array(
    fc.oneof(
      fc.integer({ min: 0x20, max: 0x7e }).map(c => String.fromCharCode(c)),
      fc.integer({ min: 0x0410, max: 0x044F }).map(c => String.fromCharCode(c)),
      fc.constantFrom('😀', '❤️', '🌧️', '☀️', '🎉'),
    ),
    { minLength: 0, maxLength: 300 },
  ).map(chars => chars.join(''));

  fcTest.prop([messageString])(
    'decompress(compress(text)) === text',
    (text) => {
      const { payload, compMode } = compress(text);
      expect(decompress(payload, compMode)).toBe(text);
    },
  );
});

// ── Stego roundtrips ─────────────────────────────────────────

// Model-16 themes have tighter limits; keep payloads small enough to encode
const THEME_MAX_BYTES: Record<ThemeId, number> = {
  'БОЖЕ': 200,
  'РОССИЯ': 100,
  'СССР': 100,
  'БУХАЮ': 100,
  'TRUMP': 100,
  'КИТАЙ': 200,
  'PATER': 200,
  '🙂': 200,
  'hex': 500,
};

for (const theme of THEMES) {
  const maxLen = THEME_MAX_BYTES[theme.id];

  describe(`property: stego roundtrip [${theme.id}]`, () => {
    fcTest.prop([fc.uint8Array({ minLength: 1, maxLength: maxLen })])(
      'stegoDecode(stegoEncode(bytes)) === bytes',
      (bytes) => {
        const encoded = stegoEncode(bytes, theme.id);
        const decoded = stegoDecode(encoded);
        expect(decoded).not.toBeNull();
        expect(decoded!.bytes).toEqual(bytes);
      },
    );
  });
}

// ── Wire format roundtrips ──────────────────────────────────

describe('property: wire MSG roundtrip', () => {
  fcTest.prop([fc.uint8Array({ minLength: 15, maxLength: 200 })])(
    'serializeMsg preserves payload identity',
    (payload) => {
      const wire = serializeMsg(payload);
      expect(wire).toEqual(payload);
      expect(couldBeMsg(wire)).toBe(true);
    },
  );
});

describe('property: wire INTRO roundtrip', () => {
  fcTest.prop([
    fc.uint8Array({ minLength: 32, maxLength: 32 }),  // ephPub
    fc.uint8Array({ minLength: 9, maxLength: 200 }),   // payload (min: ciphertext(1) + tag(8))
  ])(
    'splitIntro(serializeIntro(ephPub, payload)) recovers both parts',
    (ephPub, payload) => {
      const wire = serializeIntro(ephPub, payload);
      expect(couldBeIntro(wire)).toBe(true);
      const { ephPub: recoveredPub, payload: recoveredPayload } = splitIntro(wire);
      expect(recoveredPub).toEqual(ephPub);
      expect(recoveredPayload).toEqual(payload);
    },
  );
});

describe('property: wire CONTACT roundtrip', () => {
  fcTest.prop([fc.uint8Array({ minLength: 32, maxLength: 32 })])(
    'tryParseContact(serializeContact(pub)) === pub',
    async (pub) => {
      const wire = await serializeContact(pub);
      const recovered = await tryParseContact(wire);
      expect(recovered).toEqual(pub);
    },
  );
});

describe('property: contactCheckBytes determinism', () => {
  fcTest.prop([fc.uint8Array({ minLength: 1, maxLength: 64 })])(
    'same input always produces same check bytes',
    async (data) => {
      const [a1, b1] = await contactCheckBytes(data);
      const [a2, b2] = await contactCheckBytes(data);
      expect(a1).toBe(a2);
      expect(b1).toBe(b2);
    },
  );
});

// ── Crypto roundtrips ────────────────────────────────────────

describe('property: encrypt/decrypt MSG roundtrip', () => {
  fcTest.prop([fc.uint8Array({ minLength: 1, maxLength: 200 })])(
    'decrypt(encrypt(plaintext)) === plaintext',
    async (plaintext) => {
      const alice = await generateKeyPair();
      const bob = await generateKeyPair();
      const { payload: compressed, compMode } = compress('test');
      const encrypted = await encrypt(
        plaintext, alice.privateKey, bob.publicKey,
        alice.publicKey, bob.publicKey, CLASS_MSG, compMode,
      );
      const decrypted = await decrypt(
        encrypted, bob.privateKey, alice.publicKey,
        alice.publicKey, bob.publicKey, CLASS_MSG,
      );
      const recoveredCompMode = seedCompMode(encrypted[0]);
      expect(recoveredCompMode).toBe(compMode);
      expect(decrypted).toEqual(plaintext);
    },
  );
});

describe('property: encrypt/decrypt INTRO roundtrip', () => {
  fcTest.prop([fc.uint8Array({ minLength: 1, maxLength: 200 })])(
    'decryptIntro(encryptIntro(plaintext)) === plaintext',
    async (plaintext) => {
      const eph = await generateKeyPair();
      const bob = await generateKeyPair();
      const encrypted = await encryptIntro(
        plaintext, eph.privateKey, bob.publicKey,
        eph.publicKey, bob.publicKey,
      );
      const decrypted = await decryptIntro(
        encrypted, bob.privateKey, eph.publicKey,
        eph.publicKey, bob.publicKey,
      );
      expect(decrypted).toEqual(plaintext);
    },
  );
});
