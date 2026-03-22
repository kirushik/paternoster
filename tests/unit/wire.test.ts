import { describe, it, expect } from 'vitest';
import { serializeWire, deserializeWire, MSG_NO_SENDER, MSG_WITH_SENDER, CONTACT_TOKEN } from '../../src/wire';

describe('wire format roundtrip', () => {
  it('MSG_NO_SENDER roundtrips', () => {
    const payload = crypto.getRandomValues(new Uint8Array(50));
    const wire = serializeWire({ type: MSG_NO_SENDER, payload });
    const parsed = deserializeWire(wire);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe(MSG_NO_SENDER);
    expect((parsed as any).payload).toEqual(payload);
  });

  it('MSG_WITH_SENDER roundtrips', () => {
    const senderKey = crypto.getRandomValues(new Uint8Array(32));
    const payload = crypto.getRandomValues(new Uint8Array(50));
    const wire = serializeWire({ type: MSG_WITH_SENDER, senderPublicKey: senderKey, payload });
    const parsed = deserializeWire(wire);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe(MSG_WITH_SENDER);
    expect((parsed as any).senderPublicKey).toEqual(senderKey);
    expect((parsed as any).payload).toEqual(payload);
  });

  it('CONTACT_TOKEN roundtrips', () => {
    const pubKey = crypto.getRandomValues(new Uint8Array(32));
    const wire = serializeWire({ type: CONTACT_TOKEN, publicKey: pubKey });
    const parsed = deserializeWire(wire);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe(CONTACT_TOKEN);
    expect((parsed as any).publicKey).toEqual(pubKey);
  });
});

describe('wire format structure', () => {
  it('CONTACT_TOKEN is exactly 33 bytes', () => {
    const wire = serializeWire({ type: CONTACT_TOKEN, publicKey: new Uint8Array(32) });
    expect(wire.length).toBe(33);
    expect(wire[0]).toBe(0x20);
  });

  it('MSG_NO_SENDER starts with 0x10', () => {
    const wire = serializeWire({ type: MSG_NO_SENDER, payload: new Uint8Array(20) });
    expect(wire[0]).toBe(0x10);
    expect(wire.length).toBe(21); // 1 type + 20 payload
  });

  it('MSG_WITH_SENDER starts with 0x11, includes 32-byte key', () => {
    const key = new Uint8Array(32).fill(0xAB);
    const wire = serializeWire({ type: MSG_WITH_SENDER, senderPublicKey: key, payload: new Uint8Array(20) });
    expect(wire[0]).toBe(0x11);
    expect(wire.length).toBe(53); // 1 + 32 + 20
    expect(wire.slice(1, 33)).toEqual(key);
  });
});

describe('wire deserialization rejects invalid input', () => {
  it('returns null for empty data', () => {
    expect(deserializeWire(new Uint8Array([]))).toBeNull();
  });

  it('returns null for single byte', () => {
    expect(deserializeWire(new Uint8Array([0x10]))).toBeNull();
  });

  it('returns null for unknown type', () => {
    expect(deserializeWire(new Uint8Array([0x99, 0x00, 0x00]))).toBeNull();
  });

  it('returns null for too-short CONTACT_TOKEN', () => {
    expect(deserializeWire(new Uint8Array([0x20, 0x01, 0x02]))).toBeNull();
  });

  it('returns null for too-short MSG_WITH_SENDER', () => {
    // Type + 10 bytes (need at least 32 key + 12 IV + 1 ciphertext)
    expect(deserializeWire(new Uint8Array(11).fill(0x11))).toBeNull();
  });
});
