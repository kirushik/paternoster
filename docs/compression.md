# Compression

Plaintext is compressed before encryption to minimize ciphertext size (and therefore steganographic output length). The pipeline: squash encoding → smaz dictionary compression → pick smaller of compressed vs literal.

## Why Compress Before Encryption

Encrypted data is indistinguishable from random bytes — compressors can't find patterns in it. Compression must happen before encryption. Shorter ciphertext means shorter steganographic output, which means more natural-looking cover text (a 50-word prayer is more plausible than a 200-word one).

## Why Squash + Smaz

**Squash encoding** maps UTF-8 Cyrillic (2 bytes per char) to CP1251 single bytes. Pure Russian text shrinks ~50% before any compression runs. Non-CP1251 chars (emoji, CJK) are escaped as `0x98` + inline UTF-8 — graceful degradation, not data loss. The old codebase used `uwb()` which silently replaced non-Cyrillic with `?`. Squash is reversible.

**Smaz** is designed for short strings. It uses a codebook of 253 common byte sequences — greedy trie matching replaces multi-byte patterns with 1-byte indices. The codebook was trained on ~370K Russian blog comments (squash-encoded). Unmatched bytes are stored verbatim with 1-2 byte overhead.

**Why not zstd in V1:** zstd achieves 0.464 ratio vs smaz's 0.471 — marginal improvement. But zstd's WASM decoder is ~30KB + the 64KB trained dictionary = ~110KB added to the HTML file (currently 30KB total). The wire format reserves flags for zstd (0x80) so it can be added later without breaking compatibility. Trained dictionaries already exist at `compression/results/dict_zstd_cp1251_*.dict`.

## Compression Flags (inner wire format)

First byte of the compressed blob:

| Flag | Meaning | When used |
|---|---|---|
| `0xC0` | Squash + smaz | Most Russian messages |
| `0x3F` | Literal UTF-8 | When compression expands (very short or high-entropy) |
| `0x80` | Squash + zstd+dict | Reserved for V2 |
| `0x40` | UTF-8 + smaz | Reserved (squash encoding failed) |

The compressor tries squash+smaz and compares with literal UTF-8. Whichever is smaller wins. The flag byte tells the decompressor which path to reverse.

## Expected Ratios

From benchmarks on Russian blog comments (vs original UTF-8):

| Message size | Best method | Ratio |
|---|---|---|
| < 50 bytes | Smaz + squash | 0.64 |
| 50–200 bytes | Smaz + squash | 0.48 |
| 200+ bytes | Would be zstd territory | (not in V1) |

## Files

- `src/compress.ts` — dispatch (tries methods, picks smallest)
- `src/squash.ts` — CP1251 pre-encoding
- `src/smaz.ts` — trie-based codebook compressor + embedded 253-entry codebook
- `compression/results/guide.md` — full benchmark report and training procedures
- `compression/results/smaz_codebook_squash.json` — the trained codebook (253 hex entries)

## Gotchas

- Smaz's `decompress()` throws on malformed input (truncated escapes, invalid indices). Don't catch these silently — they indicate data corruption.
- The squash escape byte is `0x98` — the only unmapped byte in CP1251. If CP1251 ever gets an update mapping 0x98 to something, squash breaks. (This won't happen.)
- Compression can *expand* short messages. The dispatch always falls back to literal (0x3F) when that happens.
- `decompress()` throws on unknown flags with a user-facing Russian error message suggesting the message may be from a newer version. Don't silence this — it's better than returning garbage from an unsupported compression method.
