/**
 * Multi-turn conversation protocol tests.
 *
 * These test the crypto protocol at the integration level (no DOM)
 * to serve as a safety net for refactoring. Each test simulates
 * a realistic conversation scenario through the full
 * encrypt → wire → stego → wire → decrypt pipeline.
 */
import { describe, it, expect } from 'vitest';
import {
  generateKeyPair, encrypt, decrypt, encryptIntro, decryptIntro,
  directionByte, seedCompMode, CLASS_MSG,
} from '../../src/crypto';
import { compress, decompress } from '../../src/compress';
import { stegoEncode, stegoDecode } from '../../src/stego';
import { serializeMsg, serializeIntro, couldBeMsg, couldBeIntro, splitIntro } from '../../src/wire';
import { concatU8 } from '../../src/utils';
import { type Identity } from '../helpers';

// ── Helpers ──────────────────────────────────────────────

/** Simulate sending an INTRO (first contact, pre-kex). */
async function sendIntro(
  sender: Identity,
  recipientPub: Uint8Array,
  plaintext: string,
  theme = 'hex' as const,
): Promise<string> {
  const { payload: compressed, compMode } = compress(plaintext);
  const eph = await generateKeyPair();
  const introPayload = concatU8(
    new Uint8Array([compMode]),
    sender.publicKey,
    compressed,
  );
  const encrypted = await encryptIntro(
    introPayload, eph.privateKey, recipientPub,
    eph.publicKey, recipientPub,
  );
  const wire = serializeIntro(eph.publicKey, encrypted);
  return stegoEncode(wire, theme);
}

/** Simulate sending a MSG (post-kex). */
async function sendMsg(
  sender: Identity,
  recipientPub: Uint8Array,
  plaintext: string,
  theme = 'hex' as const,
): Promise<string> {
  const { payload: compressed, compMode } = compress(plaintext);
  const encrypted = await encrypt(
    compressed, sender.privateKey, recipientPub,
    sender.publicKey, recipientPub, CLASS_MSG, compMode,
  );
  const wire = serializeMsg(encrypted);
  return stegoEncode(wire, theme);
}

interface DecodedIntro {
  senderPub: Uint8Array;
  plaintext: string;
}

/** Simulate receiving and decrypting an INTRO. */
async function receiveIntro(
  recipient: Identity,
  stegoText: string,
): Promise<DecodedIntro> {
  const decoded = stegoDecode(stegoText);
  expect(decoded).not.toBeNull();
  expect(couldBeIntro(decoded!.bytes)).toBe(true);

  const { ephPub, payload } = splitIntro(decoded!.bytes);
  const decrypted = await decryptIntro(
    payload, recipient.privateKey, ephPub,
    ephPub, recipient.publicKey,
  );
  expect(decrypted.length).toBeGreaterThanOrEqual(34);

  const compMode = decrypted[0];
  const senderPub = decrypted.slice(1, 33);
  const plaintext = decompress(decrypted.slice(33), compMode);
  return { senderPub, plaintext };
}

/** Simulate receiving and decrypting a MSG from a known contact. */
async function receiveMsg(
  recipient: Identity,
  senderPub: Uint8Array,
  stegoText: string,
): Promise<string> {
  const decoded = stegoDecode(stegoText);
  expect(decoded).not.toBeNull();
  expect(couldBeMsg(decoded!.bytes)).toBe(true);

  const bytes = decoded!.bytes;
  const decrypted = await decrypt(
    bytes, recipient.privateKey, senderPub,
    senderPub, recipient.publicKey, CLASS_MSG,
  );
  const compMode = seedCompMode(bytes[0]);
  return decompress(decrypted, compMode);
}

// ── Tests ────────────────────────────────────────────────

