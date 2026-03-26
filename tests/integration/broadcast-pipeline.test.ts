import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../../src/crypto';
import { compress, decompress } from '../../src/compress';
import { stegoEncode, stegoDecode } from '../../src/stego';
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
  verified: boolean;
}> {
  const sender = await generateKeyPair();
  const { payload: compressed, compMode } = compress(plaintext);
  const frame = await serializeBroadcastSigned(compressed, compMode, sender.publicKey, sender.privateKey);
  const stegoText = stegoEncode(frame, themeId);
  const decoded = stegoDecode(stegoText);
  expect(decoded).not.toBeNull();

  // Simulate recipient who has sender as contact
  const parsed = await tryParseBroadcastSigned(decoded!.bytes, [sender.publicKey]);
  expect(parsed).not.toBeNull();
  const result = decompress(parsed!.compressed, parsed!.compMode);
  return { result, verified: parsed!.status === 'verified' };
}

describe('broadcast unsigned pipeline', () => {
  for (const themeId of ALL_THEMES) {
    it(`roundtrips through ${themeId}`, async () => {
      expect(await unsignedRoundtrip('Привет мир', themeId)).toBe('Привет мир');
    });
  }

  it('handles empty-ish message', async () => {
    expect(await unsignedRoundtrip('А', 'БОЖЕ')).toBe('А');
  });

  it('handles long message', async () => {
    const long = 'Тестовое сообщение. '.repeat(20);
    expect(await unsignedRoundtrip(long, 'PATER')).toBe(long);
  });
});

describe('broadcast signed pipeline (XEdDSA, 67-byte overhead)', () => {
  for (const themeId of ALL_THEMES) {
    it(`roundtrips through ${themeId}`, async () => {
      const { result, verified } = await signedRoundtrip('Привет мир', themeId);
      expect(result).toBe('Привет мир');
      expect(verified).toBe(true);
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
    const { payload, compMode } = compress('test');
    const frame = await serializeBroadcastSigned(payload, compMode, sender.publicKey, sender.privateKey);
    expect(tryParseBroadcastUnsigned(frame)).toBeNull();
  });

  it('unsigned broadcast is not detected as signed', async () => {
    const { payload, compMode } = compress('test');
    const frame = serializeBroadcastUnsigned(payload, compMode);
    expect(await tryParseBroadcastSigned(frame)).toBeNull();
  });
});
