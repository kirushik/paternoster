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
  const frame = await serializeBroadcastUnsigned(compressed, compMode);
  const stegoText = stegoEncode(frame, themeId);
  const decoded = stegoDecode(stegoText);
  expect(decoded).not.toBeNull();
  const parsed = await tryParseBroadcastUnsigned(decoded!.bytes);
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

describe('broadcast tail layout prevents repeatable first tokens', () => {
  it('different signed messages from the same sender produce different leading bytes', async () => {
    const sender = await generateKeyPair();

    const { payload: comp1, compMode: mode1 } = compress('Первое сообщение для всех');
    const frame1 = await serializeBroadcastSigned(comp1, mode1, sender.publicKey, sender.privateKey);

    const { payload: comp2, compMode: mode2 } = compress('Совсем другое сообщение');
    const frame2 = await serializeBroadcastSigned(comp2, mode2, sender.publicKey, sender.privateKey);

    // The tail layout means variable-length compressed content leads the frame.
    // Different messages → different leading bytes (verified at the byte level,
    // not stego token level, since model-4096 structured themes always start with
    // connector index 0 which maps to the same word regardless of the data byte).
    const leadingBytes1 = frame1.slice(0, 4);
    const leadingBytes2 = frame2.slice(0, 4);
    expect(leadingBytes1).not.toEqual(leadingBytes2);
  });
});

describe('empty plaintext broadcast', () => {
  it('empty compressed payload in unsigned broadcast is rejected (below MIN_UNSIGNED_SIZE)', async () => {
    const { payload, compMode } = compress('');
    expect(payload.length).toBe(0);
    const frame = await serializeBroadcastUnsigned(payload, compMode);
    // Frame is compressed(0) + flags(1) + check(2) = 3 bytes, below MIN_UNSIGNED_SIZE(4)
    expect(frame.length).toBe(3);
    const parsed = await tryParseBroadcastUnsigned(frame);
    expect(parsed).toBeNull();
  });

  it('empty string roundtrips through signed broadcast', async () => {
    const { result, verified } = await signedRoundtrip('', 'hex');
    expect(result).toBe('');
    expect(verified).toBe(true);
  });
});

describe('broadcast frames are not confused with P2P frames', () => {
  it('signed broadcast is not detected as unsigned', async () => {
    const sender = await generateKeyPair();
    const { payload, compMode } = compress('test');
    const frame = await serializeBroadcastSigned(payload, compMode, sender.publicKey, sender.privateKey);
    expect(await tryParseBroadcastUnsigned(frame)).toBeNull();
  });

  it('unsigned broadcast is not detected as signed', async () => {
    const { payload, compMode } = compress('test');
    const frame = await serializeBroadcastUnsigned(payload, compMode);
    expect(await tryParseBroadcastSigned(frame)).toBeNull();
  });
});
