# UX Design

The UI is designed for non-technical Russian-speaking users who need steganographic communication. No crypto jargon anywhere in the interface. The word "ключ" (key) doesn't appear — users manage "контакты" (contacts).

## Why Single-Field Auto-Detect

Traditional encrypt/decrypt UIs have two modes and buttons for each. This creates mode errors — the user can accidentally send plaintext thinking it's encrypted. In our threat model (platform surveillance), that mistake has real consequences.

The single-field design eliminates modes entirely. The user types or pastes into one text field. The app determines direction from the content:

1. **Looks like a base64url invite token** (43-44 chars, base64url alphabet) → import contact
2. **Starts with a known theme prefix** ("Воистину", "ZOV ", etc.) or CJK characters → decode as steganographic message
3. **Everything else** → encode as plaintext message

The output always appears in a read-only label below the field. There is no "encrypt" button, no "decrypt" button, no mode toggle.

An **output mode label** above the output text tells the user what the app decided: "Зашифровано", "Расшифровано · от Alice", "Мой контакт", etc. This makes the auto-detect logic transparent without adding UI modes.

## Session Chat History

Messages are stored in `sessionStorage` per contact — they survive page reloads within the same tab but are cleared when the tab closes. This balances usability (users can track a conversation) with the threat model (no persistent message history on disk).

**Layout:** A scrollable chat area sits between the contact strip and the composition area. Sent messages appear as blue bubbles (aligned right) with a copy button to re-copy the encoded text. Received messages appear as gray bubbles (aligned left) with the sender name.

**Commit flow:**
- **Sending:** The message is committed to chat when the user copies the encoded text (the "send" action). The plaintext and encoded text are both stored.
- **Receiving:** When a message from a known contact is decoded, it is immediately committed to chat, the input auto-clears, and the app switches to the sender's conversation.
- **Unknown senders:** Messages from unknown senders are NOT committed to chat until the contact is saved.

**No chat for self-encryption:** The "Я" view (self-encryption) does not show chat history. It's a notepad, not a conversation.

**Storage key:** `paternoster_chat_${contactId}` in `sessionStorage`.

## Feedback Layer

The app makes its internal state visible through three coordinated signals:

1. **Output mode label** — small gray text above the output, shows what the output contains:
   - "Зашифровано" / "Зашифровано для себя" — after encoding
   - "Расшифровано · от {name}" — after decoding a known sender
   - "Расшифровано · от нового контакта" — after decoding an unknown sender
   - "Мой контакт" — self-profile/share view
   - "Контакт добавлен" — after adding a contact
   - "Резервная копия" — after identity export
   - "Профиль восстановлен" — after identity import
   - Hidden when output is empty

2. **Dynamic copy button** — label changes based on what will be copied:
   - "Скопировать сообщение" — encoded message
   - "Скопировать текст" — decoded plaintext
   - "Скопировать ссылку" — invite link
   - "Скопировать копию" — identity backup blob

3. **Status bar** — unchanged: target · theme · character count · optional sender info

## Dialog System

All interactive prompts use native `<dialog>` elements instead of `window.prompt()` / `window.confirm()`. This provides:

- Styled, in-app dialogs matching the Apple Notes aesthetic
- Focus trapping and Escape-to-cancel via browser `<dialog>` API
- Inline validation with error messages (e.g., password mismatch)
- Better mobile experience (no browser chrome interruption)
- Textarea fields for long inputs (backup blobs)

The `showDialog()` utility returns a Promise that resolves with field values on confirm or `null` on cancel/escape.

## Contact Exchange Flows

### Sharing your contact

Tap "Я" in the contact strip. The app shows (output label: "Мой контакт"):
1. **Verification code** — `XXXX XXXX XXXX XXXX` derived from your public key. A convenience code for quick human comparison out-of-band (32 bits of collision resistance, sufficient for honest verification).
2. **Invite link** — `https://domain/#base64url_token`. Clicking opens the app and auto-imports the contact. The hash is cleared from URL after import.
3. **Compact token** — 44-char base64url string. Paste-friendly for any channel.
4. **Themed text** — the contact token encoded as a prayer/slogan/etc. Steganographic sharing.
5. **Identity backup** (behind "Дополнительно" disclosure) — "Сохранить профиль" exports the keypair as a passphrase-protected string. "Восстановить профиль" imports it back.

