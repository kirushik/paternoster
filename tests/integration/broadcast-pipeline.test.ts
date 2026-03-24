import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../../src/crypto';
import { compress, decompress } from '../../src/compress';
import { stegoEncode, stegoDecode } from '../../src/stego';
import { deriveSigningKeys } from '../../src/sign';
import {
  serializeBroadcastUnsigned,
  serializeBroadcastSigned,
  tryParseBroadcastUnsigned,
  tryParseBroadcastSigned,
} from '../../src/broadcast';
import { type ThemeId, THEMES } from '../../src/dictionaries';

const ALL_THEMES = THEMES.map(t => t.id);

async function unsignedRoundtrip(plaintext: string, themeId: ThemeId): Promise<string> {
  const { payload: compressed, compMode } = compress(plaintext);
  const frame = serializeBroadcastUnsigned(compressed, compMode);
  const stegoText = stegoEncode(frame, themeId);

  const decoded = stegoDecode(stegoText);
  expect(decoded).not.toBeNull();
  const parsed = tryParseBroadcastUnsigned(decoded!.bytes);
  expect(parsed).not.toBeNull();
  return decompress(parsed!.compressed, parsed!.compMode);
}

async function signedRoundtrip(plaintext: string, themeId: ThemeId): Promise<{
  result: string;
  senderKeyMatch: boolean;
  ed25519Match: boolean;
}> {
  const sender = await generateKeyPair();
  const keys = await deriveSigningKeys(sender.privateKey);

  const { payload: compressed, compMode } = compress(plaintext);
  const frame = await serializeBroadcastSigned(
    compressed, compMode,
    sender.publicKey, keys.publicKeyRaw,
    keys.privateKey,
  );
  const stegoText = stegoEncode(frame, themeId);

  const decoded = stegoDecode(stegoText);
  expect(decoded).not.toBeNull();
  const parsed = await tryParseBroadcastSigned(decoded!.bytes);
  expect(parsed).not.toBeNull();

  const result = decompress(parsed!.compressed, parsed!.compMode);
  const senderKeyMatch = Buffer.from(parsed!.x25519Pub).equals(Buffer.from(sender.publicKey));
  const ed25519Match = Buffer.from(parsed!.ed25519Pub).equals(Buffer.from(keys.publicKeyRaw));

  return { result, senderKeyMatch, ed25519Match };
}

describe('broadcast unsigned pipeline', () => {
  for (const themeId of ALL_THEMES) {
    it(`roundtrips through ${themeId}`, async () => {
      const result = await unsignedRoundtrip('Привет мир', themeId);
      expect(result).toBe('Привет мир');
    });
  }

  it('handles empty-ish message', async () => {
    const result = await unsignedRoundtrip('А', 'БОЖЕ');
    expect(result).toBe('А');
  });

  it('handles long message', async () => {
    const long = 'Тестовое сообщение. '.repeat(20);
    const result = await unsignedRoundtrip(long, 'PATER');
    expect(result).toBe(long);
  });
});

describe('broadcast signed pipeline', () => {
  for (const themeId of ALL_THEMES) {
    it(`roundtrips through ${themeId}`, async () => {
      const { result, senderKeyMatch, ed25519Match } = await signedRoundtrip('Привет мир', themeId);
      expect(result).toBe('Привет мир');
      expect(senderKeyMatch).toBe(true);
      expect(ed25519Match).toBe(true);
    });
  }

  it('handles emoji message', async () => {
    const { result } = await signedRoundtrip('Привет 🌍!', 'hex');
    expect(result).toBe('Привет 🌍!');
  });
});

describe('broadcast frames are not confused with P2P frames', () => {
  it('signed broadcast is not detected as unsigned', async () => {
    const sender = await generateKeyPair();
    const keys = await deriveSigningKeys(sender.privateKey);
    const { payload, compMode } = compress('test');
    const frame = await serializeBroadcastSigned(
      payload, compMode,
      sender.publicKey, keys.publicKeyRaw,
      keys.privateKey,
    );

    // Should not parse as unsigned broadcast
    const asUnsigned = tryParseBroadcastUnsigned(frame);
    expect(asUnsigned).toBeNull();
  });

  it('unsigned broadcast is not detected as signed', async () => {
    const { payload, compMode } = compress('test');
    const frame = serializeBroadcastUnsigned(payload, compMode);

    // Should not parse as signed broadcast
    const asSigned = await tryParseBroadcastSigned(frame);
    expect(asSigned).toBeNull();
  });
});
