import './style.css';
import { checkX25519Support, generateKeyPair, encrypt, decrypt } from './crypto';
import { compress, decompress } from './compress';
import { stegoEncode, stegoDecode } from './stego';
import { serializeWire, deserializeWire, MSG_NO_SENDER, MSG_WITH_SENDER, CONTACT_TOKEN } from './wire';
import { type ThemeId, THEMES } from './dictionaries';
import { STORAGE, storageGet, storageSet } from './storage';
import { u8hex, hexU8, u8eq, u8toBase64url, base64urlToU8 } from './utils';
import {
  type Contact,
  loadContacts,
  addContact,
  findContactByKey,
  removeContact,
  markFirstMessageSent,
  getContactKey,
  getSelectedContactId,
  setSelectedContactId,
} from './contacts';
import { speak, stopSpeaking, isSpeaking } from './tts';

// ── State ───────────────────────────────────────────────

let myPrivateKey: Uint8Array;
let myPublicKey: Uint8Array;
let contacts: Contact[] = [];
let selectedContactId: string | null = null;
let selectedTheme: ThemeId = 'БОЖЕ';
let isDecodeMode = false;
let lastDecodedSender: string | null = null;

// ── DOM refs ────────────────────────────────────────────

const $ = (id: string) => document.getElementById(id)!;
let inputEl: HTMLTextAreaElement;
let outputEl: HTMLDivElement;
let contactsEl: HTMLDivElement;
let themeSelect: HTMLSelectElement;
let statusEl: HTMLDivElement;
let copyBtn: HTMLButtonElement;
let ttsBtn: HTMLButtonElement;
let errorEl: HTMLDivElement;

// ── Init ────────────────────────────────────────────────

async function init(): Promise<void> {
  try {
    await checkX25519Support();
  } catch (e) {
    document.getElementById('app')!.innerHTML =
      `<div class="fatal-error">${(e as Error).message}</div>`;
    return;
  }

  await loadOrCreateIdentity();
  contacts = loadContacts();
  selectedContactId = getSelectedContactId();
  selectedTheme = (storageGet(STORAGE.selectedTheme) as ThemeId) || 'БОЖЕ';

  render();
  wireEvents();

  // Check URL hash for invite token
  checkHashInvite();

  // If we have a selected contact, trigger initial encode of empty/demo content
  if (inputEl.value) {
    await processInput();
  }
}

/** Check location.hash for an invite token and offer to add the contact. */
function checkHashInvite(): void {
  const hash = location.hash.slice(1); // remove '#'
  if (!hash) return;

  const key = tryParseInviteToken(hash);
  if (!key) return;

  // Clear hash so it doesn't trigger again on reload
  history.replaceState(null, '', location.pathname + location.search);

  // Don't add your own key
  if (u8eq(key, myPublicKey)) return;

  handleContactToken(key);
}

async function loadOrCreateIdentity(): Promise<void> {
  const storedPriv = storageGet(STORAGE.privateKey);
  const storedPub = storageGet(STORAGE.publicKey);

  if (storedPriv && storedPub) {
    myPrivateKey = hexU8(storedPriv);
    myPublicKey = hexU8(storedPub);
  } else {
    const kp = await generateKeyPair();
    myPrivateKey = kp.privateKey;
    myPublicKey = kp.publicKey;
    storageSet(STORAGE.privateKey, u8hex(myPrivateKey));
    storageSet(STORAGE.publicKey, u8hex(myPublicKey));
  }
}

// ── Render ──────────────────────────────────────────────

