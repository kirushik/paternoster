/**
 * Type-level tests: verify compile-time constraints.
 *
 * These tests never execute at runtime. Vitest's typecheck mode runs `tsc`
 * and checks that @ts-expect-error lines produce actual errors (i.e., the
 * type system correctly prevents misuse).
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { Theme, ThemeId } from '../../src/dictionaries';
import { THEMES, THEME_MAP } from '../../src/dictionaries';
import {
  generateKeyPair, encrypt, decrypt, encryptIntro, decryptIntro,
  SEED_LENGTH, CLASS_MSG, CLASS_INTRO,
} from '../../src/crypto';
import { stegoEncode, stegoDecode, type DecodeResult } from '../../src/stego';
import { compress, decompress, type CompressResult } from '../../src/compress';
import { COMP_LITERAL, COMP_SQUASH_SMAZ, COMP_SQUASH_ONLY } from '../../src/wire';

describe('Theme type constraints', () => {
  it('Theme.id is ThemeId', () => {
    expectTypeOf<Theme['id']>().toEqualTypeOf<ThemeId>();
  });

  it('Theme.model is a union of valid model numbers', () => {
    expectTypeOf<Theme['model']>().toEqualTypeOf<0 | 16 | 64 | 1024 | 4096>();
  });

  it('Theme fields are readonly', () => {
    expectTypeOf<Theme['tab1']>().toEqualTypeOf<readonly string[] | undefined>();
    expectTypeOf<Theme['tab2']>().toEqualTypeOf<readonly string[] | undefined>();
    expectTypeOf<Theme['sep']>().toEqualTypeOf<readonly string[] | undefined>();
  });

  it('THEMES is a readonly array of Theme', () => {
    expectTypeOf(THEMES).toMatchTypeOf<readonly Theme[]>();
  });

  it('THEME_MAP maps ThemeId → Theme', () => {
    expectTypeOf(THEME_MAP).toMatchTypeOf<ReadonlyMap<ThemeId, Theme>>();
  });
});

describe('crypto return types', () => {
  it('generateKeyPair returns privateKey and publicKey as Uint8Array', () => {
    expectTypeOf(generateKeyPair).returns.resolves.toMatchTypeOf<{
      privateKey: Uint8Array;
      publicKey: Uint8Array;
    }>();
  });

  it('encrypt returns a Promise<Uint8Array>', () => {
    expectTypeOf(encrypt).returns.resolves.toEqualTypeOf<Uint8Array>();
  });

  it('decrypt returns a Promise<Uint8Array>', () => {
    expectTypeOf(decrypt).returns.resolves.toEqualTypeOf<Uint8Array>();
  });

  it('SEED_LENGTH and CLASS constants are numbers', () => {
    expectTypeOf(SEED_LENGTH).toBeNumber();
    expectTypeOf(CLASS_MSG).toBeNumber();
    expectTypeOf(CLASS_INTRO).toBeNumber();
  });
});

describe('stego types', () => {
  it('stegoEncode accepts ThemeId', () => {
    expectTypeOf(stegoEncode).parameter(1).toEqualTypeOf<ThemeId>();
  });

  it('stegoDecode returns DecodeResult | null', () => {
    expectTypeOf(stegoDecode).returns.toEqualTypeOf<DecodeResult | null>();
  });
});

describe('compress types', () => {
  it('compress returns CompressResult', () => {
    expectTypeOf(compress).returns.toEqualTypeOf<CompressResult>();
  });

  it('compression mode constants are numbers', () => {
    expectTypeOf(COMP_LITERAL).toBeNumber();
    expectTypeOf(COMP_SQUASH_SMAZ).toBeNumber();
    expectTypeOf(COMP_SQUASH_ONLY).toBeNumber();
  });
});
