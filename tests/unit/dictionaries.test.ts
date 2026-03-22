import { describe, it, expect } from 'vitest';
import { THEMES, THEME_MAP, type Theme } from '../../src/dictionaries';

function stripFE0F(s: string): string {
  return s.replace(/\uFE0F/g, '');
}

describe('theme table sizes', () => {
  it('БОЖЕ has correct table sizes (model 64)', () => {
    const t = THEME_MAP.get('БОЖЕ')!;
    expect(t.tab1).toHaveLength(4);
    expect(t.tab2).toHaveLength(4);
    expect(t.tab3).toHaveLength(64);
  });

  it('PATER has correct table sizes (model 64)', () => {
    const t = THEME_MAP.get('PATER')!;
    expect(t.tab1).toHaveLength(4);
    expect(t.tab2).toHaveLength(4);
    expect(t.tab3).toHaveLength(64);
  });

  it('РОССИЯ has correct table sizes (model 16)', () => {
    const t = THEME_MAP.get('РОССИЯ')!;
    expect(t.tab1).toHaveLength(16);
    expect(t.tab2).toHaveLength(16);
  });

  it('СССР has correct table sizes (model 16)', () => {
    const t = THEME_MAP.get('СССР')!;
    expect(t.tab1).toHaveLength(16);
    expect(t.tab2).toHaveLength(16);
  });

  it('БУХАЮ has correct table sizes (model 16)', () => {
    const t = THEME_MAP.get('БУХАЮ')!;
    expect(t.tab1).toHaveLength(16);
    expect(t.tab2).toHaveLength(16);
  });

  it('🙂 has 256 emoji entries (model 256)', () => {
    const t = THEME_MAP.get('🙂')!;
    expect(t.tab256).toHaveLength(256);
  });

  it('КИТАЙ has base set (model 1)', () => {
    const t = THEME_MAP.get('КИТАЙ')!;
    expect(t.base).toBe(0x4E00);
  });
});

describe('token uniqueness', () => {
  function checkUniqueness(tokens: readonly string[], name: string) {
    const normalized = tokens.map(stripFE0F);
    const unique = new Set(normalized);
    if (unique.size !== normalized.length) {
      const dupes = normalized.filter((v, i) => normalized.indexOf(v) !== i);
      throw new Error(`${name}: duplicate tokens after FE0F normalization: ${dupes.join(', ')}`);
    }
  }

  for (const theme of THEMES) {
    if (theme.tab1) {
      it(`${theme.id} tab1 tokens are unique`, () => {
        checkUniqueness(theme.tab1!, `${theme.id}.tab1`);
      });
    }
    if (theme.tab2) {
      it(`${theme.id} tab2 tokens are unique`, () => {
        checkUniqueness(theme.tab2!, `${theme.id}.tab2`);
      });
    }
    if (theme.tab3) {
      it(`${theme.id} tab3 tokens are unique`, () => {
        checkUniqueness(theme.tab3!, `${theme.id}.tab3`);
      });
    }
    if (theme.tab256) {
      it(`${theme.id} tab256 tokens are unique`, () => {
        checkUniqueness(theme.tab256!, `${theme.id}.tab256`);
      });
    }
  }
});

describe('prefix-free property', () => {
  function checkPrefixFree(tokens: readonly string[], name: string) {
    const normalized = tokens.map(stripFE0F);
    for (let i = 0; i < normalized.length; i++) {
      for (let j = 0; j < normalized.length; j++) {
        if (i === j) continue;
        if (normalized[j].startsWith(normalized[i]) && normalized[i] !== normalized[j]) {
          throw new Error(
            `${name}: "${tokens[i]}" (idx ${i}) is a prefix of "${tokens[j]}" (idx ${j})`
          );
        }
      }
    }
  }

  for (const theme of THEMES) {
    // For model-16: tab1 and tab2 are used in the same decoder loop,
    // so combined set must be prefix-free
    if (theme.model === 16 && theme.tab1) {
      it(`${theme.id} tab1+tab2 combined is prefix-free`, () => {
        const combined = [...(theme.tab1 ?? []), ...(theme.tab2 ?? theme.tab1 ?? [])];
        // Deduplicate first (same token in both tables is OK)
        const unique = [...new Set(combined.map(stripFE0F))];
        // Prefix-free within the unique set
        for (let i = 0; i < unique.length; i++) {
          for (let j = 0; j < unique.length; j++) {
            if (i === j) continue;
            expect(unique[j].startsWith(unique[i]) && unique[i] !== unique[j]).toBe(false);
          }
        }
      });
    }

    // For model-64: tab1, tab2 must be prefix-free among themselves,
    // and tab3 must be prefix-free
    if (theme.model === 64 && theme.tab3) {
      it(`${theme.id} tab3 is prefix-free`, () => {
        checkPrefixFree(theme.tab3!, `${theme.id}.tab3`);
      });
    }

    // For model-256: tab256 must be prefix-free
    if (theme.model === 256 && theme.tab256) {
      it(`${theme.id} tab256 is prefix-free`, () => {
        checkPrefixFree(theme.tab256!, `${theme.id}.tab256`);
      });
    }
  }
});

describe('theme ordering', () => {
  it('hex is last in THEMES array', () => {
    expect(THEMES[THEMES.length - 1].id).toBe('hex');
  });

  it('all theme IDs are unique', () => {
    const ids = THEMES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('THEME_MAP has all themes', () => {
    for (const theme of THEMES) {
      expect(THEME_MAP.get(theme.id)).toBe(theme);
    }
  });
});

