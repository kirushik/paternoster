# Cryptography

End-to-end encryption using X25519 key exchange, AES-256-GCM authenticated encryption, and HKDF-SHA256 key derivation. All via the browser's Web Crypto API — no bundled crypto library.

## Why Web Crypto Only

The original codebase bundled noble-curves (5350 lines). Web Crypto API added X25519 support in Chrome 113, Firefox 128, Safari 17.4. Dropping the library cut bundle size by 5KB (after minification) and eliminated a supply chain trust dependency. Browsers that don't support X25519 get a hard error in Russian.

## Why X25519 + AES-GCM

X25519 (Curve25519 ECDH) provides 128-bit security with 32-byte keys — the shortest keys at this security level. Short keys mean shorter contact tokens and invite links. AES-256-GCM is the standard authenticated encryption mode available in every Web Crypto implementation. HKDF-SHA256 derives the AES key from the ECDH shared secret.

## Threat Model

**Platform surveillance.** Messages traverse monitored platforms (Telegram, VK, email). The adversary scans for encrypted content patterns. Encryption prevents reading; steganographic encoding prevents detection. The crypto doesn't protect against device seizure (keys are in localStorage) or a compromised browser.

**Not in scope:** forward secrecy (static key pairs). P2P messages are not digitally signed — sender identity is inferred from which contact key successfully decrypts (MSG) or from the sender key inside the encrypted envelope (INTRO). First-contact trust is TOFU unless users verify contact codes out-of-band. Broadcast messages can optionally carry a signature produced by a custom X25519-key-based signing construction inspired by XEdDSA; verification is performed through Web Crypto Ed25519 after public-key conversion (see below).

**Deniable authentication (P2P only):** ECDH is symmetric — `ECDH(Alice_priv, Bob_pub) = ECDH(Bob_priv, Alice_pub)`. Both parties can verify the other's identity but neither can prove authorship to a third party. Signed broadcasts are NOT deniable — the signature is a public proof of authorship by the holder of the signing key.

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
| BROADCAST_SIGNED | `[compressed][flags:1][x25519_fp:2][xeddsa_sig:64]` | **67 bytes** |
| BROADCAST_UNSIGNED | `[compressed][flags:1][check:2]` | **3 bytes** |

**Frame type detection order (normative):** Implementations MUST try types in this exact sequence. Reordering changes false-accept behavior since earlier stages (AEAD trial decryption, 2^-64) reject far more strongly than later stages (checksum, 2^-16).

