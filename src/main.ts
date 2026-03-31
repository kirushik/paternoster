import './style.css';
import { checkX25519Support, generateKeyPair, encrypt, encryptIntro, CLASS_MSG } from './crypto';
import { compress } from './compress';
import { stegoEncode, stegoDecode } from './stego';
import {
  serializeMsg, serializeIntro, serializeContact,
} from './wire';
import { type ThemeId, THEMES } from './dictionaries';
import { STORAGE, storageGet, storageSet } from './storage';
import { u8hex, hexU8, u8eq, concatU8, contactCode, charCount } from './utils';
import { initCidDisplay } from './cid';
import {
  type Contact,
  loadContacts,
  addContact,
  findContactByKey,
  removeContact,
  confirmKeyExchange,
  getContactKey,
  getSelectedContactId,
  setSelectedContactId,
} from './contacts';
import { speak, stopSpeaking, isSpeaking, hasVoiceForLang, onVoicesChanged } from './tts';
import { hasTranslationAPI, canTranslateFrom, translateText, disposeTranslators } from './translate';
import { exportIdentity, importIdentity } from './identity';
import { loadChat, addChatMessage, clearChat, randomChatId } from './chat';
import { serializeBroadcastSigned, serializeBroadcastUnsigned } from './broadcast';
import { classifyFrame, classifyFrameBroadcastMode, type KnownKey } from './detect';
import { checkEd25519Support } from './sign';
import { tryParseInviteToken, makeInviteToken } from './invite';
import { MAX_STEGO_CHARS } from './constants';
import { type EncodeStats, formatPipeline } from './status-format';

// ── Theme metadata ─────────────────────────────────────

interface ThemeMeta {
  readonly icon: string;
  readonly label: string;
  readonly sample: string;
  readonly expansion: number;  // chars-out per byte of ciphertext (stego expansion ratio)
  readonly group: 'texts' | 'phrases' | 'symbols';
}

const THEME_META: Record<ThemeId, ThemeMeta> = {
  'КИТАЙ':  { icon: '中', label: 'КИТАЙ', sample: '丿乃乂乄乆丱丼乀乁乊丮乑乕乏…', expansion: 0.7, group: 'texts' },
  'PATER':  { icon: '✝', label: 'PATER', sample: 'Quod servus et sanctus enim…', expansion: 9.1, group: 'texts' },
  'БОЖЕ':   { icon: '☦', label: 'БОЖЕ', sample: 'Раб да святой яко Господь убо…', expansion: 8.8, group: 'texts' },
  'РОССИЯ': { icon: '🇷🇺', label: 'РОССИЯ', sample: '🏆 Так победим! Россия вперёд…', expansion: 7.9, group: 'phrases' },
  'СССР':   { icon: '☭', label: 'СССР', sample: '🚩 Слава КПСС! Вперёд к…', expansion: 9.2, group: 'phrases' },
  'БУХАЮ':  { icon: '🍺', label: 'БУХАЮ', sample: 'ну блин ваще ладно короче…', expansion: 11.8, group: 'phrases' },
  'TRUMP':  { icon: '🇺🇸', label: 'TRUMP', sample: 'INCREDIBLE! SO TRUE! AMAZING!…', expansion: 23, group: 'phrases' },
  '🙂':     { icon: '🙂', label: 'Эмодзи', sample: '😀🎭🌺🔮🎪🌈🦋🎨🌸…', expansion: 1.6, group: 'symbols' },
  'hex':    { icon: '0x', label: 'hex', sample: 'a1f3c70e8b2d…', expansion: 2, group: 'symbols' },
};

const GROUP_ORDER: readonly ('texts' | 'phrases' | 'symbols')[] = ['texts', 'phrases', 'symbols'];
const GROUP_LABELS: Record<string, string> = {
  texts: 'Тексты',
  phrases: 'Фразы',
  symbols: 'Символы',
};

// ── State ───────────────────────────────────────────────

let myPrivateKey: Uint8Array;
let myPublicKey: Uint8Array;
let contacts: Contact[] = [];
let selectedContactId: string | null = null;
let selectedTheme: ThemeId = 'БОЖЕ';
let lastDecodedSender: string | null = null;
let broadcastMode = false;
let broadcastSigned = false;
let ed25519Supported = false;
let copyableText = '';
let copyLabel = '📋 Скопировать';
let ttsText = '';
let translationActive = false;
let pendingNewContact: {
  senderKey: Uint8Array;
  plaintext: string;
  encoded: string;
  theme: ThemeId;
} | null = null;
const contactCodes = new Map<string, string>(); // publicKeyHex → "XXXX XXXX XXXX XXXX"
let lastEncodeStats: EncodeStats | null = null;

// ── DOM refs ────────────────────────────────────────────

const $ = (id: string) => document.getElementById(id)!;
let inputEl: HTMLTextAreaElement;
let outputEl: HTMLDivElement;
let outputLabelEl: HTMLDivElement;
let contactsEl: HTMLDivElement;
let themeTrigger: HTMLButtonElement;
let themePanel: HTMLDivElement;
let themePanelOpen = false;
let statusEl: HTMLDivElement;
let copyBtn: HTMLButtonElement;
let ttsBtn: HTMLButtonElement;
let translateBtn: HTMLButtonElement;
let translateOutputEl: HTMLDivElement;
let errorEl: HTMLDivElement;

// ── Helpers ─────────────────────────────────────────────

function clearTranslation(): void {
  translationActive = false;
  if (translateOutputEl) {
    translateOutputEl.textContent = '';
    translateOutputEl.classList.remove('visible');
  }
  translateBtn?.classList.remove('translate-on');
}

