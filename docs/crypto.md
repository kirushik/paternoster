# Cryptography

End-to-end encryption using X25519 key exchange, AES-256-GCM authenticated encryption, and HKDF-SHA256 key derivation. All via the browser's Web Crypto API — no bundled crypto library.

## Why Web Crypto Only

The original codebase bundled noble-curves (5350 lines). Web Crypto API added X25519 support in Chrome 113, Firefox 128, Safari 17.4. Dropping the library cut bundle size by 5KB (after minification) and eliminated a supply chain trust dependency. Browsers that don't support X25519 get a hard error in Russian.

## Why X25519 + AES-GCM

X25519 (Curve25519 ECDH) provides 128-bit security with 32-byte keys — the shortest keys at this security level. Short keys mean shorter contact tokens and invite links. AES-256-GCM is the standard authenticated encryption mode available in every Web Crypto implementation. HKDF-SHA256 derives the AES key from the ECDH shared secret.

HKDF uses `"paternoster-v2" || seed` as salt and `[class_byte, direction_byte]` as info for per-message key derivation with full domain separation.

## Threat Model

**Platform surveillance.** Messages traverse monitored platforms (Telegram, VK, email). The adversary scans for encrypted content patterns. Encryption prevents reading; steganographic encoding prevents detection. The crypto doesn't protect against device seizure (keys are in localStorage) or a compromised browser.

**Not in scope:** forward secrecy (static key pairs). Messages are not digitally signed. Sender identity is inferred from which contact key successfully decrypts (MSG) or from the sender key inside the encrypted envelope (INTRO). First-contact trust is TOFU unless users verify contact codes out-of-band.

**Deniable authentication:** ECDH is symmetric — `ECDH(Alice_priv, Bob_pub) = ECDH(Bob_priv, Alice_pub)`. Both parties can verify the other's identity but neither can prove authorship to a third party. This property is preserved for MSG messages. INTRO uses an ephemeral key, which doesn't authenticate the sender (trust-on-first-use, verified via codes).

**Contact verification:** Each contact's public key has a short verification code (SHA-256 of public key, first 8 bytes, displayed as `XXXX XXXX XXXX XXXX`). This is a convenience code for quick human comparison (32 bits of collision resistance), not a formal cryptographic fingerprint — sufficient for honest verification, not for adversarial scenarios. Shown on hover over contact pills and in the "Я" view.

**Identity backup:** Users can export their keypair as a passphrase-protected blob (PBKDF2-SHA256 100k iterations → AES-GCM). Import restores identity on another device/browser and validates that the public key matches the private key. 100k PBKDF2-SHA256 iterations is an acceptable baseline; if bundle size constraints relax, consider migrating to Argon2id. See `src/identity.ts`.

## Wire Format

Headerless frames — every frame starts with random bytes for optimal steganographic cover.

**Frame structures:**

| Class | Structure | Fixed overhead |
|---|---|---|
| MSG | `[seed:6][ciphertext][tag:12]` | 18 bytes |
| INTRO | `[eph_pub:32][seed:6][ciphertext(sender_pub:32 + payload)][tag:12]` | 50 bytes |
| CONTACT | `[pub:32][check:1]` | 33 bytes |