function render(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="contacts-bar" id="contacts-bar"></div>
    <div class="theme-bar">
      <label>Словарь: <select id="theme-select"></select></label>
    </div>
    <textarea id="input" placeholder="Напишите сообщение или вставьте зашифрованный текст..." rows="4"></textarea>
    <div class="output-area">
      <div id="output" class="output-label"></div>
      <div class="output-actions">
        <button id="copy-btn" class="action-btn" title="Скопировать">📋 Скопировать</button>
        <button id="tts-btn" class="action-btn" title="Прочитать вслух">🔊</button>
      </div>
    </div>
    <div id="error" class="error"></div>
    <div id="status" class="status-bar"></div>
    <button id="download-btn" class="download-btn" title="Скачать приложение">⬇ Скачать</button>
  `;

  inputEl = $('input') as HTMLTextAreaElement;
  outputEl = $('output') as HTMLDivElement;
  contactsEl = $('contacts-bar') as HTMLDivElement;
  themeSelect = $('theme-select') as HTMLSelectElement;
  statusEl = $('status') as HTMLDivElement;
  copyBtn = $('copy-btn') as HTMLButtonElement;
  ttsBtn = $('tts-btn') as HTMLButtonElement;
  errorEl = $('error') as HTMLDivElement;

  renderContacts();
  renderThemeSelect();
}

function renderContacts(): void {
  const parts: string[] = [];

  // "Я" (self) — shows own contact token when clicked
  parts.push(
    `<button class="contact-pill${selectedContactId === null ? ' selected' : ''}" data-id="self">Я</button>`
  );

  for (const c of contacts) {
    const sel = c.id === selectedContactId ? ' selected' : '';
    parts.push(
      `<button class="contact-pill${sel}" data-id="${c.id}" title="${u8hex(getContactKey(c)).slice(0, 16)}...">${escHtml(c.name)}</button>`
    );
  }

  parts.push(`<button class="contact-pill contact-add" data-id="add">+</button>`);
  contactsEl.innerHTML = parts.join('');
}

function renderThemeSelect(): void {
  themeSelect.innerHTML = THEMES.map(t =>
    `<option value="${t.id}"${t.id === selectedTheme ? ' selected' : ''}>${t.id}</option>`
  ).join('');
}

function updateStatus(extra?: string): void {
  const contactName = selectedContactId
    ? contacts.find(c => c.id === selectedContactId)?.name ?? '?'
    : 'Я';
  const outputLen = outputEl.textContent?.length ?? 0;
  const parts = [`для ${contactName}`, selectedTheme];
  if (outputLen > 0) parts.push(`${outputLen} символов`);
  if (extra) parts.push(extra);
  statusEl.textContent = parts.join(' · ');
}

function showError(msg: string): void {
  errorEl.textContent = msg;
  setTimeout(() => { errorEl.textContent = ''; }, 5000);
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Events ──────────────────────────────────────────────

function wireEvents(): void {
  let debounceTimer: ReturnType<typeof setTimeout>;

  inputEl.addEventListener('input', () => {
    autoGrow(inputEl);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => processInput(), 150);
  });

  themeSelect.addEventListener('change', () => {
    selectedTheme = themeSelect.value as ThemeId;
    storageSet(STORAGE.selectedTheme, selectedTheme);
    processInput();
  });

  contactsEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null;
    if (!btn) return;
    const id = btn.dataset.id!;

    if (id === 'self') {
      selectedContactId = null;
      setSelectedContactId('');
      showOwnContactToken();
    } else if (id === 'add') {
      handleAddContact();
    } else {
      selectedContactId = id;
      setSelectedContactId(id);
      processInput();
    }
    renderContacts();
  });

  // Long-press to delete contact (mobile-friendly)
  let longPressTimer: ReturnType<typeof setTimeout>;
  contactsEl.addEventListener('pointerdown', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null;
    if (!btn || btn.dataset.id === 'self' || btn.dataset.id === 'add') return;
    longPressTimer = setTimeout(() => {
      const contact = contacts.find(c => c.id === btn.dataset.id);
      if (contact && confirm(`Удалить контакт "${contact.name}"?`)) {
        removeContact(contact.id);
        contacts = loadContacts();
        if (selectedContactId === contact.id) selectedContactId = null;
        renderContacts();
        processInput();
      }
    }, 600);
  });
  contactsEl.addEventListener('pointerup', () => clearTimeout(longPressTimer));
  contactsEl.addEventListener('pointerleave', () => clearTimeout(longPressTimer));

  copyBtn.addEventListener('click', handleCopy);
  ttsBtn.addEventListener('click', handleTts);
  $('download-btn').addEventListener('click', handleDownload);
}

function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// ── Core logic ──────────────────────────────────────────

async function processInput(): Promise<void> {
  const text = inputEl.value.trim();
  if (!text) {
    outputEl.textContent = '';
    isDecodeMode = false;
    lastDecodedSender = null;
    updateStatus();
    return;
  }

  // Try base64url invite token first (compact format: 45 chars)
  const inviteContact = tryParseInviteToken(text);
  if (inviteContact) {
    handleContactToken(inviteContact);
    return;
  }

  // Try to decode (auto-detect theme)
  const decoded = stegoDecode(text);
  if (decoded) {
    await handleDecode(decoded.bytes, decoded.theme);
    return;
  }

  // Not encoded — treat as plaintext, encode it
  await handleEncode(text);
}

async function handleEncode(plaintext: string): Promise<void> {
  isDecodeMode = false;
  lastDecodedSender = null;

  const contact = selectedContactId
    ? contacts.find(c => c.id === selectedContactId)
    : null;
  const theirKey = contact ? getContactKey(contact) : myPublicKey; // self-encrypt if no contact

  try {
    const compressed = compress(plaintext);
    const encrypted = await encrypt(compressed, myPrivateKey, theirKey);

    // Determine if sender key should be included
    const includeSenderKey = contact && !contact.firstMessageSent;
    const wireFrame = includeSenderKey
      ? serializeWire({ type: MSG_WITH_SENDER, senderPublicKey: myPublicKey, payload: encrypted })
      : serializeWire({ type: MSG_NO_SENDER, payload: encrypted });

    const stegoText = stegoEncode(wireFrame, selectedTheme);
    outputEl.textContent = stegoText;
    updateStatus();
  } catch (e) {
    showError(`Ошибка шифрования: ${(e as Error).message}`);
  }
}

async function handleDecode(bytes: Uint8Array, _theme: ThemeId): Promise<void> {
  const frame = deserializeWire(bytes);
  if (!frame) {
    // Not a valid wire frame — treat as plaintext to encode
    await handleEncode(inputEl.value.trim());
    return;
  }

  if (frame.type === CONTACT_TOKEN) {
    handleContactToken(frame.publicKey);
    return;
  }

  // It's an encrypted message — try to decrypt with known contacts
  isDecodeMode = true;

  // If sender key is included, try it first
  const keysToTry: { name: string; key: Uint8Array }[] = [];

  if (frame.senderPublicKey) {
    const known = findContactByKey(frame.senderPublicKey);
    keysToTry.push({
      name: known?.name ?? '(новый контакт)',
      key: frame.senderPublicKey,
    });
  }

  // Add all known contacts
  for (const c of contacts) {
    const k = getContactKey(c);
    if (!keysToTry.some(e => u8eq(e.key, k))) {
      keysToTry.push({ name: c.name, key: k });
    }
  }

  // Try self-key too
  if (!keysToTry.some(e => u8eq(e.key, myPublicKey))) {
    keysToTry.push({ name: 'Я', key: myPublicKey });
  }

  for (const { name, key } of keysToTry) {
    try {
      const decrypted = await decrypt(frame.payload, myPrivateKey, key);
      const plaintext = decompress(decrypted);
      outputEl.textContent = plaintext;
      lastDecodedSender = name;

      // If sender key was included and sender is unknown — offer to save
      if (frame.senderPublicKey && !findContactByKey(frame.senderPublicKey)) {
        const contactName = prompt(`Сообщение от нового контакта.\nНазовите его:`);
        if (contactName) {
          addContact(contactName, frame.senderPublicKey);
          contacts = loadContacts();
          lastDecodedSender = contactName;
          renderContacts();
        }
      }

      updateStatus(`от ${lastDecodedSender}`);
      return;
    } catch {
      // Auth failed — try next key
    }
  }

  showError('Не удалось расшифровать. Возможно, у вас нет ключа отправителя');
  outputEl.textContent = '';
  updateStatus();
}

function handleContactToken(publicKey: Uint8Array): void {
  const existing = findContactByKey(publicKey);
  if (existing) {
    outputEl.textContent = `Контакт уже сохранён: ${existing.name}`;
    updateStatus();
    return;
  }

  const name = prompt('Обнаружен новый контакт.\nДайте ему имя:');
  if (!name) return;

  addContact(name, publicKey);
  contacts = loadContacts();
  selectedContactId = contacts[contacts.length - 1].id;
  setSelectedContactId(selectedContactId);
  renderContacts();
  outputEl.textContent = `Контакт "${name}" добавлен`;
  inputEl.value = '';
  updateStatus();
}

/** Try to parse a base64url invite token. Returns the 32-byte public key or null. */
function tryParseInviteToken(text: string): Uint8Array | null {
  // Invite token format: base64url of [0x20][32-byte public key] = 33 bytes = 44 base64url chars
  // Also accept just the raw base64url of the 32-byte key (43 chars)
  const clean = text.replace(/\s/g, '');
  if (!/^[A-Za-z0-9_-]{43,44}$/.test(clean)) return null;

  try {
    const decoded = base64urlToU8(clean);
    if (decoded.length === 33 && decoded[0] === CONTACT_TOKEN) {
      return decoded.slice(1);
    }
    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // Not valid base64
  }
  return null;
}

/** Generate a compact base64url invite token for sharing. */
function makeInviteToken(publicKey: Uint8Array): string {
  const wire = serializeWire({ type: CONTACT_TOKEN, publicKey });
  return u8toBase64url(wire);
}

function makeInviteLink(publicKey: Uint8Array): string {
  const token = makeInviteToken(publicKey);
  const base = location.origin + location.pathname;
  return base + '#' + token;
}

function showOwnContactToken(): void {
  const inviteLink = makeInviteLink(myPublicKey);
  const inviteToken = makeInviteToken(myPublicKey);
  const tokenBytes = serializeWire({ type: CONTACT_TOKEN, publicKey: myPublicKey });
  const stegoText = stegoEncode(tokenBytes, selectedTheme);

  outputEl.innerHTML =
    `<div class="invite-section">`
    + `<div class="invite-label">Ссылка-приглашение:</div>`
    + `<a href="${escHtml(inviteLink)}" class="invite-link">${escHtml(inviteLink)}</a>`
    + `<button class="action-btn invite-copy-btn" data-copy="${escHtml(inviteLink)}">📋 Скопировать ссылку</button>`
    + `<div class="invite-label">Или код для вставки:</div>`
    + `<code class="invite-token">${escHtml(inviteToken)}</code>`
    + `<div class="invite-label">Или в виде «${escHtml(selectedTheme)}»:</div>`
    + `<div class="invite-stego">${escHtml(stegoText)}</div>`
    + `</div>`;

  // Wire up the copy-link button
  outputEl.querySelector('.invite-copy-btn')?.addEventListener('click', async (e) => {
    const link = (e.target as HTMLElement).dataset.copy!;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = link;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    const btn = e.target as HTMLButtonElement;
    btn.textContent = '✓ Скопировано';
    setTimeout(() => { btn.textContent = '📋 Скопировать ссылку'; }, 1500);
  });

  inputEl.value = '';
  updateStatus('мой контакт');
}

function handleAddContact(): void {
  const input = prompt('Вставьте приглашение или ключ контакта:');
  if (!input) return;
  const clean = input.trim();

  // Try base64url invite token
  let key = tryParseInviteToken(clean);

  // Try hex (64 hex chars = 32 bytes)
  if (!key) {
    const hexClean = clean.replace(/\s/g, '').toUpperCase();
    if (/^[0-9A-F]{64}$/.test(hexClean)) {
      key = hexU8(hexClean);
    }
  }

  if (!key) {
    showError('Неверный формат (вставьте приглашение или 64 hex-символа)');
    return;
  }

  if (findContactByKey(key)) {
    showError('Этот контакт уже добавлен');
    return;
  }
  const name = prompt('Имя для контакта:');
  if (!name) return;
  const contact = addContact(name, key);
  contacts = loadContacts();
  selectedContactId = contact.id;
  setSelectedContactId(contact.id);
  renderContacts();
  processInput();
}

// ── Actions ─────────────────────────────────────────────

async function handleCopy(): Promise<void> {
  const text = outputEl.textContent;
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for file:// or older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  // Mark first message sent for selected contact
  if (!isDecodeMode && selectedContactId) {
    const contact = contacts.find(c => c.id === selectedContactId);
    if (contact && !contact.firstMessageSent) {
      markFirstMessageSent(contact.id);
      contacts = loadContacts();
    }
  }

  // Visual feedback
  copyBtn.textContent = '✓ Скопировано';
  setTimeout(() => { copyBtn.textContent = '📋 Скопировать'; }, 1500);
}

function handleTts(): void {
  if (isSpeaking()) {
    stopSpeaking();
    ttsBtn.textContent = '🔊';
    return;
  }
  const text = outputEl.textContent;
  if (!text) return;
  speak(text);
  ttsBtn.textContent = '🔇';
  // Reset icon when speech ends
  const check = setInterval(() => {
    if (!isSpeaking()) {
      ttsBtn.textContent = '🔊';
      clearInterval(check);
    }
  }, 300);
}

function handleDownload(): void {
  // Save input/output state, clear for clean download
  const savedInput = inputEl.value;
  const savedOutput = outputEl.textContent;
  inputEl.value = '';
  outputEl.textContent = '';
  statusEl.textContent = '';
  errorEl.textContent = '';

  const html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;

  // Restore state
  inputEl.value = savedInput;
  outputEl.textContent = savedOutput;

  const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'paternoster.html';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Start ───────────────────────────────────────────────

init();