function clearOutput(): void {
  clearTranslation();
  outputEl.textContent = '';
  setOutputLabel('');
  setCopyableText('', '📋 Скопировать');
  ttsText = '';
  lastEncodeStats = null;
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

function buildKnownKeys(): KnownKey[] {
  return contacts.map(c => ({
    name: c.name,
    key: getContactKey(c),
    contactId: c.id,
  }));
}

/** Commit a received/sent message to chat, optionally switch contact, render, handle dedup flash, and clear working area. */
function commitToChat(msg: Parameters<typeof addChatMessage>[0], contactId?: string): void {
  const chatResult = addChatMessage(msg);
  if (contactId && selectedContactId !== contactId) {
    selectedContactId = contactId;
    setSelectedContactId(contactId);
    renderContacts();
  }
  renderChat();
  if (!chatResult.added) flashChatMessage(chatResult.duplicateId);
  inputEl.value = '';
  autoGrow(inputEl);
  clearOutput();
}

// ── Init ────────────────────────────────────────────────

async function init(): Promise<void> {
  try {
    await checkX25519Support();
  } catch (e) {
    const fatal = document.createElement('div');
    fatal.className = 'fatal-error';
    fatal.textContent = (e as Error).message;
    document.getElementById('app')!.replaceChildren(fatal);
    return;
  }

  ed25519Supported = await checkEd25519Support();

  await loadOrCreateIdentity();
  contacts = loadContacts();
  selectedContactId = getSelectedContactId();
  selectedTheme = (storageGet(STORAGE.selectedTheme) as ThemeId) || 'БОЖЕ';

  render();
  wireEvents();
  initCidDisplay();

  // Pre-compute verification codes (async, updates UI when ready)
  refreshContactCodes();

  // Register voiceschanged listener once (not in wireEvents, which re-runs on mode toggle)
  onVoicesChanged(updateTtsAvailability);

  // Check URL hash for invite token
  await checkHashInvite();

  // First visit with no contacts: auto-show invite card
  if (contacts.length === 0 && !location.hash) {
    selectedContactId = null;
    setSelectedContactId('');
    await showOwnContactToken();
    renderContacts();
  }

  updatePlaceholder();

  // If we have a selected contact, trigger initial encode of empty/demo content
  if (inputEl.value) {
    await processInput();
  }
}

/** Check location.hash for an invite token and offer to add the contact. */
async function checkHashInvite(): Promise<void> {
  const hash = location.hash.slice(1); // remove '#'
  if (!hash) return;

  const key = await tryParseInviteToken(hash);
  if (!key) return;

  // Clear hash so it doesn't trigger again on reload
  history.replaceState(null, '', location.pathname + location.search);

  // Don't add your own key
  if (u8eq(key, myPublicKey)) return;

  await handleContactToken(key);
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

/** Pre-compute verification codes for own key and all contacts, then update contact pill titles. */
async function refreshContactCodes(): Promise<void> {
  const keys = [myPublicKey, ...contacts.map(c => getContactKey(c))];
  await Promise.all(keys.map(async (key) => {
    const hex = u8hex(key);
    if (!contactCodes.has(hex)) {
      contactCodes.set(hex, await contactCode(key));
    }
  }));
  // Update contact pill titles with codes
  for (const c of contacts) {
    const btn = contactsEl.querySelector(`[data-id="${c.id}"]`) as HTMLElement | null;
    const code = contactCodes.get(c.publicKeyHex);
    if (btn && code) btn.title = code;
  }
}

// ── Dialog utility ──────────────────────────────────────

interface DialogField {
  name: string;
  type: 'text' | 'password' | 'textarea';
  placeholder: string;
}

function showDialog(config: {
  title: string;
  message?: string;
  fields?: DialogField[];
  confirmLabel: string;
  validate?: (values: Record<string, string>) => string | null | Promise<string | null>;
}): Promise<Record<string, string> | null> {
  return new Promise(resolve => {
    let resolved = false;
    const finish = (value: Record<string, string> | null) => {
      if (resolved) return;
      resolved = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };

    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog';

    const titleEl = document.createElement('div');
    titleEl.className = 'dialog-title';
    titleEl.textContent = config.title;
    dialog.appendChild(titleEl);

    if (config.message) {
      const msgEl = document.createElement('div');
      msgEl.className = 'dialog-message';
      msgEl.textContent = config.message;
      dialog.appendChild(msgEl);
    }

    const errorDiv = document.createElement('div');
    errorDiv.className = 'dialog-error';
    dialog.appendChild(errorDiv);

    const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();

    if (config.fields && config.fields.length > 0) {
      const fieldsDiv = document.createElement('div');
      fieldsDiv.className = 'dialog-fields';
      for (const field of config.fields) {
        let input: HTMLInputElement | HTMLTextAreaElement;
        if (field.type === 'textarea') {
          input = document.createElement('textarea');
        } else {
          input = document.createElement('input');
          (input as HTMLInputElement).type = field.type;
        }
        input.placeholder = field.placeholder;
        inputs.set(field.name, input);

        // Enter in text/password fields submits the dialog
        if (field.type !== 'textarea') {
          input.addEventListener('keydown', ((e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              confirmBtn.click();
            }
          }) as EventListener);
        }

        fieldsDiv.appendChild(input);
      }
      dialog.appendChild(fieldsDiv);
    }

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'dialog-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'dialog-cancel';
    cancelBtn.textContent = 'Отмена';
    cancelBtn.type = 'button';
    actionsDiv.appendChild(cancelBtn);

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'dialog-confirm';
    confirmBtn.textContent = config.confirmLabel;
    confirmBtn.type = 'button';
    actionsDiv.appendChild(confirmBtn);

    dialog.appendChild(actionsDiv);

    const collectValues = (): Record<string, string> => {
      const values: Record<string, string> = {};
      for (const [name, input] of inputs) {
        values[name] = input.value;
      }
      return values;
    };

    confirmBtn.addEventListener('click', async () => {
      const values = collectValues();
      if (config.validate) {
        const error = await config.validate(values);
        if (error) {
          errorDiv.textContent = error;
          return;
        }
      }
      finish(values);
    });

    cancelBtn.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', () => finish(null));

    document.body.appendChild(dialog);
    dialog.showModal();

    // Focus the first input field
    const firstInput = inputs.values().next().value;
    if (firstInput) (firstInput as HTMLElement).focus();
  });
}

// ── Render ──────────────────────────────────────────────

function render(): void {
  const app = document.getElementById('app')!;
  document.body.classList.toggle('broadcast-active', broadcastMode);
  app.innerHTML = `
    ${broadcastMode ? `
    <div class="broadcast-banner" id="broadcast-banner">
      <span class="broadcast-banner-label">📢 Публикация</span>
      <button class="broadcast-banner-close" id="broadcast-exit" title="Вернуться к переписке">✕</button>
    </div>` : ''}
    <div class="contacts-bar" id="contacts-bar"></div>
    <div class="chat-area" id="chat-area"></div>
    <textarea id="input" placeholder="${broadcastMode
      ? 'Введите сообщение для публикации'
      : 'Вставьте код, ссылку или сообщение — приложение само поймёт'}" rows="4"></textarea>
    <div class="output-area">
      <div class="output-header">
        <div id="output-mode-label" class="output-mode-label"></div>
        <button id="tts-btn" class="header-btn" title="Прочитать вслух">🔊</button>
        <button id="translate-btn" class="header-btn" title="Перевести" style="display:none">🌐</button>
      </div>
      <div id="output" class="output-label"></div>
      <div id="translate-output" class="translate-output"></div>
      <div class="output-actions" id="output-actions">
        <div class="theme-picker" id="theme-picker">
          <button type="button" class="theme-trigger" id="theme-trigger"
            aria-haspopup="listbox" aria-expanded="false" title="Словарь">
            <span class="theme-trigger-icon"></span>
            <span class="theme-trigger-label"></span>
            <span class="theme-trigger-chevron">▾</span>
          </button>
          <div class="theme-panel" id="theme-panel" role="listbox"
            aria-label="Словарь" hidden></div>
        </div>
        ${broadcastMode ? `
        <label class="broadcast-sign-check" id="broadcast-sign-label"${!ed25519Supported ? ' title="Подпись недоступна в этом браузере"' : ''}>
          <input type="checkbox" id="broadcast-sign-toggle"${broadcastSigned ? ' checked' : ''}${!ed25519Supported ? ' disabled' : ''}>
          Подписанное
        </label>` : ''}
        <button id="copy-btn" class="action-btn" title="Скопировать">📋 Скопировать</button>
      </div>
    </div>
    <div id="error" class="error"></div>
    <div id="status" class="status-bar"></div>
    <div class="footer-bar">
      <button id="mode-toggle" class="mode-toggle-btn${broadcastMode ? ' active' : ''}" title="${broadcastMode ? 'Переписка' : 'Публикация'}">
        ${broadcastMode ? '✉' : '📢'}
      </button>
      <button id="download-btn" class="download-btn" title="Скачать приложение">⬇ Скачать</button>
    </div>
  `;

  inputEl = $('input') as HTMLTextAreaElement;
  outputEl = $('output') as HTMLDivElement;
  outputLabelEl = $('output-mode-label') as HTMLDivElement;
  contactsEl = $('contacts-bar') as HTMLDivElement;
  themeTrigger = $('theme-trigger') as HTMLButtonElement;
  themePanel = $('theme-panel') as HTMLDivElement;
  statusEl = $('status') as HTMLDivElement;
  copyBtn = $('copy-btn') as HTMLButtonElement;
  ttsBtn = $('tts-btn') as HTMLButtonElement;
  translateBtn = $('translate-btn') as HTMLButtonElement;
  translateOutputEl = $('translate-output') as HTMLDivElement;
  errorEl = $('error') as HTMLDivElement;

  renderContacts();
  renderThemeSelect();
  renderChat();
}

function renderContacts(): void {
  contactsEl.textContent = '';

  // "Я" (self) — shows own contact token when clicked
  const selfBtn = document.createElement('button');
  selfBtn.className = 'contact-pill' + (selectedContactId === null ? ' selected' : '');
  selfBtn.dataset.id = 'self';
  selfBtn.textContent = 'Я';
  contactsEl.appendChild(selfBtn);

  for (const c of contacts) {
    const btn = document.createElement('button');
    btn.className = 'contact-pill' + (c.id === selectedContactId ? ' selected' : '');
    btn.dataset.id = c.id;
    btn.title = contactCodes.get(c.publicKeyHex) || u8hex(getContactKey(c)).slice(0, 16) + '...';
    btn.textContent = c.name;

    // × delete button on selected contact pill
    if (c.id === selectedContactId) {
      const del = document.createElement('span');
      del.className = 'contact-delete';
      del.textContent = '×';
      btn.appendChild(del);
    }

    contactsEl.appendChild(btn);
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'contact-pill contact-add';
  addBtn.dataset.id = 'add';
  addBtn.textContent = '+';
  contactsEl.appendChild(addBtn);
}

function expansionClass(ratio: number): string {
  if (ratio <= 2) return 'cap-green';    // compact: ×0.7, ×1.6, ×2
  if (ratio <= 10) return 'cap-gray';    // medium: ×7.9 – ×9.2
  return 'cap-orange';                   // verbose: ×11.8, ×23
}

function renderThemeSelect(): void {
  // Update trigger to show current selection
  const meta = THEME_META[selectedTheme];
  themeTrigger.querySelector('.theme-trigger-icon')!.textContent = meta.icon;
  themeTrigger.querySelector('.theme-trigger-label')!.textContent = meta.label;

  // Build grouped panel
  const grouped = new Map<string, ThemeId[]>();
  for (const g of GROUP_ORDER) grouped.set(g, []);
  for (const t of THEMES) {
    const m = THEME_META[t.id];
    grouped.get(m.group)!.push(t.id);
  }

  let html = '';
  for (const g of GROUP_ORDER) {
    const ids = grouped.get(g)!;
    if (!ids.length) continue;
    html += `<div class="theme-group" role="group" aria-label="${GROUP_LABELS[g]}">`;
    html += `<div class="theme-group-label">${GROUP_LABELS[g]}</div>`;
    html += '<div class="theme-group-cards">';
    for (const id of ids) {
      const m = THEME_META[id];
      const sel = id === selectedTheme;
      html += `<button type="button" class="theme-card" role="option"
        aria-selected="${sel}" data-theme="${id}" tabindex="${sel ? '0' : '-1'}">
        <span class="theme-card-icon">${m.icon}</span>
        <span class="theme-card-body">
          <span class="theme-card-name">${m.label}</span>
          <span class="theme-card-sample">${m.sample}</span>
        </span>
        <span class="theme-card-capacity ${expansionClass(m.expansion)}">×${m.expansion}</span>
      </button>`;
    }
    html += '</div></div>';
  }
  themePanel.innerHTML = html;
}

function toggleThemePanel(): void {
  if (themePanelOpen) closeThemePanel();
  else openThemePanel();
}

function openThemePanel(): void {
  themePanelOpen = true;
  themePanel.hidden = false;
  themeTrigger.setAttribute('aria-expanded', 'true');
  const selected = themePanel.querySelector<HTMLElement>('[aria-selected="true"]');
  selected?.focus();
}

function closeThemePanel(): void {
  themePanelOpen = false;
  themePanel.hidden = true;
  themeTrigger.setAttribute('aria-expanded', 'false');
}

function renderChat(): void {
  const chatEl = $('chat-area') as HTMLDivElement;

  // No chat for self-encryption
  if (!selectedContactId) {
    chatEl.style.display = 'none';
    return;
  }

  const messages = loadChat(selectedContactId);
  if (messages.length === 0) {
    chatEl.style.display = 'block';
    chatEl.textContent = '';
    const hint = document.createElement('div');
    hint.className = 'chat-empty-hint';
    hint.textContent = 'Напишите сообщение \u2191';
    chatEl.appendChild(hint);
    return;
  }

  chatEl.style.display = 'block';
  chatEl.textContent = '';

  for (const msg of messages) {
    const isBroadcast = msg.type === 'broadcast';
    const bubble = document.createElement('div');
    bubble.className = `chat-message ${msg.direction}${isBroadcast ? ' broadcast' : ''}`;
    bubble.dataset.msgId = msg.id;

    if (isBroadcast) {
      const label = document.createElement('div');
      label.className = 'chat-broadcast-label';
      label.textContent = 'Публикация';
      bubble.appendChild(label);
    }

    const text = document.createElement('div');
    text.className = 'chat-text';
    text.textContent = msg.plaintext;
    bubble.appendChild(text);

    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    const time = new Date(msg.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (msg.direction === 'received' && msg.senderName) {
      meta.textContent = `от ${msg.senderName} · ${time}`;
    } else {
      meta.textContent = `${time} · ${msg.theme}`;
    }
    bubble.appendChild(meta);

    // Actions row: TTS + copy
    const actions = document.createElement('div');
    actions.className = 'chat-actions';

    // TTS button — reads ciphertext aloud (only when a voice is available)
    const msgTheme = THEMES.find(t => t.id === msg.theme);
    const msgLang = msgTheme?.lang ?? 'ru-RU';
    const encoded = msg.encoded;
    if (hasVoiceForLang(msgLang)) {
      const tts = document.createElement('button');
      tts.className = 'chat-tts-btn';
      tts.textContent = '🔊';
      tts.title = 'Прочитать вслух';
      tts.addEventListener('click', () => {
        if (isSpeaking()) {
          stopSpeaking();
          tts.textContent = '🔊';
          tts.classList.remove('playing');
          return;
        }
        speak(encoded, msgLang);
        tts.textContent = '🔇';
        tts.classList.add('playing');
        const poll = setInterval(() => {
          if (!isSpeaking()) {
            tts.textContent = '🔊';
            tts.classList.remove('playing');
            clearInterval(poll);
          }
        }, 300);
      });
      actions.appendChild(tts);
    }

    if (msg.direction === 'sent') {
      const cpBtn = document.createElement('button');
      cpBtn.className = 'chat-copy-btn';
      cpBtn.textContent = '📋';
      cpBtn.title = 'Скопировать зашифрованный текст';
      cpBtn.addEventListener('click', async () => {
        await copyToClipboard(encoded);
        cpBtn.textContent = '✓';
        setTimeout(() => { cpBtn.textContent = '📋'; }, 1500);
      });
      actions.appendChild(cpBtn);
    }

    bubble.appendChild(actions);

    chatEl.appendChild(bubble);
  }

  // Auto-scroll to bottom
  chatEl.scrollTop = chatEl.scrollHeight;
}

function flashChatMessage(msgId: string): void {
  const chatEl = $('chat-area') as HTMLDivElement;
  const bubble = chatEl.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement | null;
  if (!bubble) return;
  bubble.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  bubble.classList.add('flash');
  bubble.addEventListener('animationend', () => bubble.classList.remove('flash'), { once: true });
}

function setOutputLabel(text: string, warning = false): void {
  outputLabelEl.textContent = text;
  outputLabelEl.classList.toggle('sig-warning', warning);
}

function setCopyableText(text: string, label: string): void {
  copyableText = text;
  copyLabel = label;
  copyBtn.textContent = label;
}

function renderPipeline(prefixParts: string[], extra?: string): void {
  statusEl.textContent = '';

  if (lastEncodeStats && lastEncodeStats.outputChars > 0) {
    const parts = [...prefixParts];
    if (extra) parts.push(extra);
    statusEl.appendChild(document.createTextNode(parts.join(' · ')));

    const detailSpan = document.createElement('span');
    detailSpan.className = 'pipeline-detail';
    detailSpan.appendChild(document.createTextNode(' · '));

    for (const seg of formatPipeline(lastEncodeStats)) {
      if (seg.monospace || seg.color) {
        const span = document.createElement('span');
        if (seg.monospace) span.style.fontFamily = 'monospace';
        if (seg.color) span.style.color = seg.color;
        span.textContent = seg.text;
        detailSpan.appendChild(span);
      } else {
        detailSpan.appendChild(document.createTextNode(seg.text));
      }
    }

    statusEl.appendChild(detailSpan);
  } else {
    const parts = [...prefixParts];
    if (extra) parts.push(extra);
    statusEl.textContent = parts.join(' · ');
  }
}

function updatePlaceholder(): void {
  if (!inputEl) return;
  if (broadcastMode) {
    inputEl.placeholder = 'Введите сообщение для публикации';
  } else if (contacts.length === 0) {
    inputEl.placeholder = 'Вставьте приглашение, чтобы добавить собеседника';
  } else if (selectedContactId) {
    const name = contacts.find(c => c.id === selectedContactId)?.name ?? '';
    inputEl.placeholder = `Сообщение для ${name}...`;
  } else {
    inputEl.placeholder = 'Вставьте код, ссылку или сообщение — приложение само поймёт';
  }
}

function updateStatus(extra?: string): void {
  const contactName = selectedContactId
    ? contacts.find(c => c.id === selectedContactId)?.name ?? '?'
    : 'себя';
  renderPipeline([`для ${contactName}`, selectedTheme], extra);
}

function showError(msg: string): void {
  errorEl.textContent = msg;
  setTimeout(() => { errorEl.textContent = ''; }, 5000);
}

function enterBroadcastMode(): void {
  broadcastMode = true;
  document.body.classList.add('broadcast-active');
  render();
  wireEvents();
  contactsEl.style.display = 'none';
  ($('chat-area') as HTMLDivElement).style.display = 'none';
  processInput();
  refreshContactCodes();
}

function exitBroadcastMode(): void {
  broadcastMode = false;
  document.body.classList.remove('broadcast-active');
  render();
  wireEvents();
  processInput();
  refreshContactCodes();
}

// ── Events ──────────────────────────────────────────────

function wireEvents(): void {
  let debounceTimer: ReturnType<typeof setTimeout>;

  inputEl.addEventListener('input', () => {
    autoGrow(inputEl);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => processInput(), 150);
  });

  // Theme picker: open/close panel
  themeTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleThemePanel();
  });

  // Theme picker: card selection
  themePanel.addEventListener('click', (e) => {
    const card = (e.target as Element).closest<HTMLElement>('.theme-card');
    if (!card) return;
    selectedTheme = card.dataset.theme as ThemeId;
    storageSet(STORAGE.selectedTheme, selectedTheme);
    renderThemeSelect();
    closeThemePanel();
    clearTranslation();
    disposeTranslators();
    updateTtsAvailability();
    updateTranslateAvailability();
    if (outputEl.querySelector('.invite-section')) {
      showOwnContactToken();
    } else {
      processInput();
    }
  });

  // Theme picker: keyboard navigation
  themePanel.addEventListener('keydown', (e) => {
    const cards = Array.from(themePanel.querySelectorAll<HTMLElement>('.theme-card'));
    const focused = document.activeElement as HTMLElement;
    const idx = cards.indexOf(focused);
    let next = -1;
    switch (e.key) {
      case 'ArrowDown': next = Math.min(idx + 1, cards.length - 1); break;
      case 'ArrowUp': next = Math.max(idx - 1, 0); break;
      case 'Home': next = 0; break;
      case 'End': next = cards.length - 1; break;
      case 'Escape':
        closeThemePanel();
        themeTrigger.focus();
        e.preventDefault();
        return;
      default: return;
    }
    if (next >= 0) {
      cards[next].focus();
      e.preventDefault();
    }
  });

  // Close panel on outside click
  document.addEventListener('click', () => {
    if (themePanelOpen) closeThemePanel();
  });

  // Prevent clicks inside panel from bubbling to the document close handler
  $('theme-picker').addEventListener('click', (e) => e.stopPropagation());

  // TTS: check voice availability on init
  updateTtsAvailability();
  // Translation: check API availability on init
  updateTranslateAvailability();

  contactsEl.addEventListener('click', async (e) => {
    // Check if × delete button was clicked
    const deleteEl = (e.target as HTMLElement).closest('.contact-delete') as HTMLElement | null;
    if (deleteEl) {
      const pill = deleteEl.closest('[data-id]') as HTMLElement | null;
      if (pill) handleDeleteContact(pill.dataset.id!);
      return;
    }

    const btn = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null;
    if (!btn) return;
    const id = btn.dataset.id!;

    if (id === 'self') {
      selectedContactId = null;
      setSelectedContactId('');
      await showOwnContactToken();
    } else if (id === 'add') {
      handleAddContact();
    } else {
      selectedContactId = id;
      setSelectedContactId(id);
      processInput();
    }
    renderContacts();
    renderChat();
    updatePlaceholder();
  });

  copyBtn.addEventListener('click', handleCopy);
  ttsBtn.addEventListener('click', handleTts);
  translateBtn.addEventListener('click', handleTranslate);
  $('download-btn').addEventListener('click', handleDownload);

  $('mode-toggle').addEventListener('click', () => {
    if (broadcastMode) {
      exitBroadcastMode();
    } else {
      enterBroadcastMode();
    }
  });

  if (broadcastMode) {
    const exitBtn = document.getElementById('broadcast-exit');
    if (exitBtn) {
      exitBtn.addEventListener('click', () => exitBroadcastMode());
    }
    const signToggle = document.getElementById('broadcast-sign-toggle') as HTMLInputElement | null;
    if (signToggle) {
      signToggle.addEventListener('change', () => {
        broadcastSigned = signToggle.checked;
        processInput();
      });
    }
    // Hide contacts bar in broadcast mode
    contactsEl.style.display = 'none';
  }
}