**No header byte.** Frame type is determined by:
1. Trial decryption as MSG (try each contact's key)
2. Trial decryption as INTRO (first 32 bytes as ephemeral key)
3. CONTACT check byte validation (`bytes[32] == XOR-fold(bytes[0:32])`)

This order is safe: AES-GCM's 96-bit tag makes false accepts astronomically unlikely (2^-96 per attempt).

**Compression mode** is embedded in seed[0]'s top 2 bits:
```
seed[0]: [comp:2 bits][random:6 bits]
seed[1..5]: fully random
```

| comp bits | Mode |
|---|---|
| 00 | Literal UTF-8 |
| 01 | Squash + smaz |
| 10 | Squash only (CP1251, no smaz) |
| 11 | Reserved |

The comp bits are part of the HKDF salt (via the seed), so flipping them changes the derived key → decryption fails. Effectively authenticated.

**Key exchange confirmation:**

The `keyExchangeConfirmed` flag on each contact tracks whether we have proof they possess our public key. Set when we successfully decrypt any message from them. Until confirmed, every outgoing message uses INTRO. After confirmation, MSG is used (no sender key, no ephemeral key overhead).

### KDF Specification

Each message derives a unique AES-256 key and 96-bit GCM nonce from a 6-byte random seed.

```
seed = crypto.getRandomValues(new Uint8Array(6))
seed[0] = (seed[0] & 0x3F) | (compMode << 6)  // stamp compression mode

Direction byte (prevents same-seed Alice→Bob / Bob→Alice collision):
  0x00  if sender_pub < recipient_pub   (lexicographic byte comparison)
  0x01  otherwise

Class byte (protocol constant, not on wire):
  0x00  for MSG
  0x01  for INTRO

salt = TextEncoder.encode("paternoster-v2") || seed      // 14 + 6 = 20 bytes
PRK  = HKDF-Extract(salt, IKM = ECDH(my_private, their_public))
OKM  = HKDF-Expand(PRK, info = [class_byte, direction_byte], L = 44)

key = OKM[0..31]     // 256-bit AES key
iv  = OKM[32..43]    // 96-bit GCM nonce

ciphertext = AES-GCM-256(key, iv, plaintext,
                          tagLength = 96,
                          additionalData = [class_byte])
```

**Domain separation guarantees:**
- Different seeds → different PRK → different key+IV (per-message uniqueness)
- Different direction bytes → different OKM even with same seed (Alice→Bob ≠ Bob→Alice)
- Different class bytes → different OKM + different AAD (MSG vs INTRO cannot collide)
- Comp mode in seed → changing it changes PRK → decryption fails (effectively authenticated)

**Seed entropy:** 46 random bits (48-bit seed minus 2 comp mode bits). Birthday collision at ~8.4M messages per contact pair. At 10 msgs/day, that's ~2,300 years.

### CONTACT Check Byte

XOR-fold with salt, placed at the END of the frame (so the frame starts with the random public key):

```
check = 0x5A
for each byte b of pub: check ^= b
CONTACT = [pub:32][check:1]
```

Detection: `bytes.length == 33 && bytes[32] == contactCheckByte(bytes[0:32])`. False positive rate: 1/256 for random data.

## PKCS8 Wrapping

Web Crypto doesn't support raw X25519 private key import. We construct a PKCS8 ASN.1 wrapper: a fixed 16-byte header (`30 2e 02 01 00 30 05 06 03 2b 65 6e 04 22 04 20`) followed by the 32-byte raw key. Export extracts the last 32 bytes from the PKCS8 structure. This is the only crypto code that isn't a direct Web Crypto API call.

## Files

- `src/crypto.ts` — all crypto operations (KDF, encrypt, decrypt, key management)
- `src/wire.ts` — wire format serialization and parsing

## Gotchas

- `deriveBits()` returns an `ArrayBuffer`, not `Uint8Array`. Must wrap before using.
- Private key export goes through PKCS8 (48 bytes), not raw format. We slice the last 32 bytes.
- Both key and IV are derived from the 6-byte seed (never transmitted separately). The seed MUST be fresh random per message. Seed reuse with the same contact pair produces identical key+IV → catastrophic GCM nonce reuse.
- INTRO generates a new ephemeral keypair per message. These are never stored — used once and discarded.
- `tagLength: 96` must be specified on BOTH encrypt and decrypt calls. Mismatched tag lengths cause silent corruption or decrypt failure.
- The class byte MUST be used as AAD on both encrypt and decrypt. It provides domain separation between MSG and INTRO even though it's not on the wire — the sender and receiver must agree on the class for decryption to succeed.
- Compression mode bits in seed[0] are part of the HKDF salt. Tampering with them changes the derived key, causing decryption failure. No separate AAD needed for comp mode authentication.
