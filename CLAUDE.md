# Paternoster

Steganographic encrypted messaging. Messages are encrypted and disguised as themed text (prayers, slogans, emoji, etc.). Single self-contained HTML file, no server.

## Commands

```bash
npm run dev          # Vite dev server
npm run build        # TypeScript check + Vite build → dist/index.html
npm test             # Vitest unit + integration tests
npm run test:e2e     # Playwright E2E tests (needs `npx playwright install chromium` first)
```

## Conventions

- **TypeScript strict mode.** No `any` unless truly unavoidable.
- **All UI text is Russian.** No i18n, no English in the interface.
- **Zero crypto jargon in UI.** Users see "контакт", never "ключ" or "X25519". See [docs/ux.md](docs/ux.md).
- **Frozen theme objects.** Dictionaries in `dictionaries.ts` must never be mutated at runtime.
- **All themes must roundtrip.** Encode → decode must return identical bytes for every byte value 0x00–0xFF. Tests enforce this.

## When Working On...

- **Crypto (encrypt, decrypt, keys):** Read [docs/crypto.md](docs/crypto.md) first — explains wire format, PKCS8 wrapping, and why HKDF uses non-empty salt.
- **Encoding themes:** Read [docs/steganography.md](docs/steganography.md) — model types (0/1/16/64/256), how to add a theme, FE0F normalization.
- **Compression:** Read [docs/compression.md](docs/compression.md) — squash+smaz pipeline, flags byte layout, why no zstd in V1.
- **UI / state machine:** Read [docs/ux.md](docs/ux.md) — single-field auto-detect design, contact exchange flows.
- **Tests:** Read [docs/testing.md](docs/testing.md) — test layers, structure, how to add tests.
- **Architecture / new modules:** Read [docs/architecture.md](docs/architecture.md) — module map, data flow, build output.

## Pitfalls (things that have caused bugs before)

1. **Private key import needs PKCS8 wrapping.** Web Crypto X25519 doesn't support raw private key import. We construct a 16-byte ASN.1 header + 32-byte key. See `crypto.ts:51-58`.
2. **Emoji have invisible variation selectors (U+FE0F).** Platforms add/strip them inconsistently. All stego decoders must normalize by stripping FE0F before matching. See `stego.ts:17-26`.
3. **`hexU8()` throws on invalid input.** It used to silently produce NaN bytes. Don't catch the error unless you have a good reason.
4. **smaz codebook indices 253+ are escape codes.** Index 253 = invalid. 254 = single verbatim byte. 255 = N verbatim bytes. The decompress function throws on out-of-bounds access.
5. **Auto-detection order matters.** `THEMES` array order in `dictionaries.ts` determines which theme is tried first. `hex` must always be last (matches anything).
6. **Theme `rand` field is for cosmetic randomness only.** It makes output look more varied but carries no data. Both tab1 and tab2 tokens decode to the same value.

## The Golden Rule

**After ANY code change, update the relevant doc in `docs/`.** If you add a theme, update `docs/steganography.md`. If you change the wire format, update `docs/crypto.md`. If you add a test pattern, update `docs/testing.md`. Documentation that drifts from code is worse than no documentation.