function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// ── Core logic ──────────────────────────────────────────

let processingInput = false;
let inputDirty = false;

async function processInput(): Promise<void> {
  if (processingInput) {
    inputDirty = true;
    return;
  }
  processingInput = true;
  try {
    do {
      inputDirty = false;
      await processInputInner();
    } while (inputDirty);
  } finally {
    processingInput = false;
  }
}

async function processInputInner(): Promise<void> {
  clearTranslation();
  pendingNewContact = null;
  removeSaveContactBtn();
  lastEncodeStats = null;
  document.body.classList.remove('invite-card-mode');

  const text = inputEl.value.trim();
  if (!text) {
    clearOutput();
    lastDecodedSender = null;
    updateStatus();
    return;
  }

  // Broadcast mode: try to decode first, fall through to encode
  if (broadcastMode) {
    // Try invite token — auto-switch to regular mode
    const inviteKey = await tryParseInviteToken(text);
    if (inviteKey) {
      exitBroadcastMode();
      await handleContactToken(inviteKey);
      return;
    }

    // Try to decode pasted content
    const decoded = stegoDecode(text);
    if (decoded) {
      const handled = await handleBroadcastModeDecode(decoded.bytes, decoded.theme);
      if (handled) return;
    }

    // Nothing decoded — encode as broadcast
    await handleBroadcastEncode(text);
    return;
  }

  // Try base64url invite token first (46-char checked or 43-char raw)
  const inviteContact = await tryParseInviteToken(text);
  if (inviteContact) {
    await handleContactToken(inviteContact);
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
  lastDecodedSender = null;

  const contact = selectedContactId
    ? contacts.find(c => c.id === selectedContactId)
    : null;
  const theirKey = contact ? getContactKey(contact) : myPublicKey; // self-encrypt if no contact

  try {
    const { payload: compressedPayload, compMode } = compress(plaintext);
    const needsIntroduction = contact && !contact.keyExchangeConfirmed;

    let wireFrame: Uint8Array;
    if (needsIntroduction) {
      // INTRO: ephemeral key for ECDH, real sender key inside encrypted envelope
      // Seedless: ephemeral ECDH provides per-message uniqueness. compMode inside plaintext.
      const eph = await generateKeyPair();
      const introPayload = concatU8(new Uint8Array([compMode]), myPublicKey, compressedPayload);
      const encrypted = await encryptIntro(introPayload, eph.privateKey, theirKey, eph.publicKey, theirKey);
      wireFrame = serializeIntro(eph.publicKey, encrypted);
    } else {
      const encrypted = await encrypt(compressedPayload, myPrivateKey, theirKey, myPublicKey, theirKey, CLASS_MSG, compMode);
      wireFrame = serializeMsg(encrypted);
    }

    const stegoText = stegoEncode(wireFrame, selectedTheme);
    const outputChars = charCount(stegoText);
    if (outputChars > MAX_STEGO_CHARS) {
      clearOutput();
      setOutputLabel(`Сообщение слишком длинное (${outputChars} символов, максимум ${MAX_STEGO_CHARS})`);
      updateStatus('слишком длинное');
      return;
    }
    lastEncodeStats = {
      inputChars: charCount(plaintext),
      wireBytes: wireFrame.length,
      outputChars,
    };
    outputEl.textContent = stegoText;
    outputEl.lang = THEMES.find(t => t.id === selectedTheme)?.lang ?? 'ru-RU';
    setOutputLabel(contact ? 'Зашифровано' : 'Зашифровано для себя');
    setCopyableText(stegoText, 'Скопировать сообщение');
    ttsText = stegoText;
    updateStatus();
  } catch (e) {
    showError(`Ошибка шифрования: ${(e as Error).message}`);
  }
}

/** Encode text as a broadcast message (signed or unsigned). */
async function handleBroadcastEncode(plaintext: string): Promise<void> {
  lastDecodedSender = null;

  try {
    const { payload: compressed, compMode } = compress(plaintext);
    let wireFrame: Uint8Array;

    if (broadcastSigned && ed25519Supported) {
      wireFrame = await serializeBroadcastSigned(
        compressed, compMode,
        myPublicKey, myPrivateKey,
      );
      setOutputLabel('Подписанная публикация');
    } else {
      wireFrame = await serializeBroadcastUnsigned(compressed, compMode);
      setOutputLabel('Публикация без подписи');
    }

    const stegoText = stegoEncode(wireFrame, selectedTheme);
    const outputChars = charCount(stegoText);
    if (outputChars > MAX_STEGO_CHARS) {
      clearOutput();
      setOutputLabel(`Сообщение слишком длинное (${outputChars} символов, максимум ${MAX_STEGO_CHARS})`);
      updateBroadcastStatus();
      return;
    }
    lastEncodeStats = {
      inputChars: charCount(plaintext),
      wireBytes: wireFrame.length,
      outputChars,
    };
    outputEl.textContent = stegoText;
    outputEl.lang = THEMES.find(t => t.id === selectedTheme)?.lang ?? 'ru-RU';
    setCopyableText(stegoText, 'Скопировать публикацию');
    ttsText = stegoText;
    updateBroadcastStatus();
  } catch (e) {
    showError(`Ошибка: ${(e as Error).message}`);
  }
}

function updateBroadcastStatus(): void {
  renderPipeline([broadcastSigned ? 'подписано' : 'без подписи', selectedTheme]);
}

/**
 * Attempt to decode pasted content in broadcast mode.
 * Broadcasts stay in broadcast mode; P2P messages and contacts auto-switch to regular.
 * Returns true if content was handled (decoded or switched).
 */
async function handleBroadcastModeDecode(bytes: Uint8Array, _theme: ThemeId): Promise<boolean> {
  const result = await classifyFrameBroadcastMode(bytes, myPrivateKey, myPublicKey, buildKnownKeys());
  if (!result) return false;

  switch (result.type) {
    case 'broadcast_signed':
      await handleDecodedBroadcast(result.plaintext, result, _theme);
      return true;
    case 'broadcast_unsigned':
      handleDecodedBroadcastUnsigned(result.plaintext, _theme);
      return true;
    case 'msg':
      exitBroadcastMode();
      handleDecodedMsg(result.plaintext, result.senderName, result.contactId, _theme);
      return true;
    case 'intro':
      exitBroadcastMode();
      await handleDecodedIntro(result.senderPub, result.plaintext, _theme);
      return true;
    case 'contact':
      exitBroadcastMode();
      await handleContactToken(result.publicKey);
      return true;
    default:
      return false;
  }
}

/** Shared logic: process a successfully decoded introduction (sender pub + plaintext). */
async function handleDecodedIntro(senderPub: Uint8Array, plaintext: string, _theme: ThemeId): Promise<void> {
  const knownSender = findContactByKey(senderPub);
  outputEl.textContent = plaintext;
  outputEl.lang = 'ru';
  setCopyableText(plaintext, 'Скопировать текст');

  if (knownSender) {
    if (!knownSender.keyExchangeConfirmed) {
      confirmKeyExchange(knownSender.id);
      contacts = loadContacts();
    }
    lastDecodedSender = knownSender.name;
    commitToChat({
      id: randomChatId(), direction: 'received', plaintext,
      encoded: inputEl.value.trim(), contactId: knownSender.id,
      senderName: knownSender.name, timestamp: Date.now(), theme: _theme,
    }, knownSender.id);
  } else {
    pendingNewContact = {
      senderKey: senderPub, plaintext,
      encoded: inputEl.value.trim(), theme: _theme,
    };
    lastDecodedSender = '(новый контакт)';
    outputEl.textContent = plaintext;
    setCopyableText(plaintext, 'Скопировать текст');
    ttsText = inputEl.value.trim();
    setOutputLabel('Расшифровано · от нового контакта');
    addSaveContactBtn();
  }
  updateStatus(`от ${lastDecodedSender}`);
}

/** Shared logic: process a successfully decoded standard message (plaintext + sender info). */
function handleDecodedMsg(plaintext: string, senderName: string, contactId: string | undefined, _theme: ThemeId): void {
  outputEl.textContent = plaintext;
  outputEl.lang = 'ru';
  setCopyableText(plaintext, 'Скопировать текст');
  lastDecodedSender = senderName;

  if (contactId) {
    const senderContact = contacts.find(c => c.id === contactId);
    if (senderContact && !senderContact.keyExchangeConfirmed) {
      confirmKeyExchange(senderContact.id);
      contacts = loadContacts();
    }
    commitToChat({
      id: randomChatId(), direction: 'received', plaintext,
      encoded: inputEl.value.trim(), contactId,
      senderName, timestamp: Date.now(), theme: _theme,
    }, contactId);
  } else {
    setOutputLabel(`Расшифровано · от ${lastDecodedSender}`);
  }
  updateStatus(`от ${lastDecodedSender}`);
}

async function handleDecode(bytes: Uint8Array, _theme: ThemeId): Promise<void> {
  const result = await classifyFrame(bytes, myPrivateKey, myPublicKey, buildKnownKeys());

  switch (result.type) {
    case 'msg':
      handleDecodedMsg(result.plaintext, result.senderName, result.contactId, _theme);
      return;
    case 'intro':
      await handleDecodedIntro(result.senderPub, result.plaintext, _theme);
      return;
    case 'broadcast_signed':
      await handleDecodedBroadcast(result.plaintext, result, _theme);
      return;
    case 'broadcast_unsigned':
      handleDecodedBroadcastUnsigned(result.plaintext, _theme);
      return;
    case 'contact':
      await handleContactToken(result.publicKey);
      return;
    case 'unknown':
      lastDecodedSender = null;
      clearOutput();
      setOutputLabel('Не удалось расшифровать');
      updateStatus('ошибка расшифровки');
      return;
  }
}

/** Handle a decoded signed broadcast with three verification states. */
async function handleDecodedBroadcast(
  plaintext: string,
  result: { status: 'verified' | 'unverified' | 'failed'; fingerprint: Uint8Array; x25519Pub?: Uint8Array },
  _theme: ThemeId,
): Promise<void> {
  const knownSender = result.x25519Pub ? findContactByKey(result.x25519Pub) : null;
  outputEl.textContent = plaintext;
  outputEl.lang = 'ru';
  ttsText = inputEl.value.trim();
  const fpHex = Array.from(result.fingerprint).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

  const isOwnBroadcast = result.status === 'verified' && result.x25519Pub && u8eq(result.x25519Pub, myPublicKey);

  if (isOwnBroadcast) {
    // Own broadcast — show decoded for verification, don't add to chat
    lastDecodedSender = null;
    setOutputLabel('Ваша публикация');
    setCopyableText(plaintext, 'Скопировать текст');
  } else if (result.status === 'verified' && knownSender) {
    lastDecodedSender = knownSender.name;
    setOutputLabel(`Публикация · от ${knownSender.name}`);
    setCopyableText(plaintext, 'Скопировать текст');

    commitToChat({
      id: randomChatId(), direction: 'received', plaintext,
      encoded: inputEl.value.trim(), contactId: knownSender.id,
      senderName: knownSender.name, timestamp: Date.now(), theme: _theme,
      type: 'broadcast',
    }, knownSender.id);
  } else if (result.status === 'failed') {
    lastDecodedSender = null;
    setOutputLabel(`Публикация · подпись не прошла проверку (код ${fpHex})`, true);
    setCopyableText(plaintext, 'Скопировать текст');
  } else {
    // unverified — unknown sender, no matching fingerprint
    lastDecodedSender = null;
    setOutputLabel(`Публикация · неизвестный отправитель (код ${fpHex})`);
    setCopyableText(plaintext, 'Скопировать текст');
  }
  updateStatus();
}

/** Handle a decoded unsigned broadcast (no sender identity). */
function handleDecodedBroadcastUnsigned(plaintext: string, _theme: ThemeId): void {
  lastDecodedSender = null;
  outputEl.textContent = plaintext;
  outputEl.lang = 'ru';
  setOutputLabel('Публикация · без подписи');
  setCopyableText(plaintext, 'Скопировать текст');
  ttsText = inputEl.value.trim();
  updateStatus();
}

function addSaveContactBtn(): void {
  const actionsEl = $('output-actions');
  const btn = document.createElement('button');
  btn.className = 'action-btn save-contact-btn';
  btn.id = 'save-contact-btn';
  btn.textContent = 'Сохранить контакт';
  btn.addEventListener('click', handleSavePendingContact);
  actionsEl.appendChild(btn);
}

function removeSaveContactBtn(): void {
  const btn = document.getElementById('save-contact-btn');
  if (btn) btn.remove();
}

async function handleSavePendingContact(): Promise<void> {
  if (!pendingNewContact) return;

  const result = await showDialog({
    title: 'Сохранить контакт',
    fields: [{ name: 'name', type: 'text', placeholder: 'Имя контакта' }],
    confirmLabel: 'Сохранить',
    validate: (values) => {
      if (!values.name.trim()) return 'Введите имя контакта';
      return null;
    },
  });
  if (!result) return;

  const name = result.name.trim();
  const newContact = addContact(name, pendingNewContact.senderKey);
  contacts = loadContacts();

  // Switch to the new contact's chat and commit the first message
  selectedContactId = newContact.id;
  setSelectedContactId(selectedContactId);

  addChatMessage({
    id: randomChatId(),
    direction: 'received',
    plaintext: pendingNewContact.plaintext,
    encoded: pendingNewContact.encoded,
    contactId: newContact.id,
    senderName: name,
    timestamp: Date.now(),
    theme: pendingNewContact.theme,
    type: 'message',
  });

  pendingNewContact = null;
  removeSaveContactBtn();
  renderContacts();
  refreshContactCodes();
  renderChat();

  // Clear working area
  inputEl.value = '';
  autoGrow(inputEl);
  clearOutput();
  updateStatus();
  updatePlaceholder();
}

async function handleContactToken(publicKey: Uint8Array): Promise<void> {
  const existing = findContactByKey(publicKey);
  if (existing) {
    outputEl.textContent = `Контакт уже сохранён: ${existing.name}`;
    setOutputLabel('Контакт');
    setCopyableText('', '📋 Скопировать');
    ttsText = '';
    updateStatus();
    return;
  }

  const result = await showDialog({
    title: 'Новое приглашение',
    message: 'Кто-то поделился с вами контактом. Дайте ему имя:',
    fields: [{ name: 'name', type: 'text', placeholder: 'Имя контакта' }],
    confirmLabel: 'Сохранить',
    validate: (values) => {
      if (!values.name.trim()) return 'Введите имя контакта';
      return null;
    },
  });
  if (!result) return;

  const name = result.name.trim();
  addContact(name, publicKey);
  contacts = loadContacts();
  selectedContactId = contacts[contacts.length - 1].id;
  setSelectedContactId(selectedContactId);
  renderContacts();
  refreshContactCodes();
  outputEl.textContent = '';
  const hintDiv = document.createElement('div');
  hintDiv.className = 'post-add-hint';
  hintDiv.textContent = 'Отправьте сообщение — так собеседник узнает, кто вы';
  outputEl.appendChild(hintDiv);
  setOutputLabel('Контакт добавлен');
  setCopyableText('', '📋 Скопировать');
  inputEl.value = '';
  updateStatus();
  updatePlaceholder();
  renderChat();
}

// tryParseInviteToken and makeInviteToken moved to src/invite.ts

async function makeInviteLink(publicKey: Uint8Array): Promise<string> {
  const token = await makeInviteToken(publicKey);
  const base = location.origin + location.pathname;
  return base + '#' + token;
}

async function showOwnContactToken(): Promise<void> {
  // Stego is behind disclosure — hide TTS/translate via CSS class
  ttsText = '';
  document.body.classList.add('invite-card-mode');

  const inviteLink = await makeInviteLink(myPublicKey);
  const inviteToken = await makeInviteToken(myPublicKey);
  const tokenBytes = await serializeContact(myPublicKey);
  const stegoText = stegoEncode(tokenBytes, selectedTheme);

  outputEl.textContent = '';
  setOutputLabel('Мой контакт');

  const section = document.createElement('div');
  section.className = 'invite-section';

  const addLabel = (text: string, parent: HTMLElement = section) => {
    const div = document.createElement('div');
    div.className = 'invite-label';
    div.textContent = text;
    parent.appendChild(div);
  };

  // 1. Action-oriented instruction
  const instructionDiv = document.createElement('div');
  instructionDiv.className = 'invite-instruction';
  instructionDiv.textContent = 'Отправьте ссылку собеседнику, чтобы начать переписку';
  section.appendChild(instructionDiv);

  // 2. Invite link (primary action)
  addLabel('Ссылка-приглашение:');

  const linkEl = document.createElement('a');
  linkEl.href = inviteLink;
  linkEl.className = 'invite-link';
  linkEl.textContent = inviteLink;
  section.appendChild(linkEl);

  // 3. Copy link button
  const inviteCopyBtn = document.createElement('button');
  inviteCopyBtn.className = 'action-btn invite-copy-btn';
  inviteCopyBtn.textContent = '📋 Скопировать ссылку';
  inviteCopyBtn.addEventListener('click', async () => {
    await copyToClipboard(inviteLink);
    inviteCopyBtn.textContent = '✓ Скопировано';
    setTimeout(() => { inviteCopyBtn.textContent = '📋 Скопировать ссылку'; }, 1500);
  });
  section.appendChild(inviteCopyBtn);

  // 4. Web Share API (mobile)
  if (typeof navigator.share === 'function') {
    const shareBtn = document.createElement('button');
    shareBtn.className = 'action-btn invite-copy-btn';
    shareBtn.textContent = '📤 Поделиться';
    shareBtn.addEventListener('click', async () => {
      try { await navigator.share({ url: inviteLink }); } catch { /* user cancelled */ }
    });
    section.appendChild(shareBtn);
  }

  // 5. Alternative sharing methods (disclosure)
  const altDetails = document.createElement('details');
  const altSummary = document.createElement('summary');
  altSummary.textContent = 'Другие способы';
  altDetails.appendChild(altSummary);

  addLabel('Код для вставки:', altDetails);

  const codeEl = document.createElement('code');
  codeEl.className = 'invite-token';
  codeEl.textContent = inviteToken;
  altDetails.appendChild(codeEl);

  addLabel(`В виде «${selectedTheme}»:`, altDetails);

  const stegoDiv = document.createElement('div');
  stegoDiv.className = 'invite-stego';
  stegoDiv.textContent = stegoText;
  altDetails.appendChild(stegoDiv);

  const ownCode = contactCodes.get(u8hex(myPublicKey));
  if (ownCode) {
    addLabel(`Код подтверждения: ${ownCode}`, altDetails);
  }

  section.appendChild(altDetails);

  // 6. Profile export/import wrapped in <details>
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Дополнительно';
  details.appendChild(summary);

  const exportBtn = document.createElement('button');
  exportBtn.className = 'action-btn';
  exportBtn.textContent = 'Сохранить профиль';
  exportBtn.addEventListener('click', handleExportIdentity);
  details.appendChild(exportBtn);

  const importBtn = document.createElement('button');
  importBtn.className = 'action-btn';
  importBtn.textContent = 'Восстановить профиль';
  importBtn.addEventListener('click', handleImportIdentity);
  details.appendChild(importBtn);

  section.appendChild(details);

  outputEl.appendChild(section);
  outputEl.lang = THEMES.find(t => t.id === selectedTheme)?.lang ?? 'ru-RU';
  setCopyableText(stegoText, 'Скопировать текст');

  // Toggle TTS/translate when disclosure opens/closes
  altDetails.addEventListener('toggle', () => {
    if (altDetails.open) {
      ttsText = stegoText;
      document.body.classList.remove('invite-card-mode');
      updateTtsAvailability();
      updateTranslateAvailability();
    } else {
      ttsText = '';
      document.body.classList.add('invite-card-mode');
    }
  });

  inputEl.value = '';
  updateStatus('мой контакт');
}

async function handleAddContact(): Promise<void> {
  let parsedKey: Uint8Array | null = null;

  const result = await showDialog({
    title: 'Добавить контакт',
    fields: [
      { name: 'token', type: 'text', placeholder: 'Код приглашения или ключ' },
      { name: 'name', type: 'text', placeholder: 'Имя контакта' },
    ],
    confirmLabel: 'Добавить',
    validate: async (values) => {
      if (!values.token.trim()) return 'Вставьте приглашение или ключ';
      if (!values.name.trim()) return 'Введите имя контакта';

      const clean = values.token.trim();
      parsedKey = await tryParseInviteToken(clean);
      if (!parsedKey) {
        const hexClean = clean.replace(/\s/g, '').toUpperCase();
        if (/^[0-9A-F]{64}$/.test(hexClean)) {
          parsedKey = hexU8(hexClean);
        }
      }
      if (!parsedKey) return 'Неверный формат (вставьте приглашение или 64 hex-символа)';
      if (u8eq(parsedKey, myPublicKey)) return 'Это ваш собственный ключ';
      if (findContactByKey(parsedKey)) return 'Этот контакт уже добавлен';
      return null;
    },
  });
  if (!result || !parsedKey) return;

  const contact = addContact(result.name.trim(), parsedKey);
  contacts = loadContacts();
  selectedContactId = contact.id;
  setSelectedContactId(contact.id);
  renderContacts();
  refreshContactCodes();
  renderChat();
  updatePlaceholder();
  processInput();
}

async function handleDeleteContact(contactId: string): Promise<void> {
  const contact = contacts.find(c => c.id === contactId);
  if (!contact) return;

  const result = await showDialog({
    title: 'Удалить контакт?',
    message: `Контакт «${contact.name}» будет удалён.`,
    confirmLabel: 'Удалить',
  });
  if (!result) return;

  clearChat(contact.id);
  removeContact(contact.id);
  contacts = loadContacts();
  if (selectedContactId === contact.id) {
    selectedContactId = null;
    setSelectedContactId('');
  }
  renderContacts();
  renderChat();
  updatePlaceholder();
  processInput();
}

async function handleExportIdentity(): Promise<void> {
  const result = await showDialog({
    title: 'Сохранить профиль',
    message: 'Создайте пароль для резервной копии.',
    fields: [
      { name: 'password', type: 'password', placeholder: 'Пароль' },
      { name: 'confirm', type: 'password', placeholder: 'Повторите пароль' },
    ],
    confirmLabel: 'Сохранить',
    validate: (values) => {
      if (!values.password) return 'Введите пароль';
      if (values.password !== values.confirm) return 'Пароли не совпадают';
      return null;
    },
  });
  if (!result) return;

  try {
    const blob = await exportIdentity(myPrivateKey, myPublicKey, result.password);
    outputEl.textContent = blob;
    setOutputLabel('Резервная копия');
    setCopyableText(blob, 'Скопировать копию');
    ttsText = '';
    updateStatus('скопируйте и сохраните');
  } catch {
    showError('Не удалось создать резервную копию');
  }
}

async function handleImportIdentity(): Promise<void> {
  const result = await showDialog({
    title: 'Восстановить профиль',
    message: 'Внимание: восстановление заменит ваш текущий профиль. Ваши контакты сохранятся, но для них вы станете другим собеседником.',
    fields: [
      { name: 'blob', type: 'textarea', placeholder: 'Вставьте резервную копию' },
      { name: 'password', type: 'password', placeholder: 'Пароль' },
    ],
    confirmLabel: 'Восстановить',
    validate: (values) => {
      if (!values.blob.trim()) return 'Вставьте резервную копию';
      if (!values.password) return 'Введите пароль';
      return null;
    },
  });
  if (!result) return;

  try {
    const { privateKey, publicKey } = await importIdentity(result.blob.trim(), result.password);
    myPrivateKey = privateKey;
    myPublicKey = publicKey;
    storageSet(STORAGE.privateKey, u8hex(myPrivateKey));
    storageSet(STORAGE.publicKey, u8hex(myPublicKey));
    contactCodes.clear();
    refreshContactCodes();
    outputEl.textContent = 'Профиль восстановлен';
    setOutputLabel('Профиль восстановлен');
    setCopyableText('', '📋 Скопировать');
    ttsText = '';
    updateStatus();
  } catch (e) {
    showError((e as Error).message);
  }
}

// ── Actions ─────────────────────────────────────────────

async function handleCopy(): Promise<void> {
  const text = copyableText || outputEl.textContent || '';
  if (!text) return;

  await copyToClipboard(text);

  // Commit sent message to chat history
  if (selectedContactId && copyLabel === 'Скопировать сообщение') {
    const plaintext = inputEl.value.trim();
    if (plaintext) {
      commitToChat({
        id: randomChatId(),
        direction: 'sent',
        plaintext,
        encoded: copyableText,
        contactId: selectedContactId,
        timestamp: Date.now(),
        theme: selectedTheme,
      });
    }
  }

  // Visual feedback
  copyBtn.textContent = '✓ Скопировано';
  setTimeout(() => { copyBtn.textContent = copyLabel; }, 1500);

  // One-time hint explaining "copy = send" model
  if (copyLabel === 'Скопировать сообщение' && !storageGet(STORAGE.seenCopyHint)) {
    storageSet(STORAGE.seenCopyHint, '1');
    const hintEl = document.createElement('div');
    hintEl.className = 'copy-hint';
    hintEl.textContent = 'Отправьте через любой мессенджер';
    statusEl.parentElement!.insertBefore(hintEl, statusEl);
    setTimeout(() => { hintEl.remove(); }, 4000);
  }
}

function updateTtsAvailability(): void {
  const theme = THEMES.find(t => t.id === selectedTheme);
  const lang = theme?.lang ?? 'ru-RU';
  const available = hasVoiceForLang(lang);
  ttsBtn.disabled = !available;
  ttsBtn.title = available ? 'Прочитать вслух' : 'Голос для этой темы недоступен';
}

function handleTts(): void {
  if (isSpeaking()) {
    stopSpeaking();
    ttsBtn.textContent = '🔊';
    return;
  }
  if (!ttsText) return;
  const theme = THEMES.find(t => t.id === selectedTheme);
  speak(ttsText, theme?.lang ?? 'ru-RU');
  ttsBtn.textContent = '🔇';
  // Reset icon when speech ends
  const check = setInterval(() => {
    if (!isSpeaking()) {
      ttsBtn.textContent = '🔊';
      clearInterval(check);
    }
  }, 300);
}

async function updateTranslateAvailability(): Promise<void> {
  if (!hasTranslationAPI()) { translateBtn.style.display = 'none'; return; }
  const theme = THEMES.find(t => t.id === selectedTheme);
  const lang = theme?.lang ?? 'ru-RU';
  if (lang.startsWith('ru')) { translateBtn.style.display = 'none'; return; }
  const sourceLang = lang.split('-')[0];
  const availability = await canTranslateFrom(sourceLang);
  translateBtn.style.display = availability !== 'unavailable' ? '' : 'none';
  translateBtn.title = availability === 'downloadable'
    ? 'Перевести (нужна загрузка модели)'
    : 'Перевести';
}

async function handleTranslate(): Promise<void> {
  if (translationActive) {
    clearTranslation();
    return;
  }
  const text = ttsText;
  if (!text) return;

  const themeAtClick = selectedTheme;
  translateBtn.disabled = true;
  translateBtn.textContent = '⏳';

  try {
    const theme = THEMES.find(t => t.id === selectedTheme);
    const sourceLang = (theme?.lang ?? 'ru-RU').split('-')[0];
    const translated = await translateText(text, sourceLang);
    // Guard against stale write if theme changed during async translation
    if (selectedTheme !== themeAtClick) return;
    translateOutputEl.textContent = translated;
    translateOutputEl.classList.add('visible');
    translationActive = true;
    translateBtn.classList.add('translate-on');
  } catch {
    // Progressive enhancement — silently fail
  } finally {
    translateBtn.textContent = '🌐';
    translateBtn.disabled = false;
  }
}

async function handleDownload(): Promise<void> {
  // Save input/output state, clear for clean download
  const savedInput = inputEl.value;
  const savedOutput = outputEl.textContent;
  const savedLabel = outputLabelEl.textContent;
  inputEl.value = '';
  outputEl.textContent = '';
  outputLabelEl.textContent = '';
  statusEl.textContent = '';
  errorEl.textContent = '';

  let html: string;
  try {
    // Fetch the actual served file (the single-file build from vite-plugin-singlefile).
    // Assumes location.href serves the final single-file HTML artifact.
    // In dev mode this fetches the dev server's HTML (module scripts, not inlined) —
    // the download feature is intended for the built dist/index.html served statically.
    const response = await fetch(location.href);
    html = await response.text();
  } catch {
    // file:// protocol — fetch fails, but user already has the file locally
    html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
  }

  // Restore state
  inputEl.value = savedInput;
  outputEl.textContent = savedOutput;
  outputLabelEl.textContent = savedLabel;

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
