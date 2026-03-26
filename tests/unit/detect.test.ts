/**
 * Tests for the frame classification pipeline (detect.ts).
 *
 * These test the auto-detection logic that was previously buried inside main.ts,
 * covering the trial-decryption order, frame type discrimination, and edge cases.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyFrame,
  classifyFrameBroadcastMode,
  type KnownKey,
} from '../../src/detect';
import { generateKeyPair } from '../../src/crypto';
import { compress } from '../../src/compress';
import { serializeContact } from '../../src/wire';
import {
  serializeBroadcastSigned,
  serializeBroadcastUnsigned,
} from '../../src/broadcast';
import { makeMsgFrame, makeIntroFrame } from '../helpers';

// ── Regular mode classification ──────────────────────────

describe('classifyFrame (regular mode)', () => {
  it('classifies MSG from known contact', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const frame = await makeMsgFrame(alice.privateKey, alice.publicKey, bob.publicKey, 'Привет');
    const knownKeys: KnownKey[] = [{ name: 'Alice', key: alice.publicKey, contactId: 'alice-1' }];

    const result = await classifyFrame(frame, bob.privateKey, bob.publicKey, knownKeys);
    expect(result.type).toBe('msg');
    if (result.type === 'msg') {
      expect(result.plaintext).toBe('Привет');
      expect(result.senderName).toBe('Alice');
      expect(result.contactId).toBe('alice-1');
    }
  });

  it('classifies MSG self-encrypted', async () => {
    const alice = await generateKeyPair();
    const frame = await makeMsgFrame(alice.privateKey, alice.publicKey, alice.publicKey, 'Заметка');

    const result = await classifyFrame(frame, alice.privateKey, alice.publicKey, []);
    expect(result.type).toBe('msg');
    if (result.type === 'msg') {
      expect(result.plaintext).toBe('Заметка');
      expect(result.senderName).toBe('Я');
    }
  });

  it('classifies INTRO from unknown sender', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const frame = await makeIntroFrame(alice.publicKey, bob.publicKey, 'Первое сообщение');

    const result = await classifyFrame(frame, bob.privateKey, bob.publicKey, []);
    expect(result.type).toBe('intro');
    if (result.type === 'intro') {
      expect(result.plaintext).toBe('Первое сообщение');
      expect(result.senderPub).toEqual(alice.publicKey);
    }
  });

  it('classifies CONTACT frame', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const frame = await serializeContact(alice.publicKey);

    const result = await classifyFrame(frame, bob.privateKey, bob.publicKey, []);
    expect(result.type).toBe('contact');
    if (result.type === 'contact') {
      expect(result.publicKey).toEqual(alice.publicKey);
    }
  });

  it('classifies BROADCAST_SIGNED as verified', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const { payload, compMode } = compress('Всем привет');
    const frame = await serializeBroadcastSigned(payload, compMode, alice.publicKey, alice.privateKey);

    const knownKeys: KnownKey[] = [{ name: 'Alice', key: alice.publicKey }];
    const result = await classifyFrame(frame, bob.privateKey, bob.publicKey, knownKeys);
    expect(result.type).toBe('broadcast_signed');
    if (result.type === 'broadcast_signed') {
      expect(result.plaintext).toBe('Всем привет');
      expect(result.status).toBe('verified');
      expect(result.x25519Pub).toEqual(alice.publicKey);
    }
  });

  it('classifies BROADCAST_SIGNED as unverified when sender unknown', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const { payload, compMode } = compress('Кто я?');
    const frame = await serializeBroadcastSigned(payload, compMode, alice.publicKey, alice.privateKey);

    const result = await classifyFrame(frame, bob.privateKey, bob.publicKey, []);
    expect(result.type).toBe('broadcast_signed');
    if (result.type === 'broadcast_signed') {
      expect(result.plaintext).toBe('Кто я?');
      expect(result.status).toBe('unverified');
    }
  });

  it('classifies BROADCAST_UNSIGNED', async () => {
    const bob = await generateKeyPair();
    const { payload, compMode } = compress('Анонимка');
    const frame = await serializeBroadcastUnsigned(payload, compMode);

    const result = await classifyFrame(frame, bob.privateKey, bob.publicKey, []);
    expect(result.type).toBe('broadcast_unsigned');
    if (result.type === 'broadcast_unsigned') {
      expect(result.plaintext).toBe('Анонимка');
    }
  });

  it('returns unknown for random bytes', async () => {
    const bob = await generateKeyPair();
    const garbage = crypto.getRandomValues(new Uint8Array(50));

    const result = await classifyFrame(garbage, bob.privateKey, bob.publicKey, []);
    expect(result.type).toBe('unknown');
  });

  it('returns unknown for empty bytes', async () => {
    const bob = await generateKeyPair();
    const result = await classifyFrame(new Uint8Array(0), bob.privateKey, bob.publicKey, []);
    expect(result.type).toBe('unknown');
  });

  it('MSG from wrong key is not classified as msg', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const eve = await generateKeyPair();

    // Alice sends to Bob, but Eve tries to classify
    const frame = await makeMsgFrame(alice.privateKey, alice.publicKey, bob.publicKey, 'Secret');
    const result = await classifyFrame(frame, eve.privateKey, eve.publicKey, [
      { name: 'Alice', key: alice.publicKey },
    ]);
    // Should not be 'msg' — Eve can't decrypt
    expect(result.type).not.toBe('msg');
  });

  it('prefers MSG over INTRO when both could match (MSG tried first)', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    // Create a valid MSG frame — it's also large enough to pass couldBeIntro
    const frame = await makeMsgFrame(alice.privateKey, alice.publicKey, bob.publicKey, 'Длинное сообщение для теста');
    const knownKeys: KnownKey[] = [{ name: 'Alice', key: alice.publicKey }];

    const result = await classifyFrame(frame, bob.privateKey, bob.publicKey, knownKeys);
    // MSG is tried before INTRO, so should be classified as MSG
    expect(result.type).toBe('msg');
  });
});

// ── Broadcast mode classification ────────────────────────

describe('classifyFrameBroadcastMode', () => {
  it('classifies signed broadcast (stays in broadcast mode)', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const { payload, compMode } = compress('Публикация');
    const frame = await serializeBroadcastSigned(payload, compMode, alice.publicKey, alice.privateKey);
    const knownKeys: KnownKey[] = [{ name: 'Alice', key: alice.publicKey }];

    const result = await classifyFrameBroadcastMode(frame, bob.privateKey, bob.publicKey, knownKeys);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('broadcast_signed');
  });

  it('classifies unsigned broadcast (stays in broadcast mode)', async () => {
    const bob = await generateKeyPair();
    const { payload, compMode } = compress('Анонимная');
    const frame = await serializeBroadcastUnsigned(payload, compMode);

    const result = await classifyFrameBroadcastMode(frame, bob.privateKey, bob.publicKey, []);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('broadcast_unsigned');
  });

  it('classifies MSG (triggers exit from broadcast mode)', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const frame = await makeMsgFrame(alice.privateKey, alice.publicKey, bob.publicKey, 'P2P');
    const knownKeys: KnownKey[] = [{ name: 'Alice', key: alice.publicKey }];

    const result = await classifyFrameBroadcastMode(frame, bob.privateKey, bob.publicKey, knownKeys);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('msg');
  });

  it('classifies CONTACT (triggers exit from broadcast mode)', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const frame = await serializeContact(alice.publicKey);

    const result = await classifyFrameBroadcastMode(frame, bob.privateKey, bob.publicKey, []);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('contact');
  });

  it('returns null for unrecognized bytes', async () => {
    const bob = await generateKeyPair();
    const garbage = crypto.getRandomValues(new Uint8Array(50));

    const result = await classifyFrameBroadcastMode(garbage, bob.privateKey, bob.publicKey, []);
    expect(result).toBeNull();
  });

  it('broadcast mode tries broadcast BEFORE P2P (different order than regular)', async () => {
    // This test verifies the priority difference between regular and broadcast mode.
    // A signed broadcast should be detected as broadcast_signed in broadcast mode,
    // even if it could technically pass couldBeMsg size check.
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const { payload, compMode } = compress('Priority test');
    const frame = await serializeBroadcastSigned(payload, compMode, alice.publicKey, alice.privateKey);
    const knownKeys: KnownKey[] = [{ name: 'Alice', key: alice.publicKey }];

    const regular = await classifyFrame(frame, bob.privateKey, bob.publicKey, knownKeys);
    const broadcast = await classifyFrameBroadcastMode(frame, bob.privateKey, bob.publicKey, knownKeys);

    // Both should recognize it as broadcast_signed (since it IS a broadcast)
    expect(regular.type).toBe('broadcast_signed');
    expect(broadcast!.type).toBe('broadcast_signed');
  });
});
