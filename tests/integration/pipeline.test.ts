import { describe, it, expect } from 'vitest';
import { generateKeyPair, encrypt, decrypt } from '../../src/crypto';
import { compress, decompress } from '../../src/compress';
import { stegoEncode, stegoDecode } from '../../src/stego';
import { serializeWire, deserializeWire, MSG_STANDARD, MSG_INTRODUCTION, type WireMessage, type WireIntroduction } from '../../src/wire';
import { type ThemeId, THEMES } from '../../src/dictionaries';
import { concatU8 } from '../../src/utils';

// Full pipeline: plaintext → compress → encrypt → wire → stego → stegoDecode → wire → decrypt → decompress
async function fullRoundtrip(
  plaintext: string,
  themeId: ThemeId,
  withIntroduction: boolean,
): Promise<string> {
  const alice = await generateKeyPair();
  const bob = await generateKeyPair();

  // Encode
  const compressed = compress(plaintext);

  let wireFrame: Uint8Array;
  if (withIntroduction) {
    // MSG_INTRODUCTION: ephemeral key, sender's real key inside encrypted envelope
    const eph = await generateKeyPair();
    const introPayload = concatU8(alice.publicKey, compressed);
    const encrypted = await encrypt(introPayload, eph.privateKey, bob.publicKey);
    wireFrame = serializeWire({ type: MSG_INTRODUCTION, ephemeralPublicKey: eph.publicKey, payload: encrypted });
  } else {
    const encrypted = await encrypt(compressed, alice.privateKey, bob.publicKey);
    wireFrame = serializeWire({ type: MSG_STANDARD, payload: encrypted });
  }
  const stegoText = stegoEncode(wireFrame, themeId);

  // Decode
  const decoded = stegoDecode(stegoText);
  expect(decoded).not.toBeNull();
  const frame = deserializeWire(decoded!.bytes);
  expect(frame).not.toBeNull();

  if (withIntroduction) {
    expect(frame!.type).toBe(MSG_INTRODUCTION);
    const intro = frame as WireIntroduction;
    // Decrypt with ephemeral key
    const decrypted = await decrypt(intro.payload, bob.privateKey, intro.ephemeralPublicKey);
    // Extract sender key (first 32 bytes) and message
    const senderPub = decrypted.slice(0, 32);
    expect(senderPub).toEqual(alice.publicKey);
    return decompress(decrypted.slice(32));
  } else {
    expect(frame!.type).toBe(MSG_STANDARD);
    const msg = frame as WireMessage;
    const decrypted = await decrypt(msg.payload, bob.privateKey, alice.publicKey);
    return decompress(decrypted);
  }
}

describe('full pipeline roundtrip', () => {
  // Test all themes that have deterministic enough encoding
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
    const compressed = compress(plaintext);
    const encrypted = await encrypt(compressed, alice.privateKey, bob.publicKey);
    const decrypted = await decrypt(encrypted, bob.privateKey, alice.publicKey);
    expect(decompress(decrypted)).toBe(plaintext);
  });

  it('wrong key fails to decrypt', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const eve = await generateKeyPair();

    const compressed = compress('Секрет');
    const encrypted = await encrypt(compressed, alice.privateKey, bob.publicKey);

    // Eve (wrong key) tries to decrypt
    await expect(decrypt(encrypted, eve.privateKey, alice.publicKey)).rejects.toThrow();
  });

  it('self-encryption works', async () => {
    const alice = await generateKeyPair();
    const compressed = compress('Записка самому себе');
    const encrypted = await encrypt(compressed, alice.privateKey, alice.publicKey);
    const decrypted = await decrypt(encrypted, alice.privateKey, alice.publicKey);
    expect(decompress(decrypted)).toBe('Записка самому себе');
  });
});

describe('MSG_INTRODUCTION sender key extraction', () => {
  it('sender key is correctly embedded inside encrypted payload and extractable', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const eph = await generateKeyPair();

    const compressed = compress('Привет');
    const introPayload = concatU8(alice.publicKey, compressed);
    const encrypted = await encrypt(introPayload, eph.privateKey, bob.publicKey);
    const wire = serializeWire({
      type: MSG_INTRODUCTION,
      ephemeralPublicKey: eph.publicKey,
      payload: encrypted,
    });

    const stegoText = stegoEncode(wire, 'БОЖЕ');
    const decoded = stegoDecode(stegoText)!;
    const frame = deserializeWire(decoded.bytes) as WireIntroduction;

    expect(frame.type).toBe(MSG_INTRODUCTION);
    expect(frame.ephemeralPublicKey).toEqual(eph.publicKey);

    // Bob decrypts using his private key + ephemeral public key
    const decrypted = await decrypt(frame.payload, bob.privateKey, frame.ephemeralPublicKey);
    const senderPub = decrypted.slice(0, 32);
    const message = decrypted.slice(32);

    expect(senderPub).toEqual(alice.publicKey);
    expect(decompress(message)).toBe('Привет');
  });

  it('ephemeral key reveals nothing about sender', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const eph1 = await generateKeyPair();
    const eph2 = await generateKeyPair();

    const compressed = compress('test');
    const payload = concatU8(alice.publicKey, compressed);

    const enc1 = await encrypt(payload, eph1.privateKey, bob.publicKey);
    const enc2 = await encrypt(payload, eph2.privateKey, bob.publicKey);

    const wire1 = serializeWire({ type: MSG_INTRODUCTION, ephemeralPublicKey: eph1.publicKey, payload: enc1 });
    const wire2 = serializeWire({ type: MSG_INTRODUCTION, ephemeralPublicKey: eph2.publicKey, payload: enc2 });

    // Ephemeral keys are different — observer can't link messages to same sender
    expect(wire1.slice(1, 33)).not.toEqual(wire2.slice(1, 33));

    // But both decrypt to reveal the same sender
    const dec1 = await decrypt(enc1, bob.privateKey, eph1.publicKey);
    const dec2 = await decrypt(enc2, bob.privateKey, eph2.publicKey);
    expect(dec1.slice(0, 32)).toEqual(alice.publicKey);
    expect(dec2.slice(0, 32)).toEqual(alice.publicKey);
  });
});
