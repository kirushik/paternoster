import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadContacts, addContact, findContactByKey, removeContact, renameContact, confirmKeyExchange, getContactKey } from '../../src/contacts';

// Mock localStorage
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});

beforeEach(() => {
  storage.clear();
});

describe('contacts CRUD', () => {
  it('loadContacts returns empty array initially', () => {
    expect(loadContacts()).toEqual([]);
  });

  it('addContact creates and persists', () => {
    const key = new Uint8Array(32).fill(0xAB);
    const contact = addContact('Alice', key);
    expect(contact.name).toBe('Alice');
    expect(contact.publicKeyHex).toBe('AB'.repeat(32));
    expect(contact.keyExchangeConfirmed).toBe(false);
    expect(contact.id).toMatch(/^[0-9a-f]{16}$/);

    const loaded = loadContacts();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('Alice');
  });

  it('findContactByKey finds existing', () => {
    const key = new Uint8Array(32).fill(0xCD);
    addContact('Bob', key);
    const found = findContactByKey(key);
    expect(found).not.toBeUndefined();
    expect(found!.name).toBe('Bob');
  });

  it('findContactByKey returns undefined for unknown', () => {
    expect(findContactByKey(new Uint8Array(32))).toBeUndefined();
  });

  it('removeContact removes correct one', () => {
    const key1 = new Uint8Array(32).fill(0x01);
    const key2 = new Uint8Array(32).fill(0x02);
    const c1 = addContact('Alice', key1);
    addContact('Bob', key2);

    removeContact(c1.id);
    const remaining = loadContacts();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].name).toBe('Bob');
  });

  it('renameContact updates name', () => {
    const key = new Uint8Array(32).fill(0x03);
    const contact = addContact('Old Name', key);
    renameContact(contact.id, 'New Name');

    const loaded = loadContacts();
    expect(loaded[0].name).toBe('New Name');
  });

  it('confirmKeyExchange sets flag', () => {
    const key = new Uint8Array(32).fill(0x04);
    const contact = addContact('Charlie', key);
    expect(contact.keyExchangeConfirmed).toBe(false);

    confirmKeyExchange(contact.id);
    const loaded = loadContacts();
    expect(loaded[0].keyExchangeConfirmed).toBe(true);
  });

  it('getContactKey returns Uint8Array', () => {
    const key = new Uint8Array(32).fill(0x05);
    const contact = addContact('Dave', key);
    expect(getContactKey(contact)).toEqual(key);
  });
});

describe('contacts migration', () => {
  it('migrates firstMessageSent to keyExchangeConfirmed (reset to false)', () => {
    const oldContact = {
      id: 'abc123def456abcd',
      name: 'OldAlice',
      publicKeyHex: 'AB'.repeat(32),
      addedAt: 1000,
      firstMessageSent: true,
    };
    storage.set('paternoster_contacts', JSON.stringify([oldContact]));
    const loaded = loadContacts();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].keyExchangeConfirmed).toBe(false);
    expect((loaded[0] as any).firstMessageSent).toBeUndefined();
  });

  it('migrates firstMessageSent=false to keyExchangeConfirmed=false', () => {
    const oldContact = {
      id: 'abc123def456abcd',
      name: 'OldBob',
      publicKeyHex: 'CD'.repeat(32),
      addedAt: 2000,
      firstMessageSent: false,
    };
    storage.set('paternoster_contacts', JSON.stringify([oldContact]));
    const loaded = loadContacts();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].keyExchangeConfirmed).toBe(false);
  });
});

describe('contacts edge cases', () => {
  it('handles corrupted JSON gracefully', () => {
    storage.set('paternoster_contacts', 'NOT JSON!!!');
    expect(loadContacts()).toEqual([]);
  });

  it('allows duplicate keys (current behavior)', () => {
    const key = new Uint8Array(32).fill(0xFF);
    addContact('Alice', key);
    addContact('Alice2', key);
    expect(loadContacts()).toHaveLength(2);
  });

  it('multiple add/remove cycles', () => {
    const key1 = new Uint8Array(32).fill(0x10);
    const key2 = new Uint8Array(32).fill(0x20);
    const c1 = addContact('A', key1);
    const c2 = addContact('B', key2);
    removeContact(c1.id);
    addContact('C', key1);

    const contacts = loadContacts();
    expect(contacts).toHaveLength(2);
    expect(contacts.map(c => c.name).sort()).toEqual(['B', 'C']);
  });
});

describe('contact schema validation', () => {
  it('filters out non-object entries', () => {
    storage.set('paternoster_contacts', '[1, "string", null, true]');
    expect(loadContacts()).toEqual([]);
  });

  it('filters out entries missing required fields', () => {
    storage.set('paternoster_contacts', JSON.stringify([
      { id: 'abc' },
      { id: 'def', name: 'No Key' },
    ]));
    expect(loadContacts()).toEqual([]);
  });

  it('filters out entries with invalid publicKeyHex', () => {
    storage.set('paternoster_contacts', JSON.stringify([
      { id: 'abc', name: 'Short Hex', publicKeyHex: 'ABCD', addedAt: 0, keyExchangeConfirmed: false },
      { id: 'def', name: 'Lowercase', publicKeyHex: 'ab'.repeat(32), addedAt: 0, keyExchangeConfirmed: false },
      { id: 'ghi', name: 'Non-hex', publicKeyHex: 'ZZ'.repeat(32), addedAt: 0, keyExchangeConfirmed: false },
    ]));
    expect(loadContacts()).toEqual([]);
  });

  it('filters out entries with wrong field types', () => {
    storage.set('paternoster_contacts', JSON.stringify([
      { id: 123, name: 'Bad Id', publicKeyHex: 'AB'.repeat(32), addedAt: 0, keyExchangeConfirmed: false },
      { id: 'abc', name: 'Bad Flag', publicKeyHex: 'AB'.repeat(32), addedAt: 0, keyExchangeConfirmed: 'yes' },
    ]));
    expect(loadContacts()).toEqual([]);
  });

  it('keeps valid entries alongside invalid ones', () => {
    const valid = { id: 'abc123def456abcd', name: 'Alice', publicKeyHex: 'AB'.repeat(32), addedAt: 1000, keyExchangeConfirmed: false };
    storage.set('paternoster_contacts', JSON.stringify([
      { id: 'bad' },
      valid,
      null,
    ]));
    const loaded = loadContacts();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('Alice');
  });

  it('returns empty for non-array JSON', () => {
    storage.set('paternoster_contacts', '{"not": "array"}');
    expect(loadContacts()).toEqual([]);
  });
});
