# Steganography

Encrypted bytes are encoded as themed text that looks like normal (if eccentric) content. The encoding is purely cosmetic — it provides concealment, not additional security. An adversary who knows the encoding scheme can decode to ciphertext, but can't decrypt without the key.

## Why Themed Encoding

Raw ciphertext (hex, base64) is instantly recognizable as encrypted data. On monitored platforms, this triggers scrutiny. Themed encoding makes ciphertext look like a prayer, a patriotic rant, profanity, or emoji spam — content that's unusual but not suspicious in the way encrypted data is. The goal: a scanning tool or human moderator sees text, not crypto.

## Encoding Models

Each model packs bytes into tokens differently. Higher model numbers = more tokens in the lookup table = more bits per token = shorter output.

| Model | Bits/token | Tokens/byte | How it works | Used by |
|---|---|---|---|---|
| 0 | 4 | 2 | Hex digits (identity transform) | hex |
| 1 | 8 | 1 | Byte value as Unicode offset from base codepoint | КИТАЙ |
| 16 | 4 | 2 | Each nibble → one of 16 tokens from tab1/tab2 | РОССИЯ, СССР, БУХАЮ |
| 64 | 2+6 | 2 | Low 2 bits → connector (tab1/tab2, 4 entries), high 6 bits → word (tab3, 64 entries) | БОЖЕ, PATER |
| 256 | 8 | 1 | Each byte → one of 256 tokens from tab256 | 🙂 (emoji) |

**Model 1 and 256 are the most compact** (1 token per byte). Model 16 and 64 need 2 tokens per byte — output is twice as long.

## Randomization (the `rand` field)

Models 16 and 64 randomly switch between `tab1` and `tab2` for the same nibble/bit-group value. Both tables decode to the same value — the randomness is cosmetic. It prevents the output from looking like a repeating pattern. The `rand` parameter (0–1) controls how often switching happens. Higher = more consistent table usage; lower = more varied output.

## Adding a New Theme

1. Choose a model (16 for word-based, 64 for connector+word, 256 for one-token-per-byte).
2. Create the word lists: tab1/tab2 must have exactly 16 entries for model 16; 4 entries for model 64; tab3 must have 64 entries for model 64; tab256 must have 256 entries for model 256.
3. **All tokens within a table must be unique after FE0F normalization.** The dictionary tests enforce this.
4. **Tokens must be prefix-free within their lookup table.** No token can be a prefix of another token in the same table. The greedy decoder depends on this.
5. Choose a unique prefix (`pre`) that doesn't collide with other themes' prefixes. Auto-detection matches on prefix.
6. Add to `THEMES` array in `dictionaries.ts` — **before `hex`** (hex must be last, it matches anything).
7. Add the theme ID to the `ThemeId` union type.
8. Add a `lang` field if TTS should use a non-Russian voice.
9. Run `npm test` — the stego roundtrip tests and dictionary validation tests will verify correctness.

## Platform Robustness

Output must survive copy-paste across Telegram, VK, WhatsApp, Instagram, Twitter/X, email. This means:

- **No invisible characters** (zero-width spaces, zero-width joiners). Platforms strip them inconsistently.
- **No combining diacriticals.** Unicode normalization (NFC/NFD) can destroy them.
- **Handle FE0F (variation selector 16).** Platforms add or strip it from emoji. All decoders strip FE0F before matching. Emoji in dictionaries may include FE0F in the source but the decoder doesn't require it.
- **No bare spaces as tokens.** Consecutive spaces get collapsed. The old РОССИЯ/СССР dictionaries had `" "` as tab1[15] — replaced with `"✨"`.
- **No regional indicator sequences** that might combine with adjacent characters.

## Files

- `src/stego.ts` — encoder/decoder for all models, auto-detection dispatch
- `src/dictionaries.ts` — theme definitions (word lists, params)

## Gotchas

- Auto-detection iterates `THEMES` array in order. First theme whose prefix matches wins. If two themes have overlapping prefixes, the one listed first takes priority.
- Model 0 (hex) has no prefix check — it tries to decode any text as hex. That's why it must be last in the array.
- Encoder output is non-deterministic (random tab switching, random separators). The decoder accepts output from any randomization. You can't compare two encodings of the same data for equality.
- Model 256's greedy decoder tries longest token first. If tokens aren't prefix-free, it may match the wrong one.
