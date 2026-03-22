# Cryptography

End-to-end encryption using X25519 key exchange, AES-256-GCM authenticated encryption, and HKDF-SHA256 key derivation. All via the browser's Web Crypto API — no bundled crypto library.

## Why Web Crypto Only

The original codebase bundled noble-curves (5350 lines). Web Crypto API added X25519 support in Chrome 113, Firefox 128, Safari 17.4 — covering ~95% of users as of 2026. Dropping the library cut bundle size by 5KB (after minification) and eliminated a supply chain trust dependency. Browsers that don't support X25519 get a hard error in Russian with version requirements.

## Why X25519 + AES-GCM

X25519 (Curve25519 ECDH) provides 128-bit security with 32-byte keys — the shortest keys at this security level. Short keys mean shorter contact tokens and invite links. AES-256-GCM is the standard authenticated encryption mode available in every Web Crypto implementation. HKDF-SHA256 derives the AES key from the ECDH shared secret.

**Improvement over original:** The old code used empty HKDF salt and info. We use `"paternoster-v1"` as salt and `"aes-gcm-256"` as info to prevent cross-protocol key reuse.

## Threat Model

**Platform surveillance.** Messages traverse monitored platforms (Telegram, VK, email). The adversary scans for encrypted content patterns. Encryption prevents reading; steganographic encoding prevents detection. The crypto doesn't protect against device seizure (keys are in localStorage) or a compromised browser.

**Not in scope:** forward secrecy (static key pairs), sender authentication (we brute-force which contact's key decrypts), key verification ceremony (no safety numbers yet).

## Wire Format

Two layers: outer (message routing) and inner (compression).

**Outer framing** — first byte identifies the frame type:

| Type | Byte | Structure | Use |
|---|---|---|---|
| Encrypted (no sender) | `0x10` | `[0x10][IV:12][ciphertext]` | Messages to known contacts |
| Encrypted (with sender) | `0x11` | `[0x11][sender_pubkey:32][IV:12][ciphertext]` | First message to a contact (auto-introduces sender) |
| Contact token | `0x20` | `[0x20][pubkey:32]` | Contact sharing (not encrypted) |

**Inner framing** (the plaintext before encryption) — per [compression guide](../compression/results/guide.md):

| Flags | Meaning |
|---|---|
| `0xC0` | Squash + smaz |
| `0x3F` | Literal UTF-8 (compression didn't help) |
| `0x80` | Squash + zstd (reserved, not in V1) |

## PKCS8 Wrapping

Web Crypto doesn't support raw X25519 private key import. We construct a PKCS8 ASN.1 wrapper: a fixed 16-byte header (`30 2e 02 01 00 30 05 06 03 2b 65 6e 04 22 04 20`) followed by the 32-byte raw key. Export extracts the last 32 bytes from the PKCS8 structure. This is the only crypto code that isn't a direct Web Crypto API call.

## Files

- `src/crypto.ts` — all crypto operations
- `src/wire.ts` — wire format serialization

## Gotchas

- `deriveBits()` returns an `ArrayBuffer`, not `Uint8Array`. Must wrap before using.
- Private key export goes through PKCS8 (48 bytes), not raw format. We slice the last 32 bytes.
- AES-GCM IV is 12 bytes, generated fresh per message via `crypto.getRandomValues`. IV reuse with the same key is catastrophic — never cache or reuse IVs.
