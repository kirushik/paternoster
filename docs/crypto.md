# Cryptography

End-to-end encryption using X25519 key exchange, AES-256-GCM authenticated encryption, and HKDF-SHA256 key derivation. All via the browser's Web Crypto API — no bundled crypto library.

## Why Web Crypto Only

The original codebase bundled noble-curves (5350 lines). Web Crypto API added X25519 support in Chrome 113, Firefox 128, Safari 17.4. Dropping the library cut bundle size by 5KB (after minification) and eliminated a supply chain trust dependency. Browsers that don't support X25519 get a hard error in Russian.

## Why X25519 + AES-GCM

X25519 (Curve25519 ECDH) provides 128-bit security with 32-byte keys — the shortest keys at this security level. Short keys mean shorter contact tokens and invite links. AES-256-GCM is the standard authenticated encryption mode available in every Web Crypto implementation. HKDF-SHA256 derives the AES key from the ECDH shared secret.

**Improvement over original:** The old code used empty HKDF salt and info. We use `"paternoster-v2" || seed` as salt and `[header_byte, direction_byte]` as info for per-message key derivation with full domain separation.

## Threat Model

**Platform surveillance.** Messages traverse monitored platforms (Telegram, VK, email). The adversary scans for encrypted content patterns. Encryption prevents reading; steganographic encoding prevents detection. The crypto doesn't protect against device seizure (keys are in localStorage) or a compromised browser.

**Not in scope:** forward secrecy (static key pairs). Messages are not digitally signed. Sender identity is inferred from which contact key successfully decrypts (MSG_STANDARD) or from the sender key inside the encrypted envelope (MSG_INTRODUCTION). First-contact trust is TOFU unless users verify contact codes out-of-band.

**Deniable authentication:** ECDH is symmetric — `ECDH(Alice_priv, Bob_pub) = ECDH(Bob_priv, Alice_pub)`. Both parties can verify the other's identity but neither can prove authorship to a third party. This property is preserved for MSG_STANDARD messages. MSG_INTRODUCTION uses an ephemeral key, which doesn't authenticate the sender (trust-on-first-use, verified via codes).

**Contact verification:** Each contact's public key has a short verification code (SHA-256 of public key, first 8 bytes, displayed as `XXXX XXXX XXXX XXXX`). This is a convenience code for quick human comparison (32 bits of collision resistance), not a formal cryptographic fingerprint — sufficient for honest verification, not for adversarial scenarios. Shown on hover over contact pills and in the "Я" view.

**Identity backup:** Users can export their keypair as a passphrase-protected blob (PBKDF2-SHA256 100k iterations → AES-GCM). Import restores identity on another device/browser and validates that the public key matches the private key. 100k PBKDF2-SHA256 iterations is an acceptable baseline; if bundle size constraints relax, consider migrating to Argon2id. See `src/identity.ts`.

## Wire Format

V2 reduces fixed AEAD overhead from 29 bytes to 19 bytes per message.

**Unified header byte** — replaces both the V1 type byte and the inner compression flags byte:

```
Bits: VV CC MM FF
  VV = version:     01
  CC = class:       00=CONTACT, 01=INTRO, 10=MSG, 11=reserved
  MM = compression:  00=literal, 01=squash+smaz, 10=squash-only, 11=reserved
  FF = flags:        00=default (reserved for future use)
```

Squash-only mode (`MM=10`) encodes Cyrillic as CP1251 without smaz dictionary compression. This is better than squash+smaz when smaz's verbatim escape overhead would expand the output (short messages, mixed content, emoji-heavy text). The compressor automatically picks the smallest of literal, squash-only, and squash+smaz.

The header byte is authenticated via AEAD Additional Data (AAD) — flipping any bit causes decryption failure.

**V2 frame structures:**

