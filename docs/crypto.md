# Cryptography

End-to-end encryption using X25519 key exchange, AES-256-GCM authenticated encryption, and HKDF-SHA256 key derivation. All via the browser's Web Crypto API — no bundled crypto library.

## Why Web Crypto Only

The original codebase bundled noble-curves (5350 lines). Web Crypto API added X25519 support in Chrome 113, Firefox 128, Safari 17.4. Dropping the library cut bundle size by 5KB (after minification) and eliminated a supply chain trust dependency. Browsers that don't support X25519 get a hard error in Russian.

## Why X25519 + AES-GCM

X25519 (Curve25519 ECDH) provides 128-bit security with 32-byte keys — the shortest keys at this security level. Short keys mean shorter contact tokens and invite links. AES-256-GCM is the standard authenticated encryption mode available in every Web Crypto implementation. HKDF-SHA256 derives the AES key from the ECDH shared secret.

## Threat Model

**Platform surveillance.** Messages traverse monitored platforms (Telegram, VK, email). The adversary scans for encrypted content patterns. Encryption prevents reading; steganographic encoding prevents detection. The crypto doesn't protect against device seizure (keys are in localStorage) or a compromised browser.

**Not in scope:** forward secrecy (static key pairs). P2P messages are not digitally signed — sender identity is inferred from which contact key successfully decrypts (MSG) or from the sender key inside the encrypted envelope (INTRO). First-contact trust is TOFU unless users verify contact codes out-of-band. Broadcast messages can optionally be signed with Ed25519 (see below).

**Deniable authentication:** ECDH is symmetric — `ECDH(Alice_priv, Bob_pub) = ECDH(Bob_priv, Alice_pub)`. Both parties can verify the other's identity but neither can prove authorship to a third party.

**Contact verification:** Each contact's public key has a short verification code (SHA-256 of public key, first 8 bytes, displayed as `XXXX XXXX XXXX XXXX`). Shown on hover over contact pills and in the "Я" view.

**Identity backup:** Users can export their keypair as a passphrase-protected blob (PBKDF2-SHA256 100k iterations → AES-GCM). See `src/identity.ts`.

## Wire Format

Headerless frames — every frame starts with random bytes for optimal steganographic cover.

**Frame structures:**

| Class | Structure | Fixed overhead |
|---|---|---|
| MSG | `[seed:6][ciphertext][tag:8]` | **14 bytes** |
| INTRO | `[eph_pub:32][ciphertext][tag:8]` | **40 bytes** (seedless) |
| CONTACT | `[pub:32][check:2]` | **34 bytes** |
| BROADCAST_SIGNED | `[flags:1][x25519_pub:32][ed25519_pub:32][compressed][sig:64]` | **129 bytes** |
| BROADCAST_UNSIGNED | `[flags:1][compressed][check:2]` | **3 bytes** |