describe('standard key exchange flow (INTRO → MSG → MSG → MSG)', () => {
  it('full 4-message conversation decrypts correctly in both directions', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    // 1. Alice→Bob: INTRO (first contact)
    const stego1 = await sendIntro(alice, bob.publicKey, 'Привет, Боб!');
    const recv1 = await receiveIntro(bob, stego1);
    expect(recv1.plaintext).toBe('Привет, Боб!');
    expect(recv1.senderPub).toEqual(alice.publicKey);

    // 2. Bob→Alice: MSG reply (Bob now knows Alice's key)
    const stego2 = await sendMsg(bob, alice.publicKey, 'Привет, Алиса!');
    const recv2 = await receiveMsg(alice, bob.publicKey, stego2);
    expect(recv2).toBe('Привет, Алиса!');

    // 3. Alice→Bob: MSG (kex confirmed both sides)
    const stego3 = await sendMsg(alice, bob.publicKey, 'Как дела?');
    const recv3 = await receiveMsg(bob, alice.publicKey, stego3);
    expect(recv3).toBe('Как дела?');

    // 4. Bob→Alice: MSG
    const stego4 = await sendMsg(bob, alice.publicKey, 'Хорошо!');
    const recv4 = await receiveMsg(alice, bob.publicKey, stego4);
    expect(recv4).toBe('Хорошо!');
  });

  it('6-message conversation with varied content', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const messages = [
      { from: 'alice', text: 'Добрый день!' },
      { from: 'bob', text: 'Здравствуйте!' },
      { from: 'alice', text: 'Как у вас погода?' },
      { from: 'bob', text: 'Солнечно и тепло, 25 градусов!' },
      { from: 'alice', text: 'У нас дождь 🌧️' },
      { from: 'bob', text: 'Передаю вам солнце ☀️' },
    ];

    // First message is INTRO
    const stego0 = await sendIntro(alice, bob.publicKey, messages[0].text);
    const recv0 = await receiveIntro(bob, stego0);
    expect(recv0.plaintext).toBe(messages[0].text);

    // Remaining messages are MSG
    for (let i = 1; i < messages.length; i++) {
      const m = messages[i];
      const sender = m.from === 'alice' ? alice : bob;
      const recipientPub = m.from === 'alice' ? bob.publicKey : alice.publicKey;
      const recipient = m.from === 'alice' ? bob : alice;
      const senderPub = m.from === 'alice' ? alice.publicKey : bob.publicKey;

      const stego = await sendMsg(sender, recipientPub, m.text);
      const recv = await receiveMsg(recipient, senderPub, stego);
      expect(recv).toBe(m.text);
    }
  });
});

describe('simultaneous INTRO exchange (both sides send INTRO)', () => {
  it('both INTROs decrypt correctly and MSG works after', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    // Both send INTRO to each other before processing the other's
    const stegoAlice = await sendIntro(alice, bob.publicKey, 'Привет от Алисы');
    const stegoBob = await sendIntro(bob, alice.publicKey, 'Привет от Боба');

    // Bob receives Alice's INTRO
    const recvAlice = await receiveIntro(bob, stegoAlice);
    expect(recvAlice.plaintext).toBe('Привет от Алисы');
    expect(recvAlice.senderPub).toEqual(alice.publicKey);

    // Alice receives Bob's INTRO
    const recvBob = await receiveIntro(alice, stegoBob);
    expect(recvBob.plaintext).toBe('Привет от Боба');
    expect(recvBob.senderPub).toEqual(bob.publicKey);

    // Now both sides switch to MSG — should work in both directions
    const stego3 = await sendMsg(alice, bob.publicKey, 'MSG от Алисы');
    expect(await receiveMsg(bob, alice.publicKey, stego3)).toBe('MSG от Алисы');

    const stego4 = await sendMsg(bob, alice.publicKey, 'MSG от Боба');
    expect(await receiveMsg(alice, bob.publicKey, stego4)).toBe('MSG от Боба');
  });
});

