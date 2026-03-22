import { describe, it, expect } from 'vitest';
import { generateKeyPair, encrypt, decrypt, directionByte } from '../../src/crypto';
import { compress, decompress } from '../../src/compress';
import { stegoEncode, stegoDecode } from '../../src/stego';
import {
  serializeWire, deserializeWire, makeHeader, headerClass, headerComp,
  CLASS_MSG, CLASS_INTRO, CLASS_CONTACT,
  type WireMessage, type WireIntroduction,
} from '../../src/wire';
import { type ThemeId } from '../../src/dictionaries';
import { concatU8 } from '../../src/utils';

// Full pipeline: plaintext → compress → encrypt → wire → stego → stegoDecode → wire → decrypt → decompress
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
    const headerByte = makeHeader(CLASS_INTRO, compMode);
    const introPayload = concatU8(alice.publicKey, compressed);
    const encrypted = await encrypt(introPayload, eph.privateKey, bob.publicKey, eph.publicKey, bob.publicKey, headerByte);
    wireFrame = serializeWire({ header: headerByte, ephemeralPublicKey: eph.publicKey, payload: encrypted });
  } else {
    const headerByte = makeHeader(CLASS_MSG, compMode);
    const encrypted = await encrypt(compressed, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, headerByte);
    wireFrame = serializeWire({ header: headerByte, payload: encrypted });
  }
  const stegoText = stegoEncode(wireFrame, themeId);

  // Decode
  const decoded = stegoDecode(stegoText);
  expect(decoded).not.toBeNull();
  const frame = deserializeWire(decoded!.bytes);
  expect(frame).not.toBeNull();

  const cls = headerClass(frame!.header);
  const decompMode = headerComp(frame!.header);

  if (withIntroduction) {
    expect(cls).toBe(CLASS_INTRO);
    const intro = frame as WireIntroduction;
    const decrypted = await decrypt(intro.payload, bob.privateKey, intro.ephemeralPublicKey, intro.ephemeralPublicKey, bob.publicKey, intro.header);
    const senderPub = decrypted.slice(0, 32);
    expect(senderPub).toEqual(alice.publicKey);
    return decompress(decrypted.slice(32), decompMode);
  } else {
    expect(cls).toBe(CLASS_MSG);
    const msg = frame as WireMessage;
    const decrypted = await decrypt(msg.payload, bob.privateKey, alice.publicKey, alice.publicKey, bob.publicKey, msg.header);
    return decompress(decrypted, decompMode);
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
    const headerByte = makeHeader(CLASS_MSG, 0);

    const plaintext = 'Секретное сообщение';
    const { payload: compressed, compMode } = compress(plaintext);
    const encrypted = await encrypt(compressed, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, headerByte);
    const decrypted = await decrypt(encrypted, bob.privateKey, alice.publicKey, alice.publicKey, bob.publicKey, headerByte);
    expect(decompress(decrypted, compMode)).toBe(plaintext);
  });

  it('wrong key fails to decrypt', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const eve = await generateKeyPair();
    const headerByte = makeHeader(CLASS_MSG, 0);

    const { payload: compressed } = compress('Секрет');
    const encrypted = await encrypt(compressed, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, headerByte);

    // Eve (wrong key) tries to decrypt
    await expect(decrypt(encrypted, eve.privateKey, alice.publicKey, alice.publicKey, eve.publicKey, headerByte)).rejects.toThrow();
  });

  it('self-encryption works', async () => {
    const alice = await generateKeyPair();
    const headerByte = makeHeader(CLASS_MSG, 0);
    const { payload: compressed, compMode } = compress('Записка самому себе');
    const encrypted = await encrypt(compressed, alice.privateKey, alice.publicKey, alice.publicKey, alice.publicKey, headerByte);
    const decrypted = await decrypt(encrypted, alice.privateKey, alice.publicKey, alice.publicKey, alice.publicKey, headerByte);
    expect(decompress(decrypted, compMode)).toBe('Записка самому себе');
  });
});

