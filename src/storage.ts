/** Centralized localStorage key management. */

const PREFIX = 'paternoster_';

export const STORAGE = {
  privateKey: PREFIX + 'private_key',
  publicKey: PREFIX + 'public_key',
  contacts: PREFIX + 'contacts',
  selectedTheme: PREFIX + 'theme',
  selectedContact: PREFIX + 'selected_contact',
  seenCopyHint: PREFIX + 'seen_copy_hint',
} as const;

export function storageGet(key: string): string | null {
  return localStorage.getItem(key);
}

export function storageSet(key: string, value: string): void {
  localStorage.setItem(key, value);
}

export function storageRemove(key: string): void {
  localStorage.removeItem(key);
}
