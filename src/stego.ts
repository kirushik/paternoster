/**
 * Steganographic encoding/decoding: converts raw bytes to/from themed text.
 *
 * Ported from module.js encoder0/1/16/64 and decoder0/1/16/64,
 * with bug fixes per bugs.md.
 */

import { u8hex, hexU8 } from './utils';
import { type Theme, type ThemeId, THEMES, THEME_MAP } from './dictionaries';

export interface DecodeResult {
  bytes: Uint8Array;
  theme: ThemeId;
}

/** Normalize text for decoding: handle FE0F variation selector inconsistency. */
function normalizeForDecode(s: string): string {
  // Remove variation selector 16 (U+FE0F) — decoders will match with or without it
  return s.replace(/\uFE0F/g, '');
}

/** Normalize theme tables for consistent matching (strip FE0F from entries). */
function normalizeTab(tab: readonly string[] | undefined): string[] | undefined {
  if (!tab) return undefined;
  return tab.map(s => s.replace(/\uFE0F/g, ''));
}

// ── Model 0: hex ────────────────────────────────────────

function encoder0(b: Uint8Array, _tab: Theme): string {
  return u8hex(b);
}

function decoder0(s: string, _tab: Theme): Uint8Array | null {
  const clean = s.replace(/\s/g, '');
  if (!/^[0-9A-Fa-f]*$/.test(clean)) return null;
  if (clean.length % 2 !== 0) return null;
  return hexU8(clean.toUpperCase());
}

// ── Model 1: character offset (КИТАЙ) ───────────────────

function encoder1(b: Uint8Array, tab: Theme): string {
  const base = tab.base!;
  let o = '';
  for (let i = 0; i < b.length; i++) {
    o += String.fromCharCode(base + b[i]);
    if (Math.random() > tab.rand) o += ' ';
  }
  return tab.pre + o + tab.end;
}

function decoder1(s: string, tab: Theme): Uint8Array | null {
  const base = tab.base!;
  const clean = s.substring(tab.pre.length).replace(/ +/g, '');
  const out: number[] = [];
  for (const ch of clean) {
    const code = ch.codePointAt(0)!;
    if (code < base || code >= base + 256) break;
    out.push(code - base);
  }
  if (out.length === 0) return null;
  return new Uint8Array(out);
}

// ── Model 16: nibble lookup (РОССИЯ, СССР, БУХАЮ) ──────

function encoder16(b: Uint8Array, tab: Theme): string {
  const t1 = tab.tab1!;
  const t2 = tab.tab2 ?? tab.tab1!;
  let iz = false;
  let o = '';
  for (let i = 0; i < b.length; i++) {
    if (Math.random() > tab.rand) iz = !iz;
    o += (iz ? t1 : t2)[b[i] & 0x0F];
    if (Math.random() > tab.rand) iz = !iz;
    o += (iz ? t1 : t2)[(b[i] >> 4) & 0x0F];
  }
  return tab.pre + o + tab.end;
}

function decoder16(s: string, tab: Theme): Uint8Array | null {
  const normalized = normalizeForDecode(s);
  let remainder = normalized.substring(tab.pre.replace(/\uFE0F/g, '').length);
  const normalizedEnd = tab.end.replace(/\uFE0F/g, '');
  const t1 = normalizeTab(tab.tab1)!;
  const t2 = normalizeTab(tab.tab2) ?? t1;
  const nibbles: number[] = [];

  let safety = 10000;
  while (--safety && remainder.length > 0 && remainder !== normalizedEnd) {
    let found = -1;
    for (let i = 0; i < 16; i++) {
      if (remainder.startsWith(t1[i])) {
        found = i;
        remainder = remainder.substring(t1[i].length);
        break;
      }
    }
    if (found < 0) {
      for (let i = 0; i < 16; i++) {
        if (remainder.startsWith(t2[i])) {
          found = i;
          remainder = remainder.substring(t2[i].length);
          break;
        }
      }
    }
    if (found < 0) return null;
    nibbles.push(found);
  }

  if (nibbles.length % 2 !== 0) return null;
  const bytes = new Uint8Array(nibbles.length / 2);
  for (let i = 0, j = 0; i < nibbles.length; i += 2, j++) {
    bytes[j] = (nibbles[i + 1] << 4) | nibbles[i];
  }
  return bytes;
}

// ── Model 64: 2-bit + 6-bit lookup (БОЖЕ) ──────────────

function encoder64(b: Uint8Array, tab: Theme): string {
  const t1 = tab.tab1!;
  const t2 = tab.tab2!;
  const t3 = tab.tab3!;
  let o = '';
  for (let i = 0; i < b.length; i++) {
    o += (Math.random() < tab.rand ? t2 : t1)[b[i] & 0x03];
    o += t3[(b[i] >> 2) & 0x3F];
  }
  return tab.pre + o + tab.end;
}

