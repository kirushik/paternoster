import { describe, it, expect } from 'vitest';
import { generateKeyPair, encrypt, decrypt, encryptIntro, decryptIntro, directionByte, seedCompMode, CLASS_MSG } from '../../src/crypto';
import { compress, decompress } from '../../src/compress';
import { stegoEncode, stegoDecode } from '../../src/stego';
import { serializeMsg, serializeIntro, couldBeIntro, splitIntro } from '../../src/wire';
import { type ThemeId } from '../../src/dictionaries';
import { concatU8 } from '../../src/utils';

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
    // Seedless INTRO: comp mode inside encrypted plaintext
    const introPayload = concatU8(new Uint8Array([compMode]), alice.publicKey, compressed);
    const encrypted = await encryptIntro(introPayload, eph.privateKey, bob.publicKey, eph.publicKey, bob.publicKey);
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
    const decrypted = await decryptIntro(payload, bob.privateKey, ephPub, ephPub, bob.publicKey);
    const decCompMode = decrypted[0];
    const senderPub = decrypted.slice(1, 33);
    expect(senderPub).toEqual(alice.publicKey);
    return decompress(decrypted.slice(33), decCompMode);
  } else {
    const decrypted = await decrypt(bytes, bob.privateKey, alice.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG);
    const decCompMode = seedCompMode(bytes[0]);
    return decompress(decrypted, decCompMode);
  }
}

