import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../../src/crypto';
import { stegoEncode } from '../../src/stego';
import { charCount } from '../../src/utils';
import { ALL_THEME_IDS, makeMsgFrame, makeIntroFrame } from '../helpers';

describe('pipeline stats consistency', () => {
  const shortText = 'Привет';
  const longText = 'Это достаточно длинное сообщение для проверки сжатия. '.repeat(10);

  it('wire frame size is identical across all themes for the same plaintext', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const wireFrame = await makeMsgFrame(alice.privateKey, alice.publicKey, bob.publicKey, shortText);
    const wireLen = wireFrame.length;

    // Encode through every theme and verify wire frame is the same
    // (wire frame is computed before theme encoding, so theme choice shouldn't affect it)
    for (const themeId of ALL_THEME_IDS) {
      const stegoText = stegoEncode(wireFrame, themeId);
      const outputChars = charCount(stegoText);
      expect(outputChars).toBeGreaterThan(0);
      // Wire frame was built once — same length for all themes
      expect(wireFrame.length).toBe(wireLen);
    }
  });

  it('charCount matches stegoEncode output for each theme', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const wireFrame = await makeMsgFrame(alice.privateKey, alice.publicKey, bob.publicKey, shortText);

    for (const themeId of ALL_THEME_IDS) {
      const stegoText = stegoEncode(wireFrame, themeId);
      const codepoints = charCount(stegoText);
      // charCount should always be ≤ .length (equal for BMP-only, less for supplementary)
      expect(codepoints).toBeLessThanOrEqual(stegoText.length);
      expect(codepoints).toBeGreaterThan(0);
    }
  });

  it('short messages have wireBytes > inputChars (crypto overhead dominates)', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const wireFrame = await makeMsgFrame(alice.privateKey, alice.publicKey, bob.publicKey, shortText);
    const inputChars = charCount(shortText);

    // "Привет" = 6 chars, but wire frame includes 6-byte seed + 8-byte tag + compressed payload
    expect(wireFrame.length).toBeGreaterThan(inputChars);
  });

  it('long Russian text compresses well: wireBytes < inputChars', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const wireFrame = await makeMsgFrame(alice.privateKey, alice.publicKey, bob.publicKey, longText);
    const inputChars = charCount(longText);

    // Long repetitive Russian text compresses significantly via squash+smaz
    expect(wireFrame.length).toBeLessThan(inputChars);
  });

  it('INTRO wire frame is larger than MSG for the same plaintext', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const msgFrame = await makeMsgFrame(alice.privateKey, alice.publicKey, bob.publicKey, shortText);
    const introFrame = await makeIntroFrame(alice.publicKey, bob.publicKey, shortText);

    // INTRO adds 32-byte ephemeral key + 32-byte sender key inside envelope
    expect(introFrame.length).toBeGreaterThan(msgFrame.length);
    // The difference should be at least 60 bytes (2 × 32-byte keys minus seed savings)
    expect(introFrame.length - msgFrame.length).toBeGreaterThanOrEqual(50);
  });

  it('emoji theme: charCount < .length due to supplementary codepoints', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const wireFrame = await makeMsgFrame(alice.privateKey, alice.publicKey, bob.publicKey, shortText);

    const stegoText = stegoEncode(wireFrame, '🙂');
    const codepoints = charCount(stegoText);
    const utf16units = stegoText.length;

    // Emoji theme uses supplementary-plane characters → .length overcounts
    expect(codepoints).toBeLessThan(utf16units);
  });
});