**Frame type detection order:**
1. Trial decryption as MSG (try each contact's key — 2^-64 false positive per key)
2. Trial decryption as INTRO (first 32 bytes as ephemeral key — 2^-64 false positive)
3. BROADCAST_SIGNED: flags byte discriminator `(byte[0] & 0x3F) == 0x02` + Ed25519 signature verification
4. CONTACT check byte validation (`bytes[32:34] == checkBytes(bytes[0:32])`)
5. BROADCAST_UNSIGNED: flags byte discriminator `(byte[0] & 0x3F) == 0x03` + XOR-fold checksum

AES-GCM's 64-bit tag makes false accepts astronomically unlikely (2^-64 per attempt). Safe for manual copy-paste with no decryption oracle.

**Key exchange confirmation:** The `keyExchangeConfirmed` flag on each contact tracks whether we have proof they possess our public key. Until confirmed, every outgoing message uses INTRO. After confirmation, MSG is used.

### MSG KDF

MSG uses a 6-byte random seed for per-message key derivation (static ECDH shared secret is the same for all messages between a pair).

**Compression mode** is embedded in seed[0]'s top 2 bits:

| seed[0] bits 7-6 | Mode |
|---|---|
| 00 | Literal UTF-8 |
| 01 | Squash + smaz |
| 10 | Squash only |
| 11 | Reserved |

```
seed = crypto.getRandomValues(new Uint8Array(6))
seed[0] = (seed[0] & 0x3F) | (compMode << 6)

Direction byte:
  0x00 if sender_pub < recipient_pub (lexicographic)
  0x01 otherwise

salt = "paternoster-v2" || seed      // 14 + 6 = 20 bytes
PRK  = HKDF-Extract(salt, IKM = ECDH(my_private, their_public))
OKM  = HKDF-Expand(PRK, info = [0x00, direction_byte], L = 44)

key = OKM[0..31], iv = OKM[32..43]

ciphertext = AES-GCM-256(key, iv, plaintext, tagLength=64, AAD=[0x00])
wire = seed || ciphertext || tag
```

Seed entropy: 46 random bits. Birthday collision at ~8.4M messages per contact pair.

### INTRO KDF (seedless)

INTRO uses a fresh ephemeral X25519 keypair per message. The ECDH shared secret is already unique per message (different ephemeral key each time), so no random seed is needed.

**Compression mode** is the first byte of the encrypted plaintext: `[compMode:1][sender_pub:32][compressed_msg]`.

```
eph = generateKeyPair()

PRK = HKDF-Extract(salt = "paternoster-v2", IKM = ECDH(eph_priv, recipient_pub))
OKM = HKDF-Expand(PRK, info = [0x01, direction_byte], L = 44)

key = OKM[0..31], iv = OKM[32..43]

plaintext = [compMode:1][sender_pub:32][compressed_msg]
ciphertext = AES-GCM-256(key, iv, plaintext, tagLength=64, AAD=[0x01])
wire = eph_pub || ciphertext || tag
```

### CONTACT Check Bytes

XOR-fold with two different salts, placed at the END of the frame:

```
a = 0x5A, b = 0xA5
for each byte pub[i]: a ^= pub[i]; b ^= pub[i] ^ i
CONTACT = [pub:32][a:1][b:1]
```

False positive rate: 1/65536 for random data.

### 64-bit GCM Tag

We use `tagLength: 64` (8 bytes) instead of the default 128 (16 bytes). This saves 8 bytes per message vs the Web Crypto default.

**Why this is safe:** Single-forgery probability is 2^-64 per attempt. There is no decryption oracle — the user manually pastes stegotext. An attacker cannot submit automated forgery probes. NIST's deprecation of short tags targets high-throughput automated protocols (TLS, IPsec), not manual copy-paste messaging.

### Broadcast Frames

Broadcast messages are public (readable by anyone). They use a **flags byte** with a different layout than MSG/INTRO:

```
Bits 7-6: compMode (same encoding as MSG seed[0])
Bits 5-0: frame discriminator
  0x02 = BROADCAST_SIGNED
  0x03 = BROADCAST_UNSIGNED
```

**BROADCAST_UNSIGNED:**
```
wire = [flags:1][compressed_message:N][check:2]
check = contactCheckBytes(flags || compressed_message)
```
3 bytes overhead. XOR-fold checksum (same algorithm as CONTACT). False positive: ~2^-22 (1/64 discriminator × 1/65536 checksum).

**BROADCAST_SIGNED:**
```
data = [flags:1][x25519_pub:32][ed25519_pub:32][compressed_message:N]
sig  = Ed25519.sign(ed25519_priv, data)
wire = data || sig
```
129 bytes overhead. Signature covers everything except itself.

### Ed25519 Signing for Broadcast

Ed25519 signing keys are derived from the X25519 identity key via HKDF:

```
ed25519_seed = HKDF(
  salt = "paternoster-sign-v1",
  IKM  = x25519_private_key,
  info = "ed25519",
  L    = 32
)
```

Imported via PKCS8 with Ed25519 OID (identical header to X25519, one byte different: `0x6e` → `0x70`).

**Identity binding:** The Ed25519 public key is not mathematically derivable from the X25519 public key. Binding uses TOFU — on first verified signed broadcast from a contact, the ed25519 public key is cached in the contact record. Subsequent broadcasts check the cached key.

## PKCS8 Wrapping

Web Crypto doesn't support raw X25519/Ed25519 private key import. We construct a PKCS8 ASN.1 wrapper: a fixed 16-byte header followed by the 32-byte raw key. The only difference between X25519 and Ed25519 headers is the OID byte (index 11): `0x6e` (X25519, OID 1.3.101.110) vs `0x70` (Ed25519, OID 1.3.101.112).

## Files

- `src/crypto.ts` — X25519 ECDH, AES-GCM encryption, HKDF key derivation
- `src/sign.ts` — Ed25519 key derivation, signing, verification
- `src/broadcast.ts` — broadcast frame serialization and parsing
- `src/wire.ts` — P2P wire format serialization and parsing, shared constants

## Gotchas

- `deriveBits()` returns an `ArrayBuffer`, not `Uint8Array`. Must wrap before using.
- Private key export goes through PKCS8 (48 bytes), not raw format. We slice the last 32 bytes.
- MSG seed MUST be fresh random per message. Seed reuse with the same contact pair → catastrophic GCM nonce reuse.
- INTRO uses NO seed — the ephemeral key provides per-message uniqueness. The HKDF salt is fixed.
- `tagLength: 64` must be specified on BOTH encrypt and decrypt calls.
- Class byte (0x00 MSG, 0x01 INTRO) MUST be used as AAD. It provides domain separation — the sender and receiver must agree on the class for decryption to succeed.
- Compression mode in MSG seed[0] top 2 bits is authenticated by being part of the HKDF salt. In INTRO, comp mode is inside the encrypted plaintext (authenticated by GCM).
