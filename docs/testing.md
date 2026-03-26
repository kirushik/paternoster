# Testing

Tests across three layers: unit, integration, and E2E. Tests follow the project's intent, not just the code — several bugs were discovered and fixed by writing tests against expected behavior.

## Why Three Layers

**Unit tests** (Vitest, ~195 tests) verify each module in isolation. Fast — full suite runs in <2 seconds. Catches encoding edge cases, compression roundtrips, dictionary validation. Includes property-based tests (`properties.test.ts`) that generate thousands of random inputs per invariant. These are the first thing to break when you change internal logic.

**Integration tests** (Vitest, ~55 tests) verify the full pipeline: plaintext → compress → encrypt → wire → stego → and back. These catch mismatches between modules (e.g., wire format serialized differently than expected by the decoder, or compression flags not handled by decompressor).

**E2E tests** (Playwright, 42 tests) verify the actual browser experience. Page loads, key generation persists across reloads, typing produces encoded output, two browser contexts exchange messages with multi-round back-and-forth conversation, invite links work, TTS button calls speechSynthesis with the correct language, every theme roundtrips correctly through two-party encode→decode, and broadcast mode UX (warm background, banner exit, auto-detect of pasted content including P2P auto-switch). These catch DOM wiring bugs and browser API issues that unit tests can't see.

## Commands

```bash
npm test                 # Unit + integration + type tests (Vitest)
npm test -- --coverage   # Same, with V8 coverage report
npm run test:watch       # Vitest in watch mode
npm run test:e2e         # Playwright E2E (requires: npx playwright install chromium)
npm run test:all         # Both
npm run test:mutate      # Stryker mutation testing (slow, ~10-15 min)
```

Vitest uses a project-local cache dir (`.vitest-cache/`) to avoid sandbox tmp issues.

## Coverage

V8 coverage is configured in `vitest.config.ts`. CI runs with `--coverage` and enforces 80% thresholds (branches, functions, lines, statements) across all `src/` modules except `main.ts` (DOM-coupled, tested via E2E only). HTML reports go to `coverage/` (gitignored).

## Test Structure

```
tests/
├── helpers.ts               # Shared test utilities: makeMsgFrame, makeIntroFrame, ALL_THEME_IDS, Identity type
├── unit/
│   ├── utils.test.ts         # Hex, base64url, concat, equality, contact codes (27 tests)
│   ├── squash.test.ts        # CP1251 encoding roundtrips, ratio checks (15)
│   ├── smaz.test.ts          # Codebook compression, bounds checking (18)
│   ├── compress.test.ts      # Dispatch, flag selection, size reduction, unknown flags (11)
│   ├── wire.test.ts          # Serialize/deserialize all frame types, strict lengths, inline snapshots (16)
│   ├── stego.test.ts         # All models × all byte values, auto-detect, large payloads, edge cases (66)
│   ├── dictionaries.test.ts  # Table sizes, uniqueness, prefix-free (26)
│   ├── contacts.test.ts      # CRUD with localStorage mock, schema validation (19)
│   ├── sign.test.ts          # XEdDSA sign/verify, Montgomery→Edwards, malformed signatures, degenerate keys (25)
│   ├── broadcast.test.ts     # Broadcast frame serialize/parse, flags, verification states (16)
│   ├── identity.test.ts      # Export/import roundtrip, wrong passphrase, corruption (6)
│   ├── crypto.test.ts        # HKDF domain separation, directionByte edge cases, class isolation
│   ├── detect.test.ts        # Frame classification pipeline: MSG/INTRO/broadcast/contact detection (17)
│   ├── properties.test.ts    # Property-based tests: random-input roundtrips for all core invariants (21)
│   └── types.test-d.ts       # Compile-time type tests (Theme, crypto, stego, compress types)
├── integration/
│   ├── pipeline.test.ts      # Full encrypt→stego→decrypt roundtrip per theme, including large messages, empty plaintext (49)
│   ├── broadcast-pipeline.test.ts  # Full broadcast roundtrip per theme, signed+unsigned, empty plaintext (23)
│   ├── contact-exchange.test.ts  # Contact token through stego roundtrip (9)
│   ├── conversation-protocol.test.ts  # Multi-turn conversation simulations, kex flows, multi-contact (18)
│   ├── invite.test.ts        # Base64url token generate/parse (10)
│   └── stego-benchmark.test.ts  # Transport limit verification, deterministic seeding (10)
└── e2e/
    ├── helpers.ts            # Shared helpers: fillDialogAndConfirm, sendMessage, receiveFromKnown
    ├── basic.spec.ts         # Page load, key persistence, encode, copy, download (6)
    ├── contacts.spec.ts      # Contact add/remove/delete, invite link import, identity export/import (8)
    ├── conversation.spec.ts  # Full multi-round conversation with key exchange confirmation (1)
    ├── crypto-roundtrip.spec.ts  # Alice↔Bob single message exchange (1)
    ├── theme-roundtrip.spec.ts   # Per-theme encode→decode roundtrip, all 8 themes (8)
    ├── large-message.spec.ts  # Large message conversation roundtrip (1)
    ├── broadcast.spec.ts     # Broadcast mode UX (banner, warm background, auto-detect), signed/unsigned, verification, dedup (12)
    ├── tts.spec.ts           # Button behavior, language per theme (5)
    └── visual.spec.ts        # Visual regression screenshots: default, broadcast, self-profile, encoded output (4)
```

## Adding Tests

**New theme:** The stego roundtrip test (`stego.test.ts`) automatically tests all themes in the `THEMES` array. The dictionary test validates table sizes and uniqueness. Just add the theme to `dictionaries.ts` — tests pick it up.

