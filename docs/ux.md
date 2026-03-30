# UX Design

The UI is designed for non-technical Russian-speaking users who need steganographic communication. No crypto jargon anywhere in the interface. The word "ключ" (key) doesn't appear — users manage "контакты" (contacts).

## Why Single-Field Auto-Detect

Traditional encrypt/decrypt UIs have two modes and buttons for each. This creates mode errors — the user can accidentally send plaintext thinking it's encrypted. In our threat model (platform surveillance), that mistake has real consequences.

The single-field design eliminates modes entirely. The user types or pastes into one text field. The app determines direction from the content:

1. **Looks like a base64url invite token** (43-44 chars, base64url alphabet) → import contact
2. **Starts with a known theme prefix** ("Воистину", "ZOV ", etc.) or CJK characters → decode as steganographic message
3. **Everything else** → encode as plaintext message

The output always appears in a read-only label below the field. There is no "encrypt" button, no "decrypt" button.

## Broadcast Mode

### Entering and Exiting

A subtle toggle button (📢, half-opacity) in the bottom-right corner enters broadcast mode. Entry is intentionally obscure — a discovery for power users. Exiting is obvious: a prominent amber banner at the top of the page with a ✕ close button. The footer toggle also works for exit but the banner is the primary affordance. This asymmetry is by design: getting in is a discovery, getting out is always one tap away.

### Visual Transformation

Broadcast mode transforms the interface from a chat app into a composition tool:
- **Background shifts** from cool gray (`#fafafa`) to warm cream (`#f9f0e1`) — confidently visible, not subtle
- **Input field** becomes the hero: taller (180px min), slightly larger text (1.0625rem), amber focus border instead of blue
- **Output area** warms to match (`#f5ead6`)
- **Status text** uses warm amber (`#92400E`)
- **body.broadcast-active** CSS class drives all overrides via cascade

The `broadcast-active` class is toggled on `document.body` by `enterBroadcastMode()` / `exitBroadcastMode()`.

### Composition Controls

- Contacts bar and chat area are hidden
- A "Подписано / Без подписи" toggle (above the textarea, near the composition area) controls whether the broadcast includes an XEdDSA signature. This toggle is a per-composition decision, so it sits near the input rather than in the banner.
- The amber accent color on the sign toggle and broadcast chat bubbles visually distinguishes broadcast content from P2P messages

### Smart Input Handling (Auto-Detect in Broadcast Mode)

Broadcast mode extends the app's core auto-detect philosophy rather than breaking it. When content is pasted:

1. **Try to decode first** — invite tokens, steganographic messages
2. **Broadcasts** (signed or unsigned) are decoded in-place and shown while staying in broadcast mode
3. **P2P encrypted messages** (MSG/INTRO) trigger a silent auto-switch to regular mode, then decode normally
4. **Contact tokens** trigger a silent auto-switch to regular mode, then import dialog
5. **Own signed broadcasts** show decoded with label "Ваша публикация" (useful for verification)
6. **Unrecognized text** is encoded as a broadcast (the default composition behavior)

The auto-switch is silent — no toast or notification. The UI transformation (banner disappearing, contacts appearing, warm background fading to cool) IS the notification.

In messaging mode, broadcast messages from others are auto-detected and decoded normally. Signed broadcasts from known contacts appear in the contact's chat history with distinct amber-accented styling.

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
   - "Ваша публикация" — own signed broadcast decoded for verification
   - Hidden when output is empty

2. **Dynamic copy button** — label changes based on what will be copied:
   - "Скопировать сообщение" — encoded message
   - "Скопировать текст" — decoded plaintext
   - "Скопировать ссылку" — invite link
   - "Скопировать копию" — identity backup blob

3. **Status bar** — unchanged: target · theme · character count · optional sender info

## Theme Picker (Dictionary Selector)

The theme selector (labeled "Словарь") uses a custom dropdown panel instead of a native `<select>`. This provides rich per-theme information to help users choose an encoding style.

