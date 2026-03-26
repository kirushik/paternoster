# Steganography

Encrypted bytes (or broadcast frames) are encoded as themed text that looks like normal (if eccentric) content. The encoding is purely cosmetic — it provides concealment, not additional security. An adversary who knows the encoding scheme can decode to raw bytes, but can't decrypt P2P messages without the key. Broadcast messages are public by design, but the stego layer still conceals their nature as structured data.

## Why Themed Encoding

Raw ciphertext (hex, base64) is instantly recognizable as encrypted data. On monitored platforms, this triggers scrutiny. Themed encoding makes ciphertext look like a prayer, a patriotic rant, profanity, or emoji spam — content that's unusual but not suspicious in the way encrypted data is. The goal: a scanning tool or human moderator sees text, not crypto.

## Encoding Models

Each model packs bytes into tokens differently. Higher model numbers = more tokens in the lookup table = more bits per token = shorter output.

| Model | Bits/token | Ratio | How it works | Used by |
|---|---|---|---|---|
| 0 | 4 | 2 tokens/byte | Hex digits (identity transform) | hex |
| 16 | 4 | 2 tokens/byte | Each nibble → one of 16 tokens from tab1/tab2 | РОССИЯ, СССР, БУХАЮ |
| 1024 | 10 | 4 tokens/5 bytes | 10-bit groups from a string of 1024 emoji chars | 🙂 (emoji) |
| 4096 | 12 | 2 tokens/3 bytes | 12-bit pairs; flat mode (CJK offsets) or structured mode (16 connectors × 256 words) | КИТАЙ (flat), БОЖЕ, PATER (structured) |

**Model 4096 is the most compact** (2 tokens per 3 bytes, ~33% shorter than 1:1). It has two modes: *flat* (sequential Unicode codepoints from a base, used by КИТАЙ) and *structured* (16 connectors × 256 words producing prose, used by БОЖЕ and PATER). Model 1024 is also compact (`ceil((4 + N*8) / 10)` tokens for N bytes, ~20% shorter). Model 16 needs 2 tokens per byte.

Model 1024 uses **bit-stream encoding**: a 4-bit header (trailing pad bit count, 0–9) followed by data bits, packed continuously into 10-bit tokens. This avoids the chunk-alignment waste of fixed-size grouping. Model 4096 prepends a 1-byte padding count and pads to its 3-byte chunk boundary.

## Randomization (the `rand` field)

Model 16 randomly switches between `tab1` and `tab2` for the same nibble value. Both tables decode to the same byte — the randomness is cosmetic. It prevents the output from looking like a repeating pattern. The `rand` parameter (0–1) controls how often switching happens. Higher = more consistent table usage; lower = more varied output.

Model 4096 flat mode inserts cosmetic spaces between token pairs controlled by `rand`. Model 1024 emits tokens without separators.

## Adding a New Theme

1. Choose a model (16 for word-based, 1024 for emoji/symbol, 4096 for sequential Unicode ranges or connector+word prose).
2. Create the token tables:
   - Model 16: tab1/tab2 with exactly 16 entries each
   - Model 1024: a `chars` string of exactly 1024 single-codepoint characters
   - Model 4096 flat: a `base` codepoint with 4096 sequential characters available
   - Model 4096 structured: tab1 (8 connectors) + tab2 (8 connectors) = 16 connectors, plus `words` (256 space-delimited words)
3. **All tokens within a table must be unique after FE0F normalization.** The dictionary tests enforce this.
4. **Tokens must be prefix-free within their lookup table.** No token can be a prefix of another token in the same table. The greedy decoder depends on this.
5. **Emoji tokens must not overlap with other themes.** РОССИЯ and СССР tab1 emoji must be disjoint from each other and from the 🙂 chars string. The dictionary tests enforce this (see `dictionaries.test.ts` — "emoji token uniqueness across themes").
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
- **Trailing whitespace tolerance.** Model 16 tokens include trailing spaces as separators (e.g. `'ладно '`). Copy-paste or input trimming may strip the last separator. The decoder pads the input with a trailing space if absent and tolerates whitespace-only remainders after parsing.
- **No regional indicator sequences** that might combine with adjacent characters.

## Files

- `src/stego.ts` — encoder/decoder for all models, auto-detection dispatch
- `src/dictionaries.ts` — theme definitions (word lists, params, emoji chars)

## Size Limits

There is no hard byte-count limit on stego encoding/decoding — arbitrarily large payloads round-trip correctly for all models. The decoder loops are bounded by input length (each iteration consumes at least one character), so there is no risk of infinite loops on well-formed or malformed input.

The practical limit is the **stego output character count**. The UI enforces a maximum of **50,000 characters** (`MAX_STEGO_CHARS` in `main.ts`). This keeps output within common messenger character limits (WhatsApp: 65K, Telegram: 4K per message) and ensures fast decoding on slow devices (~1s worst case at 50× slowdown).

Expansion ratios vary by model:

| Theme | Model | Expansion (chars/byte) | Max payload at 50K limit |
|---|---|---|---|
| БУХАЮ | 16 | ~11.8× | ~4,200 bytes |
| СССР | 16 | ~9.2× | ~5,400 bytes |
| PATER | 4096 | ~9.1× | ~5,500 bytes |
| БОЖЕ | 4096 | ~8.8× | ~5,700 bytes |
| РОССИЯ | 16 | ~7.9× | ~6,300 bytes |
| hex | 0 | 2.0× | ~25,000 bytes |
| 🙂 | 1024 | 1.6× | ~31,000 bytes |
| КИТАЙ | 4096 | 0.7× | ~71,000 bytes |

For Russian text with squash compression (~1 byte/char), these translate roughly to the same numbers in input characters.

## Gotchas

- Auto-detection iterates `THEMES` array in order, trying each decoder. First theme whose decoder successfully parses the input wins. Themes are ordered by token-set distinctiveness (most unique first) to minimize false-positive attempts.
- Model 0 (hex) tries to decode any text as hex. That's why it must be last in the array.
- Encoder output is non-deterministic (random tab switching in model 16, random cosmetic spaces in model 4096 flat, random connector choice in model 4096 structured). The decoder accepts output from any randomization. You can't compare two encodings of the same data for equality.
- Model 1024 encodes the pad-bit count in a 4-bit header inside the first 10-bit token. Empty input still produces one token (encoding this header).
- Model 4096 prepends a 1-byte padding count and pads to a 3-byte chunk boundary. Empty input still produces tokens encoding this padding byte (and any required padding).
