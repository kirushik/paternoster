/**
 * Steganographic encoding/decoding: converts raw bytes to/from themed text.
 */

import { u8hex, hexU8 } from './utils';
import { type Theme, type ThemeId, THEMES, THEME_MAP } from './dictionaries';

export interface DecodeResult {
  bytes: Uint8Array;
  theme: ThemeId;
}

/** Normalize text for decoding: handle FE0F variation selector inconsistency. */
function normalizeForDecode(s: string): string {
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

// ── Model 64: 2-bit + 6-bit lookup (БОЖЕ, PATER) ───────

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

// ── Model 1024: 10-bit emoji lookup ─────────────────────

function encoder1024(b: Uint8Array, tab: Theme): string {
  const chars = [...tab.chars!];
  const seps = tab.sep ?? [' '];
  // Prepend padding count byte, pad to 5-byte alignment
  const pad = (5 - ((b.length + 1) % 5)) % 5;
  const padded = new Uint8Array(1 + b.length + pad);
  padded[0] = pad;
  padded.set(b, 1);

  let o = '';
  for (let i = 0; i < padded.length; i += 5) {
    const b0 = padded[i], b1 = padded[i + 1], b2 = padded[i + 2], b3 = padded[i + 3], b4 = padded[i + 4];
    o += chars[(b0 << 2) | (b1 >> 6)];
    o += seps[Math.floor(Math.random() * seps.length)];
    o += chars[((b1 & 0x3F) << 4) | (b2 >> 4)];
    o += seps[Math.floor(Math.random() * seps.length)];
    o += chars[((b2 & 0x0F) << 6) | (b3 >> 2)];
    o += seps[Math.floor(Math.random() * seps.length)];
    o += chars[((b3 & 0x03) << 8) | b4];
    o += seps[Math.floor(Math.random() * seps.length)];
  }
  return o;
}

function decoder1024(s: string, tab: Theme): Uint8Array | null {
  const normalized = normalizeForDecode(s);
  const remainder = normalized.replace(/ /g, '');

  // Build reverse lookup
  const chars = [...tab.chars!];
  const lookup = new Map<string, number>();
  for (let i = 0; i < chars.length; i++) {
    lookup.set(chars[i].replace(/\uFE0F/g, ''), i);
  }

  // Match character by character (each emoji is one codepoint)
  const tokens: number[] = [];
  for (const ch of remainder) {
    const idx = lookup.get(ch);
    if (idx === undefined) break;
    tokens.push(idx);
  }

  if (tokens.length === 0 || tokens.length % 4 !== 0) return null;

  // Decode 4 tokens → 5 bytes
  const bytes: number[] = [];
  for (let i = 0; i < tokens.length; i += 4) {
    const t0 = tokens[i], t1 = tokens[i + 1], t2 = tokens[i + 2], t3 = tokens[i + 3];
    bytes.push((t0 >> 2) & 0xFF);
    bytes.push(((t0 & 0x03) << 6) | (t1 >> 4));
    bytes.push(((t1 & 0x0F) << 4) | (t2 >> 6));
    bytes.push(((t2 & 0x3F) << 2) | (t3 >> 8));
    bytes.push(t3 & 0xFF);
  }

  // First byte is padding count
  const pad = bytes[0];
  if (pad > 4) return null;
  return new Uint8Array(bytes.slice(1, bytes.length - pad));
}

// ── Model 4096: 12-bit base offset (КИТАЙ) ──────────────

function encoder4096(b: Uint8Array, tab: Theme): string {
  const base = tab.base!;
  // Prepend padding count byte, pad to 3-byte alignment
  const pad = (3 - ((b.length + 1) % 3)) % 3;
  const padded = new Uint8Array(1 + b.length + pad);
  padded[0] = pad;
  padded.set(b, 1);

  let o = '';
  for (let i = 0; i < padded.length; i += 3) {
    const val24 = (padded[i] << 16) | (padded[i + 1] << 8) | padded[i + 2];
    o += String.fromCodePoint(base + ((val24 >> 12) & 0xFFF));
    o += String.fromCodePoint(base + (val24 & 0xFFF));
    if (Math.random() > tab.rand) o += ' ';
  }
  return o;
}

function decoder4096(s: string, tab: Theme): Uint8Array | null {
  const base = tab.base!;
  const clean = s.replace(/ +/g, '');
  const tokens: number[] = [];
  for (const ch of clean) {
    const code = ch.codePointAt(0)!;
    if (code < base || code >= base + 4096) break;
    tokens.push(code - base);
  }
  if (tokens.length === 0 || tokens.length % 2 !== 0) return null;

  const bytes: number[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const val24 = (tokens[i] << 12) | tokens[i + 1];
    bytes.push((val24 >> 16) & 0xFF);
    bytes.push((val24 >> 8) & 0xFF);
    bytes.push(val24 & 0xFF);
  }

  // First byte is padding count
  const pad = bytes[0];
  if (pad > 2) return null;
  return new Uint8Array(bytes.slice(1, bytes.length - pad));
}

// ── Dispatch ────────────────────────────────────────────

type Encoder = (b: Uint8Array, tab: Theme) => string;
type Decoder = (s: string, tab: Theme) => Uint8Array | null;

const ENCODERS: Record<number, Encoder> = { 0: encoder0, 16: encoder16, 64: encoder64, 1024: encoder1024, 4096: encoder4096 };
const DECODERS: Record<number, Decoder> = { 0: decoder0, 16: decoder16, 64: decoder64, 1024: decoder1024, 4096: decoder4096 };

/** Encode bytes to themed steganographic text. */
export function stegoEncode(bytes: Uint8Array, themeId: ThemeId): string {
  const theme = THEME_MAP.get(themeId)!;
  return ENCODERS[theme.model](bytes, theme);
}

/** Auto-detect theme and decode steganographic text to bytes. */
export function stegoDecode(text: string): DecodeResult | null {
  for (const theme of THEMES) {
    // Quick rejection heuristic for base-offset themes
    if (theme.model === 4096) {
      const firstChar = text.codePointAt(0);
      if (firstChar === undefined || firstChar < theme.base! || firstChar >= theme.base! + 4096) continue;
    }

    const bytes = DECODERS[theme.model](text, theme);
    if (bytes && bytes.length > 0) {
      return { bytes, theme: theme.id };
    }
  }
  return null;
}
