# UX Design

The UI is designed for non-technical Russian-speaking users who need steganographic communication. No crypto jargon anywhere in the interface. The word "ключ" (key) doesn't appear — users manage "контакты" (contacts).

## Why Single-Field Auto-Detect

Traditional encrypt/decrypt UIs have two modes and buttons for each. This creates mode errors — the user can accidentally send plaintext thinking it's encrypted. In our threat model (platform surveillance), that mistake has real consequences.

The single-field design eliminates modes entirely. The user types or pastes into one text field. The app determines direction from the content:

1. **Looks like a base64url invite token** (43-44 chars, base64url alphabet) → import contact
2. **Starts with a known theme prefix** ("Воистину", "ZOV ", etc.) or CJK characters → decode as steganographic message
3. **Everything else** → encode as plaintext message

The output always appears in a read-only label below the field. There is no "encrypt" button, no "decrypt" button, no mode toggle.

## Why No Message History

The threat model includes device inspection. Stored message history is evidence. The app is fully stateless regarding messages — only identity (keypair) and contacts are persisted. The input field and output label clear on page refresh.

## Contact Exchange Flows

### Sharing your contact (three formats)

Tap "Я" in the contact strip. The app shows:
1. **Invite link** — `https://domain/#base64url_token`. Clicking opens the app and auto-imports the contact. The hash is cleared from URL after import.
2. **Compact token** — 44-char base64url string. Paste-friendly for any channel.
3. **Themed text** — the contact token encoded as a prayer/slogan/etc. Steganographic sharing.

### Receiving a contact

Three ways in:
- **Open invite link** → `checkHashInvite()` fires on page load → prompt for name → saved
- **Paste themed contact token** in the main field → auto-detected as type 0x20 → prompt for name
- **Paste base64url token** in the main field → `tryParseInviteToken()` matches → prompt for name
- **"+" button** → prompt dialog accepts hex, base64url, or invite tokens

### First-message auto-introduction

When you send your first message to a new contact, the app includes your public key in the wire frame (type `0x11` vs `0x10`). The recipient's app discovers your key automatically and prompts to save you as a contact. After the first message, the sender key is omitted (saves 32 bytes per message).

## Self-Encryption

When no contact is selected ("Я" is active), messages are encrypted to your own public key. This is the safe default — there is no "unencrypted" mode. The old codebase had "без шифрования" which could silently send plaintext. Removed by design.

## TTS Decoy

The speaker button (🔊) reads the steganographic output aloud using the browser's SpeechSynthesis API. This serves as a cover story — "it's a prayer reading app." The TTS language matches the theme: Russian for БОЖЕ/РОССИЯ/СССР/БУХАЮ, Chinese for КИТАЙ, Latin for PATER, English for emoji.

## Files

- `src/main.ts` — state machine (`processInput`), UI rendering, event handling
- `src/style.css` — minimal Apple Notes-inspired styling
- `src/index.html` — HTML skeleton