| Class | Header | Structure | Fixed overhead |
|---|---|---|---|
| MSG | `01_10_MM_00` | `[H:1][seed:6][ciphertext][tag:12]` | 19 bytes |
| INTRO | `01_01_MM_00` | `[H:1][eph_pub:32][seed:6][ciphertext(sender_pub:32 + payload)][tag:12]` | 83 bytes |
| CONTACT | `01_00_00_00` | `[H:1][pubkey:32]` | 33 bytes |

**Why V2 is smaller:**

| Component | V1 | V2 | Saved |
|---|---|---|---|
| Type / header | 1 byte | 1 byte (unified — also carries compression mode) | 0 |
| Inner compression flags | 1 byte | 0 (moved into header) | 1 |
| IV / seed | 12 bytes (random IV) | 6 bytes (random seed → derived key+IV) | 6 |
| Auth tag | 16 bytes (128-bit) | 12 bytes (96-bit) | 4 |
| **Total fixed (MSG)** | **30 bytes** | **19 bytes** | **11** |

#### V2 KDF Specification

Each message derives a unique AES-256 key and 96-bit GCM nonce from a 6-byte random seed. Since every message gets a unique key, nonce reuse is impossible (unless seeds collide — birthday bound at ~16.7M messages per contact pair, ~200 years at 10 msgs/day).

```
seed = crypto.getRandomValues(new Uint8Array(6))

Direction byte (prevents same-seed Alice→Bob / Bob→Alice collision):
  0x00  if sender_pub < recipient_pub   (lexicographic byte comparison)
  0x01  otherwise

salt = TextEncoder.encode("paternoster-v2") || seed      // 14 + 6 = 20 bytes

PRK = HKDF-Extract(salt, IKM = ECDH(my_private, their_public))

OKM = HKDF-Expand(PRK, info = [header_byte, direction_byte], L = 44)

key = OKM[0..31]     // 256-bit AES key
iv  = OKM[32..43]    // 96-bit GCM nonce

ciphertext = AES-GCM-256(key, iv, plaintext,
                          tagLength = 96,
                          additionalData = [header_byte])
```

**Domain separation guarantees:**
- Different seeds → different PRK → different key+IV (per-message uniqueness)
- Different direction bytes → different OKM even with same seed (Alice→Bob ≠ Bob→Alice)
- Different header bytes → different OKM (MSG vs INTRO cannot collide)
- AAD binding → header byte is authenticated, cannot be tampered

**Seed length rationale:** 6-byte (48-bit) seed. Birthday collision probability:

| Messages | Collision probability |
|---|---|
| 750K | 0.1% |
| 16.7M | 50% |

For manual covert exchange volumes, 48-bit seeds provide ample margin. This is a conscious protocol tradeoff — 8-byte seeds would be more conservative (birthday at ~4.3B) but cost 2 extra bytes per message.

## PKCS8 Wrapping

Web Crypto doesn't support raw X25519 private key import. We construct a PKCS8 ASN.1 wrapper: a fixed 16-byte header (`30 2e 02 01 00 30 05 06 03 2b 65 6e 04 22 04 20`) followed by the 32-byte raw key. Export extracts the last 32 bytes from the PKCS8 structure. This is the only crypto code that isn't a direct Web Crypto API call.

## Files

- `src/crypto.ts` — all crypto operations
- `src/wire.ts` — wire format serialization

## Gotchas

- `deriveBits()` returns an `ArrayBuffer`, not `Uint8Array`. Must wrap before using.
- Private key export goes through PKCS8 (48 bytes), not raw format. We slice the last 32 bytes.
- Both key and IV are derived from the 6-byte seed (never transmitted). The seed MUST be fresh random per message. Seed reuse with the same contact pair produces identical key+IV → catastrophic GCM nonce reuse.
- INTRO generates a new ephemeral keypair per message. These are never stored — used once and discarded.
- `tagLength: 96` must be specified on BOTH encrypt and decrypt calls. Mismatched tag lengths cause silent corruption or decrypt failure.
- The header byte MUST be bound as AAD on both encrypt and decrypt. Without AAD, an attacker could flip compression bits without breaking decryption, causing garbled decompression.
