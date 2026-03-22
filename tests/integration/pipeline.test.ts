import { describe, it, expect } from 'vitest';
import { generateKeyPair, encrypt, decrypt } from '../../src/crypto';
import { compress, decompress } from '../../src/compress';
import { stegoEncode, stegoDecode } from '../../src/stego';
import { serializeWire, deserializeWire, MSG_NO_SENDER, MSG_WITH_SENDER, type WireMessage } from '../../src/wire';
import { type ThemeId, THEMES } from '../../src/dictionaries';

// Full pipeline: plaintext → compress → encrypt → wire → stego → stegoDecode → wire → decrypt → decompress
async function fullRoundtrip(
  plaintext: string,
  themeId: ThemeId,
  withSenderKey: boolean,
): Promise<string> {
  const alice = await generateKeyPair();
  const bob = await generateKeyPair();

  // Encode
  const compressed = compress(plaintext);
  const encrypted = await encrypt(compressed, alice.privateKey, bob.publicKey);
  const wireFrame = withSenderKey
    ? serializeWire({ type: MSG_WITH_SENDER, senderPublicKey: alice.publicKey, payload: encrypted })
    : serializeWire({ type: MSG_NO_SENDER, payload: encrypted });
  const stegoText = stegoEncode(wireFrame, themeId);

  // Decode
  const decoded = stegoDecode(stegoText);
  expect(decoded).not.toBeNull();
  const frame = deserializeWire(decoded!.bytes) as WireMessage;
  expect(frame).not.toBeNull();

  if (withSenderKey) {
    expect(frame.type).toBe(MSG_WITH_SENDER);
    expect(frame.senderPublicKey).toEqual(alice.publicKey);
  }

  const decrypted = await decrypt(frame.payload, bob.privateKey, alice.publicKey);
  return decompress(decrypted);
}

describe('full pipeline roundtrip', () => {
  // Test all themes that have deterministic enough encoding
  const themes: ThemeId[] = ['БОЖЕ', 'РОССИЯ', 'СССР', 'БУХАЮ', 'КИТАЙ', 'PATER', '🙂', 'hex'];

  for (const themeId of themes) {
    it(`roundtrips through ${themeId} without sender key`, async () => {
      const result = await fullRoundtrip('Привет, мир!', themeId, false);
      expect(result).toBe('Привет, мир!');
    });

    it(`roundtrips through ${themeId} with sender key`, async () => {
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

describe('sender key extraction', () => {
  it('sender key is correctly embedded and extracted', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const compressed = compress('Привет');
    const encrypted = await encrypt(compressed, alice.privateKey, bob.publicKey);
    const wire = serializeWire({
      type: MSG_WITH_SENDER,
      senderPublicKey: alice.publicKey,
      payload: encrypted,
    });

    const stegoText = stegoEncode(wire, 'БОЖЕ');
    const decoded = stegoDecode(stegoText)!;
    const frame = deserializeWire(decoded.bytes) as WireMessage;

    expect(frame.type).toBe(MSG_WITH_SENDER);
    expect(frame.senderPublicKey).toEqual(alice.publicKey);

    // Bob can decrypt using the extracted sender key
    const decrypted = await decrypt(frame.payload, bob.privateKey, frame.senderPublicKey!);
    expect(decompress(decrypted)).toBe('Привет');
  });
});
