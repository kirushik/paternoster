# Steganography

Encrypted bytes are encoded as themed text that looks like normal (if eccentric) content. The encoding is purely cosmetic — it provides concealment, not additional security. An adversary who knows the encoding scheme can decode to ciphertext, but can't decrypt without the key.

## Why Themed Encoding

Raw ciphertext (hex, base64) is instantly recognizable as encrypted data. On monitored platforms, this triggers scrutiny. Themed encoding makes ciphertext look like a prayer, a patriotic rant, profanity, or emoji spam — content that's unusual but not suspicious in the way encrypted data is. The goal: a scanning tool or human moderator sees text, not crypto.

## Encoding Models

Each model packs bytes into tokens differently. Higher model numbers = more tokens in the lookup table = more bits per token = shorter output.

| Model | Bits/token | Ratio | How it works | Used by |
|---|---|---|---|---|
| 0 | 4 | 2 tokens/byte | Hex digits (identity transform) | hex |
| 16 | 4 | 2 tokens/byte | Each nibble → one of 16 tokens from tab1/tab2 | РОССИЯ, СССР, БУХАЮ |
| 64 | 2+6 | 2 tokens/byte | Low 2 bits → connector (tab1/tab2), high 6 bits → word (tab3) | БОЖЕ, PATER |
| 1024 | 10 | 4 tokens/5 bytes | 10-bit groups from a string of 1024 emoji chars | 🙂 (emoji) |
| 4096 | 12 | 2 tokens/3 bytes | 12-bit pairs as Unicode offsets from base codepoint | КИТАЙ |

**Model 4096 is the most compact** (2 tokens per 3 bytes, ~33% shorter than 1:1). Model 1024 is also compact (4 tokens per 5 bytes, ~20% shorter). Models 16 and 64 need 2 tokens per byte.

Models 1024 and 4096 prepend a 1-byte padding count before encoding. The input is padded to the chunk boundary (5 bytes for 1024, 3 bytes for 4096). The decoder strips the padding using this count byte.

## Randomization (the `rand` field)

Models 16 and 64 randomly switch between `tab1` and `tab2` for the same nibble/bit-group value. Both tables decode to the same value — the randomness is cosmetic. It prevents the output from looking like a repeating pattern. The `rand` parameter (0–1) controls how often switching happens. Higher = more consistent table usage; lower = more varied output.

Models 1024 and 4096 insert cosmetic spaces between tokens controlled by `rand`.

## Adding a New Theme

1. Choose a model (16 for word-based, 64 for connector+word, 1024 for emoji/symbol, 4096 for sequential Unicode ranges).
2. Create the token tables:
   - Model 16: tab1/tab2 with exactly 16 entries each
   - Model 64: tab1/tab2 with 4 entries, tab3 with 64 entries
   - Model 1024: a `chars` string of exactly 1024 single-codepoint characters
   - Model 4096: a `base` codepoint with 4096 sequential characters available
3. **All tokens within a table must be unique after FE0F normalization.** The dictionary tests enforce this.
4. **Tokens must be prefix-free within their lookup table.** No token can be a prefix of another token in the same table. The greedy decoder depends on this.
5. **Emoji tokens must not overlap with other themes.** РОССИЯ and СССР tab1 emoji must be disjoint from each other and from the 🙂 chars string. The dictionary tests enforce this.
6. Ensure your theme's token vocabulary doesn't overlap with existing themes. Auto-detection tries each decoder in order; the first one that successfully parses the input wins.
7. Add to `THEMES` array in `dictionaries.ts` — **before `hex`** (hex must be last, it matches anything). Place more distinctive themes (unique character sets) earlier in the array.
8. Add the theme ID to the `ThemeId` union type.
9. Add a `lang` field if TTS should use a non-Russian voice.
10. Run `npm test` — the stego roundtrip tests and dictionary validation tests will verify correctness.

## Platform Robustness

Output must survive copy-paste across Telegram, VK, WhatsApp, Instagram, Twitter/X, email. This means:

- **No invisible characters** (zero-width spaces, zero-width joiners). Platforms strip them inconsistently.
- **No combining diacriticals.** Unicode normalization (NFC/NFD) can destroy them.
- **Handle FE0F (variation selector 16).** Platforms add or strip it from emoji. All decoders strip FE0F before matching. Emoji in dictionaries may include FE0F in the source but the decoder doesn't require it.
- **No bare spaces as tokens.** Consecutive spaces get collapsed. The old РОССИЯ/СССР dictionaries had `" "` as tab1[15] — replaced with `"✨"`.
- **No regional indicator sequences** that might combine with adjacent characters.

## Files

- `src/stego.ts` — encoder/decoder for all models, auto-detection dispatch
- `src/dictionaries.ts` — theme definitions (word lists, params, emoji chars)

## Gotchas

- Auto-detection iterates `THEMES` array in order, trying each decoder. First theme whose decoder successfully parses the input wins. Themes are ordered by token-set distinctiveness (most unique first) to minimize false-positive attempts.
- Model 0 (hex) tries to decode any text as hex. That's why it must be last in the array.
- Encoder output is non-deterministic (random tab switching, random separators). The decoder accepts output from any randomization. You can't compare two encodings of the same data for equality.
- Model 1024/4096 prepend a padding count byte. Empty input still produces tokens (encoding the padding byte).
