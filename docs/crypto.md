# Cryptography

End-to-end encryption using X25519 key exchange, AES-256-GCM authenticated encryption, and HKDF-SHA256 key derivation. All via the browser's Web Crypto API — no bundled crypto library.

## Why Web Crypto Only

The original codebase bundled noble-curves (5350 lines). Web Crypto API added X25519 support in Chrome 113, Firefox 128, Safari 17.4. Dropping the library cut bundle size by 5KB (after minification) and eliminated a supply chain trust dependency. Browsers that don't support X25519 get a hard error in Russian.

## Why X25519 + AES-GCM

X25519 (Curve25519 ECDH) provides 128-bit security with 32-byte keys — the shortest keys at this security level. Short keys mean shorter contact tokens and invite links. AES-256-GCM is the standard authenticated encryption mode available in every Web Crypto implementation. HKDF-SHA256 derives the AES key from the ECDH shared secret.

**Improvement over original:** The old code used empty HKDF salt and info. We use `"paternoster-v1"` as salt and `"aes-gcm-256"` as info to prevent cross-protocol key reuse.

## Threat Model

**Platform surveillance.** Messages traverse monitored platforms (Telegram, VK, email). The adversary scans for encrypted content patterns. Encryption prevents reading; steganographic encoding prevents detection. The crypto doesn't protect against device seizure (keys are in localStorage) or a compromised browser.

**Not in scope:** forward secrecy (static key pairs). Messages are not digitally signed. Sender identity is inferred from which contact key successfully decrypts (MSG_STANDARD) or from the sender key inside the encrypted envelope (MSG_INTRODUCTION). First-contact trust is TOFU unless users verify contact codes out-of-band.

**Deniable authentication:** ECDH is symmetric — `ECDH(Alice_priv, Bob_pub) = ECDH(Bob_priv, Alice_pub)`. Both parties can verify the other's identity but neither can prove authorship to a third party. This property is preserved for MSG_STANDARD messages. MSG_INTRODUCTION uses an ephemeral key, which doesn't authenticate the sender (trust-on-first-use, verified via codes).

**Contact verification:** Each contact's public key has a short verification code (SHA-256 of public key, first 8 bytes, displayed as `XXXX XXXX XXXX XXXX`). This is a convenience code for quick human comparison (32 bits of collision resistance), not a formal cryptographic fingerprint — sufficient for honest verification, not for adversarial scenarios. Shown on hover over contact pills and in the "Я" view.

**Identity backup:** Users can export their keypair as a passphrase-protected blob (PBKDF2-SHA256 100k iterations → AES-GCM). Import restores identity on another device/browser and validates that the public key matches the private key. 100k PBKDF2-SHA256 iterations is an acceptable baseline; if bundle size constraints relax, consider migrating to Argon2id. See `src/identity.ts`.

## Wire Format

Two layers: outer (message routing) and inner (compression).

**Outer framing** — first byte identifies the frame type:

| Type | Byte | Structure | Use |
|---|---|---|---|
| MSG_STANDARD | `0x10` | `[0x10][IV:12][ciphertext]` | Messages to contacts with confirmed key exchange |
| MSG_INTRODUCTION | `0x12` | `[0x12][ephemeral_pub:32][IV:12][ciphertext(sender_pub:32 + payload)]` | Messages when key exchange is unconfirmed — sender identity inside encrypted envelope |
| Contact token | `0x20` | `[0x20][pubkey:32]` | Contact sharing (not encrypted, exactly 33 bytes) |

**MSG_INTRODUCTION explained:**

The sender generates a one-time ephemeral X25519 keypair. The ephemeral public key goes in cleartext (reveals nothing about sender identity). The sender's real public key is prepended to the compressed message, and the combined payload is encrypted using `ECDH(ephemeral_priv, recipient_pub)`.

The recipient decrypts with `ECDH(recipient_priv, ephemeral_pub)`, extracts the sender's real key (first 32 bytes of plaintext), and the compressed message (rest). If the sender is a known contact, the key exchange is confirmed.

This replaces the old MSG_WITH_SENDER (0x11) which put the sender key in cleartext. The new approach hides sender identity from passive observers — only the intended recipient can see who sent a message.

**Key exchange confirmation:**

The `keyExchangeConfirmed` flag on each contact tracks whether we have proof they possess our public key. Set when we successfully decrypt any message from them (they needed our key to encrypt for us). Until confirmed, every outgoing message uses MSG_INTRODUCTION. After confirmation, MSG_STANDARD is used (no sender key, no overhead).

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
- MSG_INTRODUCTION generates a new ephemeral keypair per message. These are never stored — used once and discarded.
