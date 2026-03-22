import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadChat, saveChat, addChatMessage, clearChat, randomChatId, type ChatMessage } from '../../src/chat';

// Mock sessionStorage
const storage = new Map<string, string>();
vi.stubGlobal('sessionStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});

beforeEach(() => {
  storage.clear();
});

function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'test-id',
    direction: 'sent',
    plaintext: 'Привет',
    encoded: ' и раб да ад',
    contactId: 'contact-1',
    timestamp: Date.now(),
    theme: 'БОЖЕ',
    ...overrides,
  };
}

describe('chat storage', () => {
  it('loadChat returns empty array initially', () => {
    expect(loadChat('contact-1')).toEqual([]);
  });

  it('saveChat + loadChat roundtrips', () => {
    const msg = makeMsg();
    saveChat('contact-1', [msg]);
    const loaded = loadChat('contact-1');
    expect(loaded).toHaveLength(1);
    expect(loaded[0].plaintext).toBe('Привет');
  });

  it('chats are stored per contact', () => {
    saveChat('alice', [makeMsg({ contactId: 'alice', plaintext: 'A' })]);
    saveChat('bob', [makeMsg({ contactId: 'bob', plaintext: 'B' })]);

    expect(loadChat('alice')).toHaveLength(1);
    expect(loadChat('alice')[0].plaintext).toBe('A');
    expect(loadChat('bob')).toHaveLength(1);
    expect(loadChat('bob')[0].plaintext).toBe('B');
  });

  it('clearChat removes all messages for a contact', () => {
    addChatMessage(makeMsg({ contactId: 'alice', encoded: 'msg-1' }));
    addChatMessage(makeMsg({ contactId: 'alice', encoded: 'msg-2' }));
    addChatMessage(makeMsg({ contactId: 'bob', encoded: 'msg-3' }));
    expect(loadChat('alice')).toHaveLength(2);

    clearChat('alice');
    expect(loadChat('alice')).toEqual([]);
    // Bob's chat is untouched
    expect(loadChat('bob')).toHaveLength(1);
  });

  it('clearChat on empty chat is a no-op', () => {
    clearChat('nonexistent');
    expect(loadChat('nonexistent')).toEqual([]);
  });

  it('loadChat handles corrupted JSON gracefully', () => {
    storage.set('paternoster_chat_contact-1', 'NOT JSON!!!');
    expect(loadChat('contact-1')).toEqual([]);
  });
});

describe('addChatMessage', () => {
  it('adds a message and returns { added: true }', () => {
    const result = addChatMessage(makeMsg());
    expect(result).toEqual({ added: true });
    expect(loadChat('contact-1')).toHaveLength(1);
  });

  it('appends multiple different messages', () => {
    addChatMessage(makeMsg({ id: '1', encoded: 'encoded-A' }));
    addChatMessage(makeMsg({ id: '2', encoded: 'encoded-B' }));
    addChatMessage(makeMsg({ id: '3', encoded: 'encoded-C' }));
    expect(loadChat('contact-1')).toHaveLength(3);
  });

  it('deduplicates on encoded text — returns duplicateId', () => {
    const msg1 = makeMsg({ id: 'original-id', encoded: 'same-ciphertext' });
    const msg2 = makeMsg({ id: 'new-id', encoded: 'same-ciphertext' });

    expect(addChatMessage(msg1)).toEqual({ added: true });
    const result = addChatMessage(msg2);
    expect(result).toEqual({ added: false, duplicateId: 'original-id' });
    expect(loadChat('contact-1')).toHaveLength(1);
  });

  it('allows same plaintext with different encoded text', () => {
    const msg1 = makeMsg({ id: '1', plaintext: 'Привет', encoded: 'encoded-v1' });
    const msg2 = makeMsg({ id: '2', plaintext: 'Привет', encoded: 'encoded-v2' });

    expect(addChatMessage(msg1)).toEqual({ added: true });
    expect(addChatMessage(msg2)).toEqual({ added: true });
    expect(loadChat('contact-1')).toHaveLength(2);
  });

  it('deduplicates independently per contact', () => {
    const msgAlice = makeMsg({ contactId: 'alice', encoded: 'same-text' });
    const msgBob = makeMsg({ contactId: 'bob', encoded: 'same-text' });

    expect(addChatMessage(msgAlice)).toEqual({ added: true });
    expect(addChatMessage(msgBob)).toEqual({ added: true }); // different contact, not a dup
    expect(loadChat('alice')).toHaveLength(1);
    expect(loadChat('bob')).toHaveLength(1);
  });

  it('deduplicates across sent and received directions', () => {
    const sent = makeMsg({ id: 'sent-id', direction: 'sent', encoded: 'same-cipher' });
    const received = makeMsg({ id: 'recv-id', direction: 'received', encoded: 'same-cipher' });

    expect(addChatMessage(sent)).toEqual({ added: true });
    expect(addChatMessage(received)).toEqual({ added: false, duplicateId: 'sent-id' });
    expect(loadChat('contact-1')).toHaveLength(1);
  });
});

describe('randomChatId', () => {
  it('returns a 12-char hex string', () => {
    const id = randomChatId();
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => randomChatId()));
    expect(ids.size).toBe(100);
  });
});
