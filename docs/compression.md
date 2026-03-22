# Compression

Plaintext is compressed before encryption to minimize ciphertext size (and therefore steganographic output length). The compressor tries three modes — literal UTF-8, squash-only, squash+smaz — and picks the smallest.

## Why Compress Before Encryption

Encrypted data is indistinguishable from random bytes — compressors can't find patterns in it. Compression must happen before encryption. Shorter ciphertext means shorter steganographic output, which means more natural-looking cover text (a 50-word prayer is more plausible than a 200-word one).

## Compression Modes

The compression mode is signaled in the wire header byte (MM bits), not inside the encrypted payload. The header byte is authenticated via AAD — tampering causes decryption failure.

| Header MM bits | Mode | When used |
|---|---|---|
| `00` | Literal UTF-8 | When no compression helps (very short or high-entropy) |
| `01` | Squash + smaz | Most Russian messages (when smaz compresses well) |
| `10` | Squash only | When smaz's escape overhead would expand the squashed output |
| `11` | Reserved | (future: tinyphrase, zstd, etc.) |

The compressor tries all three and picks whichever produces the smallest payload. This guarantee means the compressed output is never larger than the original UTF-8.

## Why Squash

**Squash encoding** maps UTF-8 Cyrillic (2 bytes per char) to CP1251 single bytes. Pure Russian text shrinks ~50% before any further compression runs. Non-CP1251 chars (emoji, CJK) are escaped as `0x98` + inline UTF-8 — graceful degradation, not data loss.

## Why Squash + Smaz

**Smaz** is designed for short strings. It uses a codebook of 253 common byte sequences — greedy trie matching replaces multi-byte patterns with 1-byte indices. The codebook was trained on ~370K Russian blog comments (squash-encoded). Unmatched bytes are stored verbatim with 1-2 byte overhead.

Smaz adds only ~4% compression on top of squash for typical messages, but the combined pipeline is still worth trying.

## Why Squash-Only

Squash without smaz is better when smaz's verbatim escape overhead would actually expand the squashed output. This happens with:
- Very short messages (1-3 characters) — smaz can't find codebook matches
- Emoji-heavy content — smaz escapes every non-matching byte at 2x cost
- Mixed-script text — non-Cyrillic squash escapes don't match smaz's codebook

Squash-only guarantees Cyrillic characters are 1 byte each (vs 2 in UTF-8) with no expansion risk.

## Why not zstd

Zstd achieves 0.464 ratio vs smaz's 0.471 — marginal improvement. But zstd's WASM decoder is ~30KB + the 64KB trained dictionary = ~110KB added to the HTML file. Trained dictionaries exist at `compression/results/dict_zstd_cp1251_*.dict` for future use.

## Expected Ratios

From benchmarks on Russian blog comments (vs original UTF-8):

| Message size | Best method | Ratio |
|---|---|---|
| < 50 bytes | Squash-only or squash+smaz | 0.50–0.64 |
| 50–200 bytes | Squash + smaz | 0.48 |
| 200+ bytes | Would be zstd territory | (not yet implemented) |

## Files

- `src/compress.ts` — dispatch (tries all modes, picks smallest)
- `src/squash.ts` — CP1251 pre-encoding
- `src/smaz.ts` — trie-based codebook compressor + embedded 253-entry codebook
- `compression/results/guide.md` — full benchmark report and training procedures
- `compression/results/smaz_codebook_squash.json` — the trained codebook (253 hex entries)

## Gotchas

- Smaz's `decompress()` throws on malformed input (truncated escapes, invalid indices). Don't catch these silently — they indicate data corruption.
- The squash escape byte is `0x98` — the only unmapped byte in CP1251. If CP1251 ever gets an update mapping 0x98 to something, squash breaks. (This won't happen.)
- The compressor never expands: it always falls back to the smallest of literal, squash-only, and squash+smaz.
- `decompress()` throws on unknown compression modes with a user-facing Russian error message suggesting the message may be from a newer version.