describe('MSG to unconfirmed contact', () => {
  it('MSG decrypts even if recipient has not yet confirmed kex', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    // Scenario: Alice has Bob's key and her kex is "confirmed" (she sends MSG).
    // Bob also has Alice's key but his kex is "unconfirmed".
    // Alice sends MSG directly (skipping INTRO).
    // Bob should still be able to decrypt it.

    const stego = await sendMsg(alice, bob.publicKey, 'MSG без INTRO');
    const plaintext = await receiveMsg(bob, alice.publicKey, stego);
    expect(plaintext).toBe('MSG без INTRO');
  });

  it('both sides can send MSG without any INTRO at all', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    // Both sides have each other's key (e.g. via invite token exchange)
    // Both skip INTRO entirely
    const stego1 = await sendMsg(alice, bob.publicKey, 'Первое от Алисы');
    expect(await receiveMsg(bob, alice.publicKey, stego1)).toBe('Первое от Алисы');

    const stego2 = await sendMsg(bob, alice.publicKey, 'Первое от Боба');
    expect(await receiveMsg(alice, bob.publicKey, stego2)).toBe('Первое от Боба');
  });
});

describe('late INTRO after key exchange confirmed', () => {
  it('old INTRO still decrypts after MSG exchange', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    // Full kex: INTRO + MSG reply
    const intro = await sendIntro(alice, bob.publicKey, 'Первое сообщение');
    const recvIntro = await receiveIntro(bob, intro);
    expect(recvIntro.plaintext).toBe('Первое сообщение');

    const reply = await sendMsg(bob, alice.publicKey, 'Ответ');
    expect(await receiveMsg(alice, bob.publicKey, reply)).toBe('Ответ');

    // Exchange more MSGs
    const msg3 = await sendMsg(alice, bob.publicKey, 'Третье');
    expect(await receiveMsg(bob, alice.publicKey, msg3)).toBe('Третье');

    // Now Alice re-sends her original INTRO (re-paste of old message)
    // Bob should still be able to decrypt it
    const recvAgain = await receiveIntro(bob, intro);
    expect(recvAgain.plaintext).toBe('Первое сообщение');
    expect(recvAgain.senderPub).toEqual(alice.publicKey);
  });

  it('INTRO sent after MSG exchange still works', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    // MSG exchange first (both sides know each other)
    const msg1 = await sendMsg(alice, bob.publicKey, 'Привет');
    expect(await receiveMsg(bob, alice.publicKey, msg1)).toBe('Привет');

    // Alice then sends an INTRO (e.g. from a different device or app restart)
    const intro = await sendIntro(alice, bob.publicKey, 'Привет снова');
    const recv = await receiveIntro(bob, intro);
    expect(recv.plaintext).toBe('Привет снова');
    expect(recv.senderPub).toEqual(alice.publicKey);
  });
});

describe('multiple contacts interleaved', () => {
  it('messages from Bob and Carol decrypt with correct keys', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const carol = await generateKeyPair();

    // Bob sends INTRO to Alice
    const fromBob = await sendIntro(bob, alice.publicKey, 'Привет от Боба');
    const recvBob = await receiveIntro(alice, fromBob);
    expect(recvBob.plaintext).toBe('Привет от Боба');
    expect(recvBob.senderPub).toEqual(bob.publicKey);

    // Carol sends INTRO to Alice
    const fromCarol = await sendIntro(carol, alice.publicKey, 'Привет от Кэрол');
    const recvCarol = await receiveIntro(alice, fromCarol);
    expect(recvCarol.plaintext).toBe('Привет от Кэрол');
    expect(recvCarol.senderPub).toEqual(carol.publicKey);

    // Alice replies to both via MSG
    const toBob = await sendMsg(alice, bob.publicKey, 'Ответ Бобу');
    expect(await receiveMsg(bob, alice.publicKey, toBob)).toBe('Ответ Бобу');

    const toCarol = await sendMsg(alice, carol.publicKey, 'Ответ Кэрол');
    expect(await receiveMsg(carol, alice.publicKey, toCarol)).toBe('Ответ Кэрол');

    // Interleaved MSGs from both
    const msg3 = await sendMsg(bob, alice.publicKey, 'Боб: 2');
    const msg4 = await sendMsg(carol, alice.publicKey, 'Кэрол: 2');
    const msg5 = await sendMsg(bob, alice.publicKey, 'Боб: 3');

    expect(await receiveMsg(alice, bob.publicKey, msg3)).toBe('Боб: 2');
    expect(await receiveMsg(alice, carol.publicKey, msg4)).toBe('Кэрол: 2');
    expect(await receiveMsg(alice, bob.publicKey, msg5)).toBe('Боб: 3');
  });

  it('MSG for Bob cannot decrypt with Carol key', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const carol = await generateKeyPair();

    const toBob = await sendMsg(alice, bob.publicKey, 'Секрет');
    const decoded = stegoDecode(toBob)!;

    // Trying Carol's key should fail
    await expect(
      decrypt(decoded.bytes, carol.privateKey, alice.publicKey,
        alice.publicKey, carol.publicKey, CLASS_MSG),
    ).rejects.toThrow();
  });
});