### Receiving a contact

Three ways in:
- **Open invite link** → `checkHashInvite()` fires on page load → dialog for name → saved
- **Paste themed contact token** in the main field → auto-detected as type 0x20 → dialog for name
- **Paste base64url token** in the main field → `tryParseInviteToken()` matches → dialog for name
- **"+" button** → dialog with token/key field + name field, inline validation

### Key exchange and auto-introduction

Messages to contacts with unconfirmed key exchange use MSG_INTRODUCTION (0x12): an ephemeral throwaway key in cleartext, with the sender's real identity encrypted inside the envelope. This continues until we receive a message from the contact (proof they have our key), at which point messages switch to MSG_STANDARD (0x10, no sender key).

When a message from an unknown sender is decoded, the decrypted message is shown first (label: "Расшифровано · от нового контакта"), then a "Сохранить контакт" button appears in the output actions. The user reads the message before deciding whether to save the sender. See [crypto.md](crypto.md) for wire format details.

### Deleting a contact

A small × button appears on the currently selected contact pill. Clicking it opens a delete confirmation dialog. This replaces the previous undiscoverable long-press behavior.

## Self-Encryption

When no contact is selected ("Я" is active), messages are encrypted to your own public key. This is the safe default — there is no "unencrypted" mode. The status bar shows "для себя" and the output label shows "Зашифровано для себя".

## TTS Decoy

The speaker button (🔊) reads the steganographic output aloud using the browser's SpeechSynthesis API. This serves as a cover story — "it's a prayer reading app." The TTS language matches the theme: Russian for БОЖЕ/РОССИЯ/СССР/БУХАЮ, Chinese for КИТАЙ, Latin for PATER, English for emoji.

**Voice selection.** `tts.ts` picks a voice matching the theme's language via `getVoices()`. If no matching voice is found, `utterance.voice` is left unset so the browser resolves via `utterance.lang` alone (some browsers have cloud voices not enumerated by `getVoices()`). Never falls back to a Russian voice for non-Russian themes — that caused the Russian engine to describe non-Russian characters (e.g. "китайская буква") instead of pronouncing them.

**Graceful degradation.** `hasVoiceForLang(lang)` checks voice availability. The TTS button is disabled (dimmed, `cursor: not-allowed`) when no voice matches the current theme. Re-checks on `voiceschanged` (voices load asynchronously).

**Chat TTS.** Each chat message bubble has a 🔊 button that reads the ciphertext aloud using the message's theme language. Disabled when no matching voice is available.

## Terminology

All UI text is Russian. Terms are chosen for clarity and non-technical feel.

| Russian term | Concept | Rationale |
|---|---|---|
| Контакт | Person you communicate with | Avoids "ключ" (key), "адресат" (addressee) |
| Приглашение | Invite token / public key share | Neutral, implies social action not crypto |
| Словарь | Steganographic theme selector | Technically accurate (themes are word dictionaries), fits cover story |
| Код | Verification code (XXXX XXXX) | Short, commonly understood |
| Сохранить профиль | Export identity backup | Avoids "личность" (sounds philosophical), "экспорт" (too technical) |
| Восстановить профиль | Import identity backup | Matches "Сохранить профиль" |
| Для себя | Self-encryption target | Natural Russian, replaces grammatically incorrect "для Я" |

**Avoided terms:** ключ (key), шифрование/шифр (encryption/cipher), подпись (signature), хэш (hash), X25519, ECDH, AES — anything that signals "crypto tool" to a casual observer.

## Files

- `src/main.ts` — state machine (`processInput`), dialog utility (`showDialog`), UI rendering, event handling
- `src/style.css` — minimal Apple Notes-inspired styling, dialog styles
- `src/index.html` — HTML skeleton
