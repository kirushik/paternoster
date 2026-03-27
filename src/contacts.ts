/**
 * Contact management: CRUD operations with localStorage persistence.
 */

import { u8hex, hexU8, randomHexId } from './utils';
import { STORAGE, storageGet, storageSet } from './storage';

export interface Contact {
  id: string;
  name: string;
  publicKeyHex: string;
  addedAt: number;
  keyExchangeConfirmed: boolean;
}

/** Generate a random contact ID (8 bytes = 16 hex chars). */
function randomId(): string {
  return randomHexId(8);
}

/** Validate that a parsed object has the expected Contact shape. */
function isValidContact(c: unknown): c is Contact {
  if (typeof c !== 'object' || c === null) return false;
  const obj = c as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.publicKeyHex === 'string' &&
    typeof obj.addedAt === 'number' &&
    typeof obj.keyExchangeConfirmed === 'boolean' &&
    /^[0-9A-F]{64}$/.test(obj.publicKeyHex)
  );
}

/** Migrate old contact format (firstMessageSent → keyExchangeConfirmed). */
function migrateContact(obj: Record<string, unknown>): void {
  if ('firstMessageSent' in obj && !('keyExchangeConfirmed' in obj)) {
    // Reset to unconfirmed — we'll re-send keys until we get a reply
    obj.keyExchangeConfirmed = false;
    delete obj.firstMessageSent;
  }
}

/** Load all contacts from localStorage. Filters out malformed entries. */
export function loadContacts(): Contact[] {
  const raw = storageGet(STORAGE.contacts);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Run migration on each entry before validation
    for (const entry of parsed) {
      if (typeof entry === 'object' && entry !== null) {
        migrateContact(entry as Record<string, unknown>);
      }
    }
    const valid = parsed.filter(isValidContact);
    // If migration happened, persist the migrated data
    if (valid.length > 0) {
      storageSet(STORAGE.contacts, JSON.stringify(valid));
    }
    return valid;
  } catch {
    return [];
  }
}

/** Save all contacts to localStorage. */
function saveContacts(contacts: Contact[]): void {
  storageSet(STORAGE.contacts, JSON.stringify(contacts));
}

/** Add a new contact. Returns the created contact. */
export function addContact(name: string, publicKey: Uint8Array): Contact {
  const contacts = loadContacts();
  const contact: Contact = {
    id: randomId(),
    name,
    publicKeyHex: u8hex(publicKey),
    addedAt: Date.now(),
    keyExchangeConfirmed: false,
  };
  contacts.push(contact);
  saveContacts(contacts);
  return contact;
}

/** Find a contact by public key. */
export function findContactByKey(publicKey: Uint8Array): Contact | undefined {
  const hex = u8hex(publicKey);
  return loadContacts().find(c => c.publicKeyHex === hex);
}

/** Remove a contact by ID. */
export function removeContact(id: string): void {
  const contacts = loadContacts().filter(c => c.id !== id);
  saveContacts(contacts);
}

/** Rename a contact. */
export function renameContact(id: string, newName: string): void {
  const contacts = loadContacts();
  const contact = contacts.find(c => c.id === id);
  if (contact) {
    contact.name = newName;
    saveContacts(contacts);
  }
}

/** Mark that key exchange is confirmed with a contact (we received a message from them). */
export function confirmKeyExchange(id: string): void {
  const contacts = loadContacts();
  const contact = contacts.find(c => c.id === id);
  if (contact) {
    contact.keyExchangeConfirmed = true;
    saveContacts(contacts);
  }
}

/** Get a contact's public key as Uint8Array. */
export function getContactKey(contact: Contact): Uint8Array {
  return hexU8(contact.publicKeyHex);
}

/** Get the selected contact ID from localStorage. */
export function getSelectedContactId(): string | null {
  return storageGet(STORAGE.selectedContact);
}

/** Set the selected contact ID in localStorage. */
export function setSelectedContactId(id: string): void {
  storageSet(STORAGE.selectedContact, id);
}
