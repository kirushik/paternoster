# Architecture

Paternoster is a client-side steganographic encrypted messaging tool. The entire app ships as a single self-contained HTML file.

## Why Single-File, No Server

The threat model is platform surveillance — adversaries scanning communications for encrypted content. A server would be a single point of surveillance, seizure, or compromise. A self-contained HTML file can be shared person-to-person (Telegram, USB, email) and opened offline from disk. No server means no app-controlled metadata logs or infrastructure to trust. Transport channels (Telegram, email, etc.) still have their own metadata — the app eliminates its own metadata surface, not all metadata.

The "download" button lets users save a clean copy to share further. The file IS the distribution mechanism. The download handler fetches the actual served page via `fetch(location.href)` to capture the complete single-file build (with inlined JS/CSS), falling back to a DOM snapshot only when running from `file://` protocol.

## Why No Framework

The UI is a single text field, an output label, and a contact strip. React/Vue/Svelte would add 30-100KB to a 30KB app for zero benefit. Vanilla DOM manipulation is simpler to audit, has no supply chain, and produces a smaller bundle.

## Module Map

```
main.ts              — Init, UI rendering, event wiring, state machine (processInput)
├── detect.ts        — Frame classification: trial-decrypt decoded bytes, return typed result (pure, no DOM)
├── invite.ts        — Invite token parsing/generation (pure, no DOM)
├── crypto.ts        — Web Crypto X25519, AES-GCM, HKDF key derivation
├── sign.ts          — XEdDSA signing (inline BigInt Ed25519 arithmetic), Montgomery↔Edwards conversion
├── broadcast.ts     — Broadcast frame serialization/parsing (signed + unsigned)
├── compress.ts      — Compression dispatch (picks smaller of smaz vs literal)
│   ├── squash.ts    — CP1251-based single-byte pre-encoding
│   └── smaz.ts      — Trie-based codebook compression (253-entry Cyrillic codebook)
├── stego.ts         — Steganographic encode/decode dispatch + auto-detection (model 64 commented out)
│   └── dictionaries.ts — Theme definitions (word lists, model params, TTS lang)
├── wire.ts          — Binary message framing (type byte + payload), shared constants
├── contacts.ts      — Contact CRUD (localStorage persistence)
│   └── storage.ts   — localStorage key namespace
├── identity.ts      — Identity export/import (PBKDF2 + AES-GCM passphrase protection)
├── ipfs.ts          — IPFS CIDv0 computation (UnixFS/DAG-PB protobuf + base58btc)
├── cid.ts           — CID badge UI (self-fetch + display)
├── tts.ts           — SpeechSynthesis wrapper (decoy feature)
├── translate.ts     — Chrome Translation API wrapper (decoy feature)
├── chat.ts          — Session chat history (supports message + broadcast types)
└── utils.ts         — Hex, base64url, concat, equality, SHA-256 helpers, random ID generation
```

## Data Flow

**Encoding (user types plaintext):**
```
plaintext → compress (squash+smaz) → encrypt (AES-GCM) → wire frame → stego encode → themed text
```

**Decoding (user pastes encoded text):**
```
themed text → stego decode (auto-detect theme) → wire parse → decrypt (try all contacts) → decompress → plaintext
```

**Contact sharing:**
```
public key → wire frame (type 0x20) → stego encode → themed text (or base64url invite token)
```

**Broadcast encoding (broadcast mode):**
```
plaintext → compress → broadcast frame (signed or unsigned) → stego encode → themed text
```

**Broadcast decoding (messaging mode, auto-detected):**
```
themed text → stego decode → try broadcast parse (signed: XEdDSA verify via Web Crypto Ed25519, unsigned: checksum) → decompress → plaintext
```

## Build

Vite + `vite-plugin-singlefile` inlines all JS and CSS into a single `dist/index.html`. TypeScript compiles to ESNext, tree-shaken and minified. Current output: ~30KB.

## Storage

All state is `localStorage` under `paternoster_*` keys. Private key, public key, contacts JSON, selected theme, selected contact. No IndexedDB, no cookies, no message history (stateless by design — nothing to find on device inspection).