describe('full pipeline roundtrip', () => {
  const themes: ThemeId[] = ['БОЖЕ', 'РОССИЯ', 'СССР', 'БУХАЮ', 'КИТАЙ', 'PATER', '🙂', 'hex'];

  for (const themeId of themes) {
    it(`roundtrips through ${themeId} without introduction`, async () => {
      expect(await fullRoundtrip('Привет, мир!', themeId, false)).toBe('Привет, мир!');
    });

    it(`roundtrips through ${themeId} with introduction`, async () => {
      expect(await fullRoundtrip('Тестовое сообщение', themeId, true)).toBe('Тестовое сообщение');
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

describe('large message pipeline (safety counter regression)', () => {
  const largeText = 'Съешь же ещё этих мягких французских булок, да выпей чаю. '.repeat(100);
  const themes: ThemeId[] = ['БОЖЕ', 'РОССИЯ', 'СССР', 'БУХАЮ', 'КИТАЙ', 'PATER', '🙂', 'hex'];

  for (const themeId of themes) {
    it(`roundtrips large text (~5800 chars) through ${themeId} without introduction`, async () => {
      expect(await fullRoundtrip(largeText, themeId, false)).toBe(largeText);
    });

    it(`roundtrips large text (~5800 chars) through ${themeId} with introduction`, async () => {
      expect(await fullRoundtrip(largeText, themeId, true)).toBe(largeText);
    });
  }
});

describe('cross-key encryption', () => {
  it('Alice encrypts for Bob, Bob decrypts', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const { payload: compressed, compMode } = compress('Секретное сообщение');
    const encrypted = await encrypt(compressed, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG, compMode);
    const decrypted = await decrypt(encrypted, bob.privateKey, alice.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG);
    expect(decompress(decrypted, seedCompMode(encrypted[0]))).toBe('Секретное сообщение');
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
    const { payload: compressed, compMode } = compress('Записка');
    const encrypted = await encrypt(compressed, alice.privateKey, alice.publicKey, alice.publicKey, alice.publicKey, CLASS_MSG, compMode);
    const decrypted = await decrypt(encrypted, alice.privateKey, alice.publicKey, alice.publicKey, alice.publicKey, CLASS_MSG);
    expect(decompress(decrypted, seedCompMode(encrypted[0]))).toBe('Записка');
  });
});

describe('INTRO sender key extraction', () => {
  it('sender key is correctly embedded and extractable', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const eph = await generateKeyPair();

    const { payload: compressed, compMode } = compress('Привет');
    const introPayload = concatU8(new Uint8Array([compMode]), alice.publicKey, compressed);
    const encrypted = await encryptIntro(introPayload, eph.privateKey, bob.publicKey, eph.publicKey, bob.publicKey);
    const wire = serializeIntro(eph.publicKey, encrypted);

    const stegoText = stegoEncode(wire, 'БОЖЕ');
    const decoded = stegoDecode(stegoText)!;
    const { ephPub, payload } = splitIntro(decoded.bytes);

    expect(ephPub).toEqual(eph.publicKey);
    const decrypted = await decryptIntro(payload, bob.privateKey, ephPub, ephPub, bob.publicKey);
    expect(decrypted[0]).toBe(compMode);
    expect(decrypted.slice(1, 33)).toEqual(alice.publicKey);
    expect(decompress(decrypted.slice(33), decrypted[0])).toBe('Привет');
  });
});

describe('class domain separation', () => {
  it('MSG encrypted data cannot be decrypted as INTRO', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const { payload: compressed, compMode } = compress('test');
    const encrypted = await encrypt(compressed, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG, compMode);
    // Try decryptIntro on MSG data — should fail (different classByte in KDF)
    await expect(
      decryptIntro(encrypted, bob.privateKey, alice.publicKey, alice.publicKey, bob.publicKey)
    ).rejects.toThrow();
  });
});

describe('comp mode in seed', () => {
  it('comp mode survives encrypt→decrypt roundtrip for MSG', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    for (const compMode of [0, 1, 2]) {
      const data = new Uint8Array([0x42]);
      const encrypted = await encrypt(data, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG, compMode);
      expect(seedCompMode(encrypted[0])).toBe(compMode);
      const decrypted = await decrypt(encrypted, bob.privateKey, alice.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG);
      expect(decrypted).toEqual(data);
    }
  });

  it('comp mode inside INTRO plaintext survives roundtrip', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const eph = await generateKeyPair();

    for (const compMode of [0, 1, 2]) {
      const payload = concatU8(new Uint8Array([compMode]), alice.publicKey, new Uint8Array([0x42]));
      const encrypted = await encryptIntro(payload, eph.privateKey, bob.publicKey, eph.publicKey, bob.publicKey);
      const decrypted = await decryptIntro(encrypted, bob.privateKey, eph.publicKey, eph.publicKey, bob.publicKey);
      expect(decrypted[0]).toBe(compMode);
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

    expect(await decrypt(enc1, bob.privateKey, alice.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG)).toEqual(compressed);
    expect(await decrypt(enc2, alice.privateKey, bob.publicKey, bob.publicKey, alice.publicKey, CLASS_MSG)).toEqual(compressed);
  });

  it('directionByte is deterministic and antisymmetric', () => {
    const keyA = new Uint8Array(32).fill(0x01);
    const keyB = new Uint8Array(32).fill(0x02);
    expect(directionByte(keyA, keyB)).toBe(0x00);
    expect(directionByte(keyB, keyA)).toBe(0x01);
  });
});

describe('wire frame size', () => {
  it('MSG overhead is 14 bytes (seed:6 + tag:8)', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const plaintext = new Uint8Array([0x42]);
    const encrypted = await encrypt(plaintext, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG, 0);
    const wire = serializeMsg(encrypted);
    // wire = seed:6 + ciphertext:1 + tag:8 = 15
    expect(wire.length).toBe(15);
    expect(wire.length - plaintext.length).toBe(14);
  });

  it('INTRO overhead is 40 bytes (eph:32 + tag:8, no seed)', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const eph = await generateKeyPair();

    const plaintext = new Uint8Array([0x00, ...alice.publicKey, 0x42]); // comp:1 + key:32 + msg:1
    const encrypted = await encryptIntro(plaintext, eph.privateKey, bob.publicKey, eph.publicKey, bob.publicKey);
    const wire = serializeIntro(eph.publicKey, encrypted);
    // wire = eph:32 + ciphertext:34 + tag:8 = 74, plaintext was 34, overhead = 40
    expect(wire.length - plaintext.length).toBe(40);
  });
});
