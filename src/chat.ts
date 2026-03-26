/**
 * Session chat history: per-contact message storage in sessionStorage.
 * Messages survive page reloads but are cleared when the tab closes.
 */

import { type ThemeId } from './dictionaries';

export interface ChatMessage {
  id: string;
  direction: 'sent' | 'received';
  plaintext: string;
  encoded: string;
  contactId: string;
  senderName?: string;
  timestamp: number;
  theme: ThemeId;
  /** 'broadcast' for broadcast messages, defaults to 'message' for backward compat. */
  type?: 'message' | 'broadcast';
}

function chatStorageKey(contactId: string): string {
  return `paternoster_chat_${contactId}`;
}

export function loadChat(contactId: string): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(chatStorageKey(contactId));
    if (!raw) return [];
    return JSON.parse(raw);
  } catch { return []; }
}

export function saveChat(contactId: string, messages: ChatMessage[]): void {
  sessionStorage.setItem(chatStorageKey(contactId), JSON.stringify(messages));
}

export function clearChat(contactId: string): void {
  sessionStorage.removeItem(chatStorageKey(contactId));
}

/** Add a message to a contact's chat. Returns { added: true } or { added: false, duplicateId } if deduplicated. */
export function addChatMessage(msg: ChatMessage): { added: true } | { added: false; duplicateId: string } {
  const messages = loadChat(msg.contactId);
  // Deduplicate on ciphertext — same encoded message won't appear twice
  const existing = messages.find(m => m.encoded === msg.encoded);
  if (existing) return { added: false, duplicateId: existing.id };
  messages.push(msg);
  saveChat(msg.contactId, messages);
  return { added: true };
}

export function randomChatId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