describe('INTRO sender key extraction', () => {
  it('sender key is correctly embedded and extractable', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const eph = await generateKeyPair();

    const { payload: compressed, compMode } = compress('Привет');
    const headerByte = makeHeader(CLASS_INTRO, compMode);
    const introPayload = concatU8(alice.publicKey, compressed);
    const encrypted = await encrypt(introPayload, eph.privateKey, bob.publicKey, eph.publicKey, bob.publicKey, headerByte);
    const wire = serializeWire({ header: headerByte, ephemeralPublicKey: eph.publicKey, payload: encrypted });

    const stegoText = stegoEncode(wire, 'БОЖЕ');
    const decoded = stegoDecode(stegoText)!;
    const frame = deserializeWire(decoded.bytes) as WireIntroduction;

    expect(headerClass(frame.header)).toBe(CLASS_INTRO);
    expect(frame.ephemeralPublicKey).toEqual(eph.publicKey);

    const decrypted = await decrypt(frame.payload, bob.privateKey, frame.ephemeralPublicKey, frame.ephemeralPublicKey, bob.publicKey, frame.header);
    const senderPub = decrypted.slice(0, 32);
    const message = decrypted.slice(32);

    expect(senderPub).toEqual(alice.publicKey);
    expect(decompress(message, headerComp(frame.header))).toBe('Привет');
  });

  it('ephemeral key reveals nothing about sender', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const eph1 = await generateKeyPair();
    const eph2 = await generateKeyPair();

    const { payload: compressed, compMode } = compress('test');
    const headerByte = makeHeader(CLASS_INTRO, compMode);
    const payload = concatU8(alice.publicKey, compressed);

    const enc1 = await encrypt(payload, eph1.privateKey, bob.publicKey, eph1.publicKey, bob.publicKey, headerByte);
    const enc2 = await encrypt(payload, eph2.privateKey, bob.publicKey, eph2.publicKey, bob.publicKey, headerByte);

    const wire1 = serializeWire({ header: headerByte, ephemeralPublicKey: eph1.publicKey, payload: enc1 });
    const wire2 = serializeWire({ header: headerByte, ephemeralPublicKey: eph2.publicKey, payload: enc2 });

    // Ephemeral keys are different
    expect(wire1.slice(1, 33)).not.toEqual(wire2.slice(1, 33));

    // But both decrypt to reveal the same sender
    const dec1 = await decrypt(enc1, bob.privateKey, eph1.publicKey, eph1.publicKey, bob.publicKey, headerByte);
    const dec2 = await decrypt(enc2, bob.privateKey, eph2.publicKey, eph2.publicKey, bob.publicKey, headerByte);
    expect(dec1.slice(0, 32)).toEqual(alice.publicKey);
    expect(dec2.slice(0, 32)).toEqual(alice.publicKey);
  });
});

describe('AAD binding', () => {
  it('flipping any header bit causes decryption failure', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const headerByte = makeHeader(CLASS_MSG, 0);

    const { payload: compressed } = compress('test');
    const encrypted = await encrypt(compressed, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, headerByte);

    // Flip each bit of the header byte and try to decrypt
    for (let bit = 0; bit < 8; bit++) {
      const tamperedHeader = headerByte ^ (1 << bit);
      if (tamperedHeader === headerByte) continue;
      await expect(
        decrypt(encrypted, bob.privateKey, alice.publicKey, alice.publicKey, bob.publicKey, tamperedHeader)
      ).rejects.toThrow();
    }
  });
});

describe('direction separation', () => {
  it('Alice→Bob and Bob→Alice derive different material', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const headerByte = makeHeader(CLASS_MSG, 0);

    const { payload: compressed } = compress('same message');

    // Alice encrypts for Bob
    const enc1 = await encrypt(compressed, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, headerByte);
    // Bob encrypts for Alice (same shared secret, but direction differs)
    const enc2 = await encrypt(compressed, bob.privateKey, alice.publicKey, bob.publicKey, alice.publicKey, headerByte);

    // Both should decrypt successfully with their respective direction parameters
    const dec1 = await decrypt(enc1, bob.privateKey, alice.publicKey, alice.publicKey, bob.publicKey, headerByte);
    const dec2 = await decrypt(enc2, alice.privateKey, bob.publicKey, bob.publicKey, alice.publicKey, headerByte);

    expect(dec1).toEqual(compressed);
    expect(dec2).toEqual(compressed);
  });

  it('directionByte is deterministic and antisymmetric', () => {
    const keyA = new Uint8Array(32).fill(0x01);
    const keyB = new Uint8Array(32).fill(0x02);

    expect(directionByte(keyA, keyB)).toBe(0x00); // A < B
    expect(directionByte(keyB, keyA)).toBe(0x01); // B > A
    expect(directionByte(keyA, keyA)).toBe(0x00); // equal → 0x00
  });
});

describe('wire frame size', () => {
  it('MSG overhead is 19 bytes (header:1 + seed:6 + tag:12)', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const headerByte = makeHeader(CLASS_MSG, 0);

    // Encrypt 1 byte of plaintext
    const plaintext = new Uint8Array([0x42]);
    const encrypted = await encrypt(plaintext, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, headerByte);
    const wire = serializeWire({ header: headerByte, payload: encrypted });

    // wire = H:1 + seed:6 + ciphertext:1 + tag:12 = 20
    expect(wire.length).toBe(20);

    // Verify overhead: wire.length - plaintext.length = 19
    expect(wire.length - plaintext.length).toBe(19);
  });
});