**New compression method:** Add roundtrip tests in `compress.test.ts`. Note that unknown flags now throw (not silent fallback) — test accordingly. The pipeline integration tests already cover the full path. Also add a property-based roundtrip to `properties.test.ts`.

**New UI feature:** Add an E2E test in `tests/e2e/`. Playwright config uses `workers: 1` and `retries: 2` on CI for stability.

## Property-Based Testing

`tests/unit/properties.test.ts` uses `@fast-check/vitest` to verify invariants with random inputs. Each property runs 100 iterations by default. Current properties cover: hex/base64url roundtrips, concat/equality, squash/smaz/compress roundtrips, stego encode↔decode for all themes, wire format serialization, and encrypt/decrypt for both MSG and INTRO.

When adding new encoding or serialization logic, add a corresponding property test. Property tests catch edge cases that hand-picked inputs miss (e.g., the FE0F variation selector bug and the decoder16 truncation bug were in the class of bugs that property testing now covers).

## Wire Format Snapshots

`wire.test.ts` includes inline snapshots for CONTACT check bytes and frame layouts. These catch accidental wire format changes that would break interoperability. If you intentionally change the wire format, update the snapshots with `npx vitest run -u`.

## Type Tests

`tests/unit/types.test-d.ts` uses Vitest's `expectTypeOf` to verify compile-time constraints: Theme fields are `readonly`, `ThemeId` is an exhaustive union, crypto functions return correct types, etc. These run automatically with `npm test` (via `typecheck.enabled: true` in vitest config). They never execute at runtime — Vitest runs `tsc` and checks type assertions.

## Mutation Testing

Stryker (`npm run test:mutate`) mutates source code and reruns tests to find assertions that don't actually verify anything. Config is in `stryker.config.json`, targeting critical modules (crypto, stego, compress, wire, broadcast, utils, sign, smaz, squash). HTML report goes to `reports/mutation/` (gitignored). Run locally as needed — not in CI (too slow, ~10-15 min).

Excluded from mutation: smaz codebook hex strings (data, not logic — 252 entries whose mutations don't break roundtrips) and stego model-64 encoder/decoder (dead code — no current theme uses model 64). These are excluded via line-range patterns in `stryker.config.json`.

Surviving mutants in the initial run revealed several real assertion gaps: HKDF domain separation in crypto, broadcast tag guard conditions, compression mode selection, wire parsing negative cases, and boundary values in squash/utils. These have been addressed with targeted tests (`crypto.test.ts` and additions to existing test files).

## Frame Classification Tests

`detect.test.ts` tests the auto-detection pipeline (`src/detect.ts`) that was extracted from `main.ts`. This module is the core logic that determines what kind of frame decoded bytes represent (MSG, INTRO, broadcast signed/unsigned, contact). Tests cover both regular and broadcast mode classification, including priority ordering, self-encryption, unknown senders, and garbage input. These were previously only testable through E2E.

## Visual Regression

`tests/e2e/visual.spec.ts` captures baseline screenshots of key UI states using Playwright's `toHaveScreenshot()`. Generate initial baselines with `npx playwright test tests/e2e/visual.spec.ts --update-snapshots`. Screenshots are committed to git (under `tests/e2e/visual.spec.ts-snapshots/`) and diffed on future runs. Sensitive to platform rendering — run on consistent environments.

## E2E Wait Strategy

E2E tests use state-based waits (Playwright auto-retry assertions like `expect(locator).not.toBeEmpty()`) instead of `waitForTimeout()`. This makes tests robust on slow CI runners. If you need to wait for an async operation, always wait for a specific DOM state change, not a fixed delay.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs two parallel jobs: unit+integration tests (with coverage) and E2E tests. Playwright browsers are cached by version. Test reports are uploaded as artifacts on failure. See the workflow file for details.

## Large Message Testing

Large payload tests exist at three levels to prevent regressions like the decoder16 safety counter bug (which silently truncated payloads >5000 bytes):

- **Unit (`stego.test.ts`)**: 6000-byte, 10K, 20K payloads through all Model 16 themes; boundary tests at 4999/5000/5001 bytes; truncation and malformed input tests
- **Integration (`pipeline.test.ts`)**: ~5800-char Russian text through all 8 themes × {MSG, INTRO} = 16 combinations
- **Integration (`stego-benchmark.test.ts`)**: Expansion ratio assertions per theme; verifies transport limit thresholds
- **E2E (`large-message.spec.ts`)**: Full Alice↔Bob conversation with ~2300-char messages through key exchange and MSG_STANDARD

When adding themes or changing the encoding pipeline, ensure large payload tests still pass — they catch size-dependent bugs that small-payload roundtrip tests miss.

## Gotchas

- The app uses custom `<dialog>` DOM elements (`dialog.app-dialog`), not native `window.prompt()`. E2E tests must interact with these via DOM selectors (fill inputs by placeholder, click `.dialog-confirm`), not `page.on('dialog')`.
- E2E tests that intercept `speechSynthesis.speak` must set up the interceptor *before* clicking the TTS button, not after. The interceptor replaces the function, so timing matters.
- `contacts.test.ts` mocks `localStorage` via `vi.stubGlobal`. The mock is reset in `beforeEach`.
- Integration tests (pipeline, contact-exchange) use Web Crypto which requires a browser-like environment. Vitest runs in Node which supports Web Crypto natively — no special config needed.
- Property-based tests use `@fast-check/vitest`. The `fc` object re-exported by the library does not include `stringOf` — use `fc.array(...).map(chars => chars.join(''))` instead.