**Trigger button.** A compact button in the `.output-actions` row shows the current theme's icon and name (e.g., "☦ БОЖЕ ▾"). Clicking opens the panel.

**Dropdown panel.** A floating panel with 9 theme cards organized in three groups:

| Group | Label | Themes | Rationale |
|---|---|---|---|
| Тексты | Prose | КИТАЙ, PATER, БОЖЕ | Model 4096 themes that produce continuous text |
| Фразы | Phrases | РОССИЯ, СССР, БУХАЮ, TRUMP | Model 16 themes with cultural slogans |
| Символы | Symbols | 🙂 (emoji), hex | Non-linguistic output |

Each card shows: icon, theme name, a hardcoded sample snippet (~30 chars), and a color-coded expansion badge (×N — the stego expansion ratio, i.e. output chars per input byte). Green for compact (≤×2), gray for medium (≤×10), orange for verbose (>×10). Sorted by capacity within each group.

**Responsive layout.** Cards use `flex: 1 1 160px` with `flex-wrap`, naturally reflowing into 3 columns on wide screens, 2 on medium, 1 on narrow. On mobile (≤480px), the panel becomes a bottom sheet (`position: fixed; bottom: 0`) with single-column cards.

**Interaction.** Click or Enter/Space selects a theme and closes the panel. Arrow keys navigate between cards. Escape closes without changing. Outside click closes. Selection persists to localStorage.

**Broadcast mode.** The panel adopts warm cream tones (`.broadcast-active .theme-panel`) to match the broadcast UI.

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
1. **Verification code** — `XXXX XXXX XXXX XXXX` derived from your public key. A convenience code for quick human comparison out-of-band (64 bits of collision resistance, sufficient for honest verification).
2. **Invite link** — `https://domain/#base64url_token`. Clicking opens the app and auto-imports the contact. The hash is cleared from URL after import.
3. **Compact token** — 46-char base64url string (32-byte key + 2 check bytes). Paste-friendly for any channel.
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

## Translation Decoy

The globe button (🌐) translates the steganographic output using the browser's on-device Translation API. The КИТАЙ theme produces real CJK characters (U+4E00–U+5DFF) that individually have meanings, so the "translation" produces an entertaining random word salad — similar in spirit to the gibberish prayers and political slogans.

**Progressive enhancement.** The button only appears when the browser supports the `Translator` API (Chrome 138+, on-device, no data sent to servers) AND the current theme has a non-Russian language. Hidden in Firefox/Safari. Themes that get the button: КИТАЙ (zh-CN), TRUMP (en-US), potentially 🙂 (en) — determined dynamically by `canTranslateFrom()`. PATER (la) is unlikely supported.

**Alongside display.** The translation appears in a separate `#translate-output` div below the stego text, with a slide/fade animation. The stego text is never modified — it stays fully visible and selectable above. The button turns blue (`.translate-on` class) to indicate active state. Click again to hide the translation.

**Anti-copy design.** The translation div has `user-select: none`, making it impossible to select with the mouse (even Ctrl+A skips it). The copy button reads `copyableText`, which is only set during encode/decode — the translation text is never in the copy path. Visual distinction (smaller font, gray italic, left border) makes it clear this isn't the message to send.

**Source text.** Translation reads `ttsText` (the stego text), not `outputEl.textContent`. This is critical for the "Я" (self) tab, where `outputEl` contains a rich DOM structure (verification code, invite link, compact token, stego text, buttons). Reading `textContent` would concatenate all of that into garbage. `ttsText` is always set to just the stego portion in both messaging and "Я" mode.

**State clearing.** Translation is cleared on: new input (via `processInputInner`), theme change, and `clearOutput()`. Cached translator instances are disposed on theme change to free resources.

**`lang` attribute.** The output div gets a `lang` attribute matching the theme language on encode, and `lang="ru"` on decode. This is good HTML practice regardless of the translate feature — aids screen readers and browser language detection.

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
