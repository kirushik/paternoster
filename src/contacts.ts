/**
 * Contact management: CRUD operations with localStorage persistence.
 */

import { u8hex, hexU8 } from './utils';
import { STORAGE, storageGet, storageSet } from './storage';

export interface Contact {
  id: string;
  name: string;
  publicKeyHex: string;
  addedAt: number;
  firstMessageSent: boolean;
}

/** Generate a random ID. */
function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Load all contacts from localStorage. */
export function loadContacts(): Contact[] {
  const raw = storageGet(STORAGE.contacts);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Contact[];
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
    firstMessageSent: false,
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

/** Mark that the first message has been sent to a contact (so sender key won't be included again). */
export function markFirstMessageSent(id: string): void {
  const contacts = loadContacts();
  const contact = contacts.find(c => c.id === id);
  if (contact) {
    contact.firstMessageSent = true;
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