1. Trial decryption as MSG (try each contact's key — 2^-64 false positive per key)
2. Trial decryption as INTRO (first 32 bytes as ephemeral key — 2^-64 false positive)
3. BROADCAST_SIGNED: flags byte discriminator `(byte[len-67] & 0x3F) == 0x02` + fingerprint lookup + XEdDSA signature verification via Web Crypto Ed25519
4. CONTACT check bytes validation (`bytes[32:34] == SHA256(bytes[0:32] || domain)[0:2]`)
5. BROADCAST_UNSIGNED: flags byte discriminator `(byte[len-3] & 0x3F) == 0x03` + SHA-256 truncated checksum

AES-GCM's 64-bit tag gives 2^-64 false accept probability per trial decryption attempt — acceptable for manual copy-paste with no decryption oracle (see "64-bit GCM Tag" below).

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

Truncated SHA-256 with domain separation, placed at the END of the frame:

```
hash = SHA-256(data || "paternoster-check-v2")
check = hash[0:2]
CONTACT = [pub:32][check[0]:1][check[1]:1]
```

False positive rate: 1/65536 for random data. Check bytes provide corruption/typo detection, not cryptographic authenticity. CONTACT tokens are unauthenticated — trust is established via TOFU on first use.

### 64-bit GCM Tag

We use `tagLength: 64` (8 bytes) instead of the default 128 (16 bytes). This saves 8 bytes per message vs the Web Crypto default.

**Why this tradeoff is acceptable here:** 64-bit tags are weaker than the standard 128-bit choice. Single-forgery probability is 2^-64 per attempt. This is acceptable because message handling is manual (user copy-pastes stegotext), low-volume, and does not expose a decryption oracle — an attacker cannot submit automated forgery probes. NIST's deprecation of short tags targets high-throughput automated protocols (TLS, IPsec), not manual copy-paste messaging.

**NIST constraints:** SP 800-38D Appendix C constrains 64-bit tags to max 2^22 bytes (4 MB) plaintext per invocation and max 2^11 (2048) invocations per key. Paternoster is well within both: stegotext messages are kilobytes, and manual copy-paste means dozens of messages per contact pair. NIST's upcoming SP 800-38D revision will remove support for tags shorter than 96 bits in new protocols; Paternoster's 64-bit tag is a deliberate size-first tradeoff for this specific manual, low-volume use case.

### Broadcast Frames

Broadcast messages are public (readable by anyone). They use a **flags byte** with a different layout than MSG/INTRO:

```
Bits 7-6: compMode (same encoding as MSG seed[0])
Bits 5-0: frame discriminator
  0x02 = BROADCAST_SIGNED
  0x03 = BROADCAST_UNSIGNED
```

Fixed fields are placed at the TAIL so that the variable-length compressed content leads the frame. This prevents repeatable first-token patterns in steganographic output (otherwise the first few stego tokens would be identical across all broadcasts from the same sender).

**BROADCAST_UNSIGNED:**
```
body = [compressed_message:N][flags:1]
check = contactCheckBytes(body)
wire = body || check
```
3 bytes overhead. SHA-256 truncated checksum (same algorithm as CONTACT). False positive: ~2^-22 (1/64 discriminator × 1/65536 checksum).

**BROADCAST_SIGNED:**
```
data = [compressed_message:N][flags:1][x25519_fp:2]
sig  = XEdDSA.sign(x25519_priv, data)
wire = data || sig
```
67 bytes overhead. 2-byte fingerprint (first 2 bytes of SHA-256(x25519_pub)) for sender identification by recipients who already have the sender as a contact.

### XEdDSA Signing for Broadcast

Custom signing construction inspired by Signal's XEdDSA specification (Trevor Perrin, 2016). Signs with the X25519 private key directly — no separate Ed25519 keypair needed.

**Why XEdDSA?** Montgomery (X25519) and twisted Edwards (Ed25519) curves are birationally equivalent. The same clamped scalar works for both ECDH and signing. This eliminates the need for a separate signing keypair and the TOFU state management that would require.

**Signing (custom code, ~100 lines BigInt):** The X25519 private scalar (clamped) is used for Ed25519-style scalar multiplication on the Edwards curve. If the resulting public key has odd x-coordinate, the scalar is negated mod L to force even x (sign bit 0). Deterministic nonce via `SHA-512(0xFE*32 || scalar || message)` (same domain separator as the XEdDSA spec). This path is more experimental than the browser-native P2P encryption — it uses inline BigInt arithmetic, not Web Crypto, for the signing operation.

**Verification (Web Crypto):** Convert X25519 public key to Edwards compressed point via the birational map `y = (u - 1) * (u + 1)^(-1) mod p`, sign bit 0. Import as Ed25519 public key, then standard `crypto.subtle.verify("Ed25519", ...)`. The verification side is entirely browser-native.

**Montgomery → Edwards conversion:** The birational map converts any X25519 u-coordinate to an Edwards y-coordinate. For degenerate inputs (u=0, u=1, u=p-1 — torsion points not reachable by honest key generation), verification fails gracefully and returns false. Tests cover these edge cases explicitly.

**Clamping note:** Chrome/BoringSSL exports X25519 private keys as unclamped seed bytes; Node.js/OpenSSL exports already-clamped scalars. The signing code always applies clamping before use (idempotent).

## PKCS8 Wrapping

Web Crypto doesn't support raw X25519 private key import. We construct a PKCS8 ASN.1 wrapper: a fixed 16-byte header followed by the 32-byte raw key.

## Files

- `src/crypto.ts` — X25519 ECDH, AES-GCM encryption, HKDF key derivation
- `src/sign.ts` — XEdDSA signing (inline BigInt Ed25519 arithmetic), Montgomery↔Edwards conversion, Web Crypto verification
- `src/broadcast.ts` — broadcast frame serialization and parsing (standard + compact modes)
- `src/wire.ts` — P2P wire format serialization and parsing, shared constants

## Gotchas

- `deriveBits()` returns an `ArrayBuffer`, not `Uint8Array`. Must wrap before using.
- Private key export goes through PKCS8 (48 bytes), not raw format. We slice the last 32 bytes.
- MSG seed MUST be fresh random per message. Seed reuse with the same contact pair → catastrophic GCM nonce reuse.
- INTRO uses NO seed — the ephemeral key provides per-message uniqueness. The HKDF salt is fixed.
- `tagLength: 64` must be specified on BOTH encrypt and decrypt calls.
- Class byte (0x00 MSG, 0x01 INTRO) MUST be used as AAD. It provides domain separation — the sender and receiver must agree on the class for decryption to succeed.
- Compression mode in MSG seed[0] top 2 bits is authenticated by being part of the HKDF salt. In INTRO, comp mode is inside the encrypted plaintext (authenticated by GCM).
