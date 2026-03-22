import { describe, it, expect } from 'vitest';
import { generateKeyPair, encrypt, decrypt, directionByte, seedCompMode, CLASS_MSG, CLASS_INTRO } from '../../src/crypto';
import { compress, decompress } from '../../src/compress';
import { stegoEncode, stegoDecode } from '../../src/stego';
import { serializeMsg, serializeIntro, couldBeIntro, splitIntro } from '../../src/wire';
import { type ThemeId } from '../../src/dictionaries';
import { concatU8 } from '../../src/utils';

// Full pipeline: plaintext → compress → encrypt → wire → stego → decode → decrypt → decompress
async function fullRoundtrip(
  plaintext: string,
  themeId: ThemeId,
  withIntroduction: boolean,
): Promise<string> {
  const alice = await generateKeyPair();
  const bob = await generateKeyPair();

  const { payload: compressed, compMode } = compress(plaintext);

  let wireFrame: Uint8Array;
  if (withIntroduction) {
    const eph = await generateKeyPair();
    const introPayload = concatU8(alice.publicKey, compressed);
    const encrypted = await encrypt(introPayload, eph.privateKey, bob.publicKey, eph.publicKey, bob.publicKey, CLASS_INTRO, compMode);
    wireFrame = serializeIntro(eph.publicKey, encrypted);
  } else {
    const encrypted = await encrypt(compressed, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG, compMode);
    wireFrame = serializeMsg(encrypted);
  }
  const stegoText = stegoEncode(wireFrame, themeId);

  // Decode
  const decoded = stegoDecode(stegoText);
  expect(decoded).not.toBeNull();
  const bytes = decoded!.bytes;

  if (withIntroduction) {
    expect(couldBeIntro(bytes)).toBe(true);
    const { ephPub, payload } = splitIntro(bytes);
    const decrypted = await decrypt(payload, bob.privateKey, ephPub, ephPub, bob.publicKey, CLASS_INTRO);
    const senderPub = decrypted.slice(0, 32);
    expect(senderPub).toEqual(alice.publicKey);
    const decCompMode = seedCompMode(bytes[32]); // seed at byte 32
    return decompress(decrypted.slice(32), decCompMode);
  } else {
    const decrypted = await decrypt(bytes, bob.privateKey, alice.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG);
    const decCompMode = seedCompMode(bytes[0]); // seed at byte 0
    return decompress(decrypted, decCompMode);
  }
}

describe('full pipeline roundtrip', () => {
  const themes: ThemeId[] = ['БОЖЕ', 'РОССИЯ', 'СССР', 'БУХАЮ', 'КИТАЙ', 'PATER', '🙂', 'hex'];

  for (const themeId of themes) {
    it(`roundtrips through ${themeId} without introduction`, async () => {
      const result = await fullRoundtrip('Привет, мир!', themeId, false);
      expect(result).toBe('Привет, мир!');
    });

    it(`roundtrips through ${themeId} with introduction`, async () => {
      const result = await fullRoundtrip('Тестовое сообщение', themeId, true);
      expect(result).toBe('Тестовое сообщение');
    });
  }
});

describe('pipeline with various message types', () => {
  it('short Russian message', async () => {
    expect(await fullRoundtrip('Да', 'БОЖЕ', false)).toBe('Да');
  });

  it('long Russian message', async () => {
    const long = 'Съешь же ещё этих мягких французских булок, да выпей чаю. '.repeat(5);
    expect(await fullRoundtrip(long, 'БОЖЕ', false)).toBe(long);
  });

  it('message with emoji', async () => {
    expect(await fullRoundtrip('Привет 😀🌍', 'РОССИЯ', false)).toBe('Привет 😀🌍');
  });

  it('mixed language message', async () => {
    expect(await fullRoundtrip('Hello Привет 你好', 'hex', false)).toBe('Hello Привет 你好');
  });
});

describe('cross-key encryption', () => {
  it('Alice encrypts for Bob, Bob decrypts', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const plaintext = 'Секретное сообщение';
    const { payload: compressed, compMode } = compress(plaintext);
    const encrypted = await encrypt(compressed, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG, compMode);
    const decrypted = await decrypt(encrypted, bob.privateKey, alice.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG);
    const decCompMode = seedCompMode(encrypted[0]);
    expect(decompress(decrypted, decCompMode)).toBe(plaintext);
  });

  it('wrong key fails to decrypt', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const eve = await generateKeyPair();

    const { payload: compressed, compMode } = compress('Секрет');
    const encrypted = await encrypt(compressed, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG, compMode);

    await expect(decrypt(encrypted, eve.privateKey, alice.publicKey, alice.publicKey, eve.publicKey, CLASS_MSG)).rejects.toThrow();
  });

  it('self-encryption works', async () => {
    const alice = await generateKeyPair();
    const { payload: compressed, compMode } = compress('Записка самому себе');
    const encrypted = await encrypt(compressed, alice.privateKey, alice.publicKey, alice.publicKey, alice.publicKey, CLASS_MSG, compMode);
    const decrypted = await decrypt(encrypted, alice.privateKey, alice.publicKey, alice.publicKey, alice.publicKey, CLASS_MSG);
    const decCompMode = seedCompMode(encrypted[0]);
    expect(decompress(decrypted, decCompMode)).toBe('Записка самому себе');
  });
});

