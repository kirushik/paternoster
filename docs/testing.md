# Testing

Tests across three layers: unit, integration, and E2E. Tests follow the project's intent, not just the code — several bugs were discovered and fixed by writing tests against expected behavior.

## Why Three Layers

**Unit tests** (Vitest, 159 tests) verify each module in isolation. Fast — full suite runs in <1 second. Catches encoding edge cases, compression roundtrips, dictionary validation. These are the first thing to break when you change internal logic.

**Integration tests** (Vitest, 41 tests) verify the full pipeline: plaintext → compress → encrypt → wire → stego → and back. These catch mismatches between modules (e.g., wire format serialized differently than expected by the decoder, or compression flags not handled by decompressor).

**E2E tests** (Playwright, 17 tests) verify the actual browser experience. Page loads, key generation persists across reloads, typing produces encoded output, two browser contexts exchange messages with multi-round back-and-forth conversation, invite links work, TTS button calls speechSynthesis with the correct language. These catch DOM wiring bugs and browser API issues that unit tests can't see.

## Commands

```bash
npm test                 # Unit + integration (Vitest)
npm run test:watch       # Vitest in watch mode
npm run test:e2e         # Playwright E2E (requires: npx playwright install chromium)
npm run test:all         # Both
```

Vitest uses a project-local cache dir (`.vitest-cache/`) to avoid sandbox tmp issues.

## Test Structure

```
tests/
├── unit/
│   ├── utils.test.ts         # Hex, base64url, concat, equality, contact codes (27 tests)
│   ├── squash.test.ts        # CP1251 encoding roundtrips, ratio checks (15)
│   ├── smaz.test.ts          # Codebook compression, bounds checking (18)
│   ├── compress.test.ts      # Dispatch, flag selection, size reduction, unknown flags (11)
│   ├── wire.test.ts          # Serialize/deserialize all frame types, strict lengths (12)
│   ├── stego.test.ts         # All models × all byte values, auto-detect, edge cases (39)
│   ├── dictionaries.test.ts  # Table sizes, uniqueness, prefix-free (30)
│   ├── contacts.test.ts      # CRUD with localStorage mock, schema validation (17)
│   └── identity.test.ts      # Export/import roundtrip, wrong passphrase, corruption (5)
├── integration/
│   ├── pipeline.test.ts      # Full encrypt→stego→decrypt roundtrip per theme (24)
│   ├── contact-exchange.test.ts  # Contact token through stego roundtrip (9)
│   └── invite.test.ts        # Base64url token generate/parse (8)
└── e2e/
    ├── basic.spec.ts         # Page load, key persistence, encode, copy, download (6)
    ├── contacts.spec.ts      # Contact add/remove, invite link import (4)
    ├── conversation.spec.ts  # Full multi-round conversation with key exchange confirmation (1)
    ├── crypto-roundtrip.spec.ts  # Alice↔Bob single message exchange (1)
    └── tts.spec.ts           # Button behavior, language per theme (5)
```

## Adding Tests

**New theme:** The stego roundtrip test (`stego.test.ts`) automatically tests all themes in the `THEMES` array. The dictionary test validates table sizes and uniqueness. Just add the theme to `dictionaries.ts` — tests pick it up.

**New compression method:** Add roundtrip tests in `compress.test.ts`. Note that unknown flags now throw (not silent fallback) — test accordingly. The pipeline integration tests already cover the full path.

**New UI feature:** Add an E2E test in `tests/e2e/`. Playwright config uses `workers: 1` and `retries: 2` on CI for stability.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs two parallel jobs: unit tests and E2E tests. Playwright browsers are cached by version. Test reports are uploaded as artifacts on failure. See the workflow file for details.

## Gotchas

- The app uses custom `<dialog>` DOM elements (`dialog.app-dialog`), not native `window.prompt()`. E2E tests must interact with these via DOM selectors (fill inputs by placeholder, click `.dialog-confirm`), not `page.on('dialog')`.
- E2E tests that intercept `speechSynthesis.speak` must set up the interceptor *before* clicking the TTS button, not after. The interceptor replaces the function, so timing matters.
- `contacts.test.ts` mocks `localStorage` via `vi.stubGlobal`. The mock is reset in `beforeEach`.
- Integration tests (pipeline, contact-exchange) use Web Crypto which requires a browser-like environment. Vitest runs in Node which supports Web Crypto natively — no special config needed.