describe('self-encryption', () => {
  it('encrypt and decrypt with own key', async () => {
    const alice = await generateKeyPair();

    const stego = await sendMsg(alice, alice.publicKey, 'Записка для себя');
    const plaintext = await receiveMsg(alice, alice.publicKey, stego);
    expect(plaintext).toBe('Записка для себя');
  });

  it('self-INTRO roundtrips', async () => {
    const alice = await generateKeyPair();

    const stego = await sendIntro(alice, alice.publicKey, 'INTRO себе');
    const recv = await receiveIntro(alice, stego);
    expect(recv.plaintext).toBe('INTRO себе');
    expect(recv.senderPub).toEqual(alice.publicKey);
  });
});

describe('direction byte antisymmetry', () => {
  it('Alice→Bob and Bob→Alice same plaintext produce different ciphertext', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    // Skip if keys happen to be equal (astronomically unlikely)
    const dir = directionByte(alice.publicKey, bob.publicKey);
    const reverseDir = directionByte(bob.publicKey, alice.publicKey);
    expect(dir).not.toBe(reverseDir);

    const text = 'Одинаковый текст';
    const stegoAB = await sendMsg(alice, bob.publicKey, text);
    const stegoBA = await sendMsg(bob, alice.publicKey, text);

    // Different stego output (different ciphertext under different direction bytes)
    const decodedAB = stegoDecode(stegoAB)!;
    const decodedBA = stegoDecode(stegoBA)!;
    expect(decodedAB.bytes).not.toEqual(decodedBA.bytes);

    // But both decrypt correctly to the same plaintext
    expect(await receiveMsg(bob, alice.publicKey, stegoAB)).toBe(text);
    expect(await receiveMsg(alice, bob.publicKey, stegoBA)).toBe(text);
  });
});

describe('seed uniqueness', () => {
  it('same plaintext same direction produces different ciphertext each time', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const text = 'Повтор';
    const stego1 = await sendMsg(alice, bob.publicKey, text);
    const stego2 = await sendMsg(alice, bob.publicKey, text);
    const stego3 = await sendMsg(alice, bob.publicKey, text);

    const decoded1 = stegoDecode(stego1)!;
    const decoded2 = stegoDecode(stego2)!;
    const decoded3 = stegoDecode(stego3)!;

    // All different ciphertext (different random seeds)
    expect(decoded1.bytes).not.toEqual(decoded2.bytes);
    expect(decoded2.bytes).not.toEqual(decoded3.bytes);

    // All decrypt to same plaintext
    expect(await receiveMsg(bob, alice.publicKey, stego1)).toBe(text);
    expect(await receiveMsg(bob, alice.publicKey, stego2)).toBe(text);
    expect(await receiveMsg(bob, alice.publicKey, stego3)).toBe(text);
  });

  it('INTRO to same recipient produces different ciphertext (different ephemeral keys)', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const text = 'Повторный INTRO';
    const stego1 = await sendIntro(alice, bob.publicKey, text);
    const stego2 = await sendIntro(alice, bob.publicKey, text);

    const decoded1 = stegoDecode(stego1)!;
    const decoded2 = stegoDecode(stego2)!;
    expect(decoded1.bytes).not.toEqual(decoded2.bytes);

    // Both decrypt correctly
    const recv1 = await receiveIntro(bob, stego1);
    const recv2 = await receiveIntro(bob, stego2);
    expect(recv1.plaintext).toBe(text);
    expect(recv2.plaintext).toBe(text);
  });
});