describe('INTRO sender key extraction', () => {
  it('sender key is correctly embedded and extractable', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const eph = await generateKeyPair();

    const { payload: compressed, compMode } = compress('Привет');
    const introPayload = concatU8(alice.publicKey, compressed);
    const encrypted = await encrypt(introPayload, eph.privateKey, bob.publicKey, eph.publicKey, bob.publicKey, CLASS_INTRO, compMode);
    const wire = serializeIntro(eph.publicKey, encrypted);

    const stegoText = stegoEncode(wire, 'БОЖЕ');
    const decoded = stegoDecode(stegoText)!;
    const { ephPub, payload } = splitIntro(decoded.bytes);

    expect(ephPub).toEqual(eph.publicKey);

    const decrypted = await decrypt(payload, bob.privateKey, ephPub, ephPub, bob.publicKey, CLASS_INTRO);
    const senderPub = decrypted.slice(0, 32);
    const message = decrypted.slice(32);

    expect(senderPub).toEqual(alice.publicKey);
    const decCompMode = seedCompMode(decoded.bytes[32]);
    expect(decompress(message, decCompMode)).toBe('Привет');
  });
});

describe('class domain separation', () => {
  it('MSG encrypted data cannot be decrypted as INTRO (wrong classByte)', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const { payload: compressed, compMode } = compress('test');
    const encrypted = await encrypt(compressed, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG, compMode);

    // Try to decrypt with CLASS_INTRO — should fail (different derived key)
    await expect(
      decrypt(encrypted, bob.privateKey, alice.publicKey, alice.publicKey, bob.publicKey, CLASS_INTRO)
    ).rejects.toThrow();
  });
});

describe('comp mode in seed', () => {
  it('comp mode survives encrypt→decrypt roundtrip', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    for (const compMode of [0, 1, 2]) {
      const data = new Uint8Array([0x42]); // arbitrary plaintext byte
      const encrypted = await encrypt(data, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG, compMode);

      // Comp mode should be in seed[0] top 2 bits
      const readBack = seedCompMode(encrypted[0]);
      expect(readBack).toBe(compMode);

      // Decrypt should still work (seed with stamped bits is part of KDF input)
      const decrypted = await decrypt(encrypted, bob.privateKey, alice.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG);
      expect(decrypted).toEqual(data);
    }
  });
});

describe('direction separation', () => {
  it('Alice→Bob and Bob→Alice both decrypt correctly', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const { payload: compressed, compMode } = compress('same message');

    const enc1 = await encrypt(compressed, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG, compMode);
    const enc2 = await encrypt(compressed, bob.privateKey, alice.publicKey, bob.publicKey, alice.publicKey, CLASS_MSG, compMode);

    const dec1 = await decrypt(enc1, bob.privateKey, alice.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG);
    const dec2 = await decrypt(enc2, alice.privateKey, bob.publicKey, bob.publicKey, alice.publicKey, CLASS_MSG);

    expect(dec1).toEqual(compressed);
    expect(dec2).toEqual(compressed);
  });

  it('directionByte is deterministic and antisymmetric', () => {
    const keyA = new Uint8Array(32).fill(0x01);
    const keyB = new Uint8Array(32).fill(0x02);
    expect(directionByte(keyA, keyB)).toBe(0x00);
    expect(directionByte(keyB, keyA)).toBe(0x01);
    expect(directionByte(keyA, keyA)).toBe(0x00);
  });
});

describe('wire frame size', () => {
  it('MSG overhead is 18 bytes (seed:6 + tag:12, no header)', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const plaintext = new Uint8Array([0x42]);
    const encrypted = await encrypt(plaintext, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG, 0);
    const wire = serializeMsg(encrypted);

    // wire = seed:6 + ciphertext:1 + tag:12 = 19 bytes for 1-byte plaintext
    expect(wire.length).toBe(19);
    expect(wire.length - plaintext.length).toBe(18); // 18 bytes overhead
  });

  it('no repetitive first byte across messages', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const firstBytes = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const encrypted = await encrypt(new Uint8Array([0x42]), alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG, 0);
      firstBytes.add(encrypted[0] & 0x3F); // bottom 6 bits (top 2 are comp mode)
    }
    // With random seeds, bottom 6 bits should vary (very unlikely to all be the same)
    expect(firstBytes.size).toBeGreaterThan(1);
  });
});