function decoder64(s: string, tab: Theme): Uint8Array | null {
  const normalized = normalizeForDecode(s);
  let remainder = normalized.substring(tab.pre.replace(/\uFE0F/g, '').length);
  const normalizedEnd = tab.end.replace(/\uFE0F/g, '');
  const t1 = normalizeTab(tab.tab1)!;
  const t2 = normalizeTab(tab.tab2)!;
  const t3 = normalizeTab(tab.tab3)!;
  const pairs: number[] = [];

  let safety = 10000;
  while (--safety && remainder.length > 0 && remainder !== normalizedEnd) {
    // First: 2-bit from tab1 or tab2
    let lo = -1;
    for (let i = 0; i < 4; i++) {
      if (remainder.startsWith(t1[i])) {
        lo = i;
        remainder = remainder.substring(t1[i].length);
        break;
      }
    }
    if (lo < 0) {
      for (let i = 0; i < 4; i++) {
        if (remainder.startsWith(t2[i])) {
          lo = i;
          remainder = remainder.substring(t2[i].length);
          break;
        }
      }
    }
    if (lo < 0) return null;

    // Second: 6-bit from tab3
    let hi = -1;
    for (let i = 0; i < 64; i++) {
      if (remainder.startsWith(t3[i])) {
        hi = i;
        remainder = remainder.substring(t3[i].length);
        break;
      }
    }
    if (hi < 0) return null;

    pairs.push(lo);
    pairs.push(hi);
  }

  if (pairs.length % 2 !== 0) return null;
  const bytes = new Uint8Array(pairs.length / 2);
  for (let i = 0, j = 0; i < pairs.length; i += 2, j++) {
    bytes[j] = pairs[i] + (pairs[i + 1] << 2);
  }
  return bytes;
}

// ── Model 256: one token per byte (emoji, etc.) ─────────

function encoder256(b: Uint8Array, tab: Theme): string {
  const t = tab.tab256!;
  const seps = tab.sep ?? [' '];
  let o = '';
  for (let i = 0; i < b.length; i++) {
    o += t[b[i]];
    o += seps[Math.floor(Math.random() * seps.length)];
  }
  return tab.pre + o + tab.end;
}

function decoder256(s: string, tab: Theme): Uint8Array | null {
  const normalized = normalizeForDecode(s);
  const normalizedPre = tab.pre.replace(/\uFE0F/g, '');
  const normalizedEnd = tab.end.replace(/\uFE0F/g, '');

  let remainder = normalized;
  if (normalizedPre && !remainder.startsWith(normalizedPre)) return null;
  remainder = remainder.substring(normalizedPre.length);

  // Remove suffix if present
  if (normalizedEnd && remainder.endsWith(normalizedEnd)) {
    remainder = remainder.substring(0, remainder.length - normalizedEnd.length);
  }

  // Strip cosmetic separators (spaces)
  remainder = remainder.replace(/ /g, '');

  // Build reverse lookup (normalized)
  const t = tab.tab256!;
  const lookup = new Map<string, number>();
  for (let i = 0; i < t.length; i++) {
    lookup.set(t[i].replace(/\uFE0F/g, ''), i);
  }

  // Greedy match: try longest possible tokens first
  const maxLen = Math.max(...Array.from(lookup.keys()).map(k => k.length));
  const out: number[] = [];
  let i = 0;
  let safety = 10000;
  while (--safety && i < remainder.length) {
    let found = false;
    for (let len = maxLen; len >= 1; len--) {
      const candidate = remainder.substring(i, i + len);
      const idx = lookup.get(candidate);
      if (idx !== undefined) {
        out.push(idx);
        i += len;
        found = true;
        break;
      }
    }
    if (!found) return null;
  }
  if (out.length === 0) return null;
  return new Uint8Array(out);
}

// ── Dispatch ────────────────────────────────────────────

type Encoder = (b: Uint8Array, tab: Theme) => string;
type Decoder = (s: string, tab: Theme) => Uint8Array | null;

const ENCODERS: Record<number, Encoder> = { 0: encoder0, 1: encoder1, 16: encoder16, 64: encoder64, 256: encoder256 };
const DECODERS: Record<number, Decoder> = { 0: decoder0, 1: decoder1, 16: decoder16, 64: decoder64, 256: decoder256 };

/** Encode bytes to themed steganographic text. */
export function stegoEncode(bytes: Uint8Array, themeId: ThemeId): string {
  const theme = THEME_MAP.get(themeId)!;
  return ENCODERS[theme.model](bytes, theme);
}

/** Auto-detect theme and decode steganographic text to bytes. */
export function stegoDecode(text: string): DecodeResult | null {
  for (const theme of THEMES) {
    // Quick rejection heuristics (not prefix-based — just character-range checks)
    if (theme.model === 1) {
      const firstChar = text.codePointAt(0);
      if (firstChar === undefined || firstChar < theme.base! || firstChar >= theme.base! + 256) continue;
    }

    const bytes = DECODERS[theme.model](text, theme);
    if (bytes && bytes.length > 0) {
      return { bytes, theme: theme.id };
    }
  }
  return null;
}