describe('mixed compression modes in conversation', () => {
  it('short and long messages in same conversation all decrypt', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const messages = [
      'Да',                                           // very short → likely literal
      'Привет, как дела? Надеюсь всё хорошо!',       // medium → likely squash+smaz
      'the quick brown fox jumps over the lazy dog '.repeat(10), // long English → squash+smaz
      'X',                                             // single char
      'Длинное русское сообщение, которое содержит много слов и должно хорошо сжиматься при помощи алгоритма smaz потому что в нём много повторяющихся паттернов',
    ];

    // INTRO for first message
    const intro = await sendIntro(alice, bob.publicKey, messages[0]);
    const recvIntro = await receiveIntro(bob, intro);
    expect(recvIntro.plaintext).toBe(messages[0]);

    // MSG for remaining
    for (let i = 1; i < messages.length; i++) {
      const sender = i % 2 === 0 ? alice : bob;
      const recipientPub = i % 2 === 0 ? bob.publicKey : alice.publicKey;
      const recipient = i % 2 === 0 ? bob : alice;
      const senderPub = i % 2 === 0 ? alice.publicKey : bob.publicKey;

      const stego = await sendMsg(sender, recipientPub, messages[i]);
      const recv = await receiveMsg(recipient, senderPub, stego);
      expect(recv).toBe(messages[i]);
    }
  });
});

describe('wrong key always fails', () => {
  it('MSG from Alice to Bob fails with random third-party key', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const eve = await generateKeyPair();

    const stego = await sendMsg(alice, bob.publicKey, 'Секретное сообщение');
    const decoded = stegoDecode(stego)!;

    // Eve cannot decrypt (wrong ECDH shared secret)
    await expect(
      decrypt(decoded.bytes, eve.privateKey, alice.publicKey,
        alice.publicKey, eve.publicKey, CLASS_MSG),
    ).rejects.toThrow();

    // Bob with wrong sender key also fails (wrong direction byte)
    await expect(
      decrypt(decoded.bytes, bob.privateKey, eve.publicKey,
        eve.publicKey, bob.publicKey, CLASS_MSG),
    ).rejects.toThrow();
  });

  it('INTRO fails with wrong recipient key', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const eve = await generateKeyPair();

    const stego = await sendIntro(alice, bob.publicKey, 'Для Боба');
    const decoded = stegoDecode(stego)!;
    const { ephPub, payload } = splitIntro(decoded.bytes);

    // Eve cannot decrypt
    await expect(
      decryptIntro(payload, eve.privateKey, ephPub, ephPub, eve.publicKey),
    ).rejects.toThrow();
  });
});

describe('stego theme independence', () => {
  it('same conversation roundtrips through different themes per message', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const themes = ['БОЖЕ', 'РОССИЯ', 'КИТАЙ', 'PATER', '🙂', 'hex'] as const;

    const intro = await sendIntro(alice, bob.publicKey, 'Тема 1', themes[0]);
    const recvIntro = await receiveIntro(bob, intro);
    expect(recvIntro.plaintext).toBe('Тема 1');

    for (let i = 1; i < themes.length; i++) {
      const sender = i % 2 === 0 ? alice : bob;
      const recipientPub = i % 2 === 0 ? bob.publicKey : alice.publicKey;
      const recipient = i % 2 === 0 ? bob : alice;
      const senderPub = i % 2 === 0 ? alice.publicKey : bob.publicKey;
      const text = `Тема ${i + 1}`;

      const stego = await sendMsg(sender, recipientPub, text, themes[i]);
      const recv = await receiveMsg(recipient, senderPub, stego);
      expect(recv).toBe(text);
    }
  });
});
