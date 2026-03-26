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
  return o;
}

function decoder16(s: string, tab: Theme): Uint8Array | null {
  const normalized = normalizeForDecode(s);
  // Tokens include trailing separators (spaces) that may be stripped by input trimming
  // or clipboard paste. Padding restores the last separator so the final token matches.
  let remainder = normalized.endsWith(' ') ? normalized : normalized + ' ';
  const t1 = normalizeTab(tab.tab1)!;
  const t2 = normalizeTab(tab.tab2) ?? t1;
  const nibbles: number[] = [];

  // Safety bound: each iteration consumes ≥1 char, so remainder.length is an upper bound.
  let safety = remainder.length + 1;
  while (--safety && remainder.length > 0) {
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
    if (found < 0) {
      if (remainder.trim().length === 0) break;
      return null;
    }
    nibbles.push(found);
  }

  if (nibbles.length % 2 !== 0) return null;
  const bytes = new Uint8Array(nibbles.length / 2);
  for (let i = 0, j = 0; i < nibbles.length; i += 2, j++) {
    bytes[j] = (nibbles[i + 1] << 4) | nibbles[i];
  }
  return bytes;
}

// ── Model 64: 2-bit + 6-bit lookup ──────────────────────
// CURRENTLY UNUSED: No theme in dictionaries.ts uses model: 64.
// Kept commented out for reference — uncomment and re-add to dispatch
// tables (ENCODERS/DECODERS below) if a model-64 theme is added.
//
// function encoder64(b: Uint8Array, tab: Theme): string {
//   const t1 = tab.tab1!;
//   const t2 = tab.tab2!;
//   const t3 = tab.tab3!;
//   let o = '';
//   for (let i = 0; i < b.length; i++) {
//     o += (Math.random() < tab.rand ? t2 : t1)[b[i] & 0x03];
//     o += t3[(b[i] >> 2) & 0x3F];
//   }
//   return o;
// }
//
// function decoder64(s: string, tab: Theme): Uint8Array | null {
//   const normalized = normalizeForDecode(s);
//   let remainder = normalized;
//   const t1 = normalizeTab(tab.tab1)!;
//   const t2 = normalizeTab(tab.tab2)!;
//   const t3 = normalizeTab(tab.tab3)!;
//   const pairs: number[] = [];
//
//   let safety = remainder.length + 1;
//   while (--safety && remainder.length > 0) {
//     let lo = -1;
//     for (let i = 0; i < 4; i++) {
//       if (remainder.startsWith(t1[i])) {
//         lo = i;
//         remainder = remainder.substring(t1[i].length);
//         break;
//       }
//     }
//     if (lo < 0) {
//       for (let i = 0; i < 4; i++) {
//         if (remainder.startsWith(t2[i])) {
//           lo = i;
//           remainder = remainder.substring(t2[i].length);
//           break;
//         }
//       }
//     }
//     if (lo < 0) return null;
//
//     let hi = -1;
//     for (let i = 0; i < 64; i++) {
//       if (remainder.startsWith(t3[i])) {
//         hi = i;
//         remainder = remainder.substring(t3[i].length);
//         break;
//       }
//     }
//     if (hi < 0) return null;
//
//     pairs.push(lo);
//     pairs.push(hi);
//   }
//
//   if (pairs.length % 2 !== 0) return null;
//   const bytes = new Uint8Array(pairs.length / 2);
//   for (let i = 0, j = 0; i < pairs.length; i += 2, j++) {
//     bytes[j] = pairs[i] + (pairs[i + 1] << 2);
//   }
//   return bytes;
// }

// ── Model 1024: 10-bit bit-stream emoji lookup ──────────
// Bit stream layout: [padCount:4][data bits][zero padding]
// padCount (0-9) = number of trailing zero bits in the last token.
// Tokens = ceil((4 + data.length*8) / 10).

function encoder1024(b: Uint8Array, tab: Theme): string {
  const chars = [...tab.chars!];
  const seps = tab.sep ?? [' '];

  const totalNeeded = 4 + b.length * 8;
  const numTokens = Math.ceil(totalNeeded / 10);
  const padCount = numTokens * 10 - totalNeeded;

  let buf = padCount; // 4-bit header
  let bits = 4;
  let o = '';

  for (let i = 0; i < b.length; i++) {
    buf = (buf << 8) | b[i];
    bits += 8;
    while (bits >= 10) {
      bits -= 10;
      o += chars[(buf >> bits) & 0x3FF];
      o += seps[Math.floor(Math.random() * seps.length)];
      buf &= (1 << bits) - 1;
    }
  }

  // Emit final token with remaining bits + zero padding
  if (bits > 0) {
    o += chars[(buf << (10 - bits)) & 0x3FF];
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

  if (tokens.length === 0) return null;

  // First 4 bits = pad count (trailing zero bits in last token)
  const padCount = (tokens[0] >> 6) & 0xF;
  if (padCount > 9) return null;

  const totalBits = tokens.length * 10;
  const dataBits = totalBits - 4 - padCount;
  if (dataBits < 0 || dataBits % 8 !== 0) return null;
  const dataBytes = dataBits / 8;

  // Reassemble bytes from bit stream, skipping 4-bit header
  let buf = tokens[0] & 0x3F;
  let bits = 6;
  let tokenIdx = 1;
  const result = new Uint8Array(dataBytes);

  for (let i = 0; i < dataBytes; i++) {
    while (bits < 8) {
      if (tokenIdx >= tokens.length) return null;
      buf = (buf << 10) | tokens[tokenIdx++];
      bits += 10;
    }
    bits -= 8;
    result[i] = (buf >> bits) & 0xFF;
    buf &= (1 << bits) - 1;
  }

  return result;
}

// ── Model 4096: 12-bit encoding ─────────────────────────
// Flat mode (КИТАЙ): base+offset sequential CJK characters.
// Structured mode (БОЖЕ): 16 connectors (4 bits) × 256 words (8 bits).

function encoder4096(b: Uint8Array, tab: Theme): string {
  // Prepend padding count byte, pad to 3-byte alignment
  const pad = (3 - ((b.length + 1) % 3)) % 3;
  const padded = new Uint8Array(1 + b.length + pad);
  padded[0] = pad;
  padded.set(b, 1);

  let o = '';
  if (tab.base !== undefined) {
    // Flat mode: sequential CJK characters
    const base = tab.base;
    for (let i = 0; i < padded.length; i += 3) {
      const val24 = (padded[i] << 16) | (padded[i + 1] << 8) | padded[i + 2];
      o += String.fromCodePoint(base + ((val24 >> 12) & 0xFFF));
      o += String.fromCodePoint(base + (val24 & 0xFFF));
      if (Math.random() > tab.rand) o += ' ';
    }
  } else {
    // Structured mode: connector + word pairs
    // First pair's connector is always index 0 (padding byte is 0-2,
    // so top 4 bits of first 12-bit value are always 0). We skip it
    // and capitalize the first word for a proper sentence start.
    const connectors = [...tab.tab1!, ...tab.tab2!]; // 16 connectors
    const words = tab.words!.split(' ');
    let first = true;
    for (let i = 0; i < padded.length; i += 3) {
      const val24 = (padded[i] << 16) | (padded[i + 1] << 8) | padded[i + 2];
      const hi = (val24 >> 12) & 0xFFF;
      const lo = val24 & 0xFFF;
      if (first) {
        const w = words[hi & 0xFF];
        o += w[0].toUpperCase() + w.slice(1);
        first = false;
      } else {
        o += connectors[(hi >> 8) & 0xF] + words[hi & 0xFF];
      }
      o += connectors[(lo >> 8) & 0xF] + words[lo & 0xFF];
    }
  }
  return o;
}

function decoder4096(s: string, tab: Theme): Uint8Array | null {
  const tokens12: number[] = [];

  if (tab.base !== undefined) {
    // Flat mode: sequential CJK characters
    const base = tab.base;
    const clean = s.replace(/ +/g, '');
    for (const ch of clean) {
      const code = ch.codePointAt(0)!;
      if (code < base || code >= base + 4096) break;
      tokens12.push(code - base);
    }
  } else {
    // Structured mode: parse connector+word pairs
    const connectors = [...tab.tab1!, ...tab.tab2!];
    const connectorLookup = new Map<string, number>();
    for (let i = 0; i < connectors.length; i++) {
      const frag = connectors[i].trim().replace(/^[.,;:!?—–\-]+|[.,;:!?—–\-]+$/g, '').trim();
      connectorLookup.set(frag, i);
    }
    const words = tab.words!.split(' ');
    const wordLookup = new Map<string, number>();
    for (let i = 0; i < words.length; i++) {
      wordLookup.set(words[i], i);
    }

    const rawTokens = s.split(/\s+/);
    let pendingConnector = -1;
    let firstWord = true;
    for (const raw of rawTokens) {
      const clean = raw.replace(/^[.,;:!?—–\-]+|[.,;:!?—–\-]+$/g, '');
      if (clean.length === 0) continue;
      const ci = connectorLookup.get(clean);
      if (ci !== undefined) { pendingConnector = ci; continue; }
      // Try word lookup (exact match, then lowercase-first for capitalized start)
      let wi = wordLookup.get(clean);
      if (wi === undefined && clean.length > 0) {
        wi = wordLookup.get(clean[0].toLowerCase() + clean.slice(1));
      }
      if (wi !== undefined) {
        if (firstWord) {
          // First word has implicit connector 0
          tokens12.push(wi); // (0 << 8) | wi
          firstWord = false;
        } else {
          if (pendingConnector < 0) return null;
          tokens12.push((pendingConnector << 8) | wi);
          pendingConnector = -1;
        }
        continue;
      }
      break; // unknown token
    }
  }

  if (tokens12.length === 0 || tokens12.length % 2 !== 0) return null;

  const bytes: number[] = [];
  for (let i = 0; i < tokens12.length; i += 2) {
    const val24 = (tokens12[i] << 12) | tokens12[i + 1];
    bytes.push((val24 >> 16) & 0xFF);
    bytes.push((val24 >> 8) & 0xFF);
    bytes.push(val24 & 0xFF);
  }

  const pad = bytes[0];
  if (pad > 2) return null;
  return new Uint8Array(bytes.slice(1, bytes.length - pad));
}

// ── Dispatch ────────────────────────────────────────────

type Encoder = (b: Uint8Array, tab: Theme) => string;
type Decoder = (s: string, tab: Theme) => Uint8Array | null;

const ENCODERS: Record<number, Encoder> = { 0: encoder0, 16: encoder16, /* 64: encoder64, */ 1024: encoder1024, 4096: encoder4096 };
const DECODERS: Record<number, Decoder> = { 0: decoder0, 16: decoder16, /* 64: decoder64, */ 1024: decoder1024, 4096: decoder4096 };

/** Encode bytes to themed steganographic text. */
export function stegoEncode(bytes: Uint8Array, themeId: ThemeId): string {
  const theme = THEME_MAP.get(themeId)!;
  return ENCODERS[theme.model](bytes, theme);
}

/** Auto-detect theme and decode steganographic text to bytes. */
export function stegoDecode(text: string): DecodeResult | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  for (const theme of THEMES) {
    // Quick rejection heuristic for flat base-offset themes (e.g. КИТАЙ)
    if (theme.model === 4096 && theme.base !== undefined) {
      const firstChar = trimmed.codePointAt(0);
      if (firstChar === undefined || firstChar < theme.base || firstChar >= theme.base + 4096) continue;
    }

    const bytes = DECODERS[theme.model](trimmed, theme);
    if (bytes !== null) {
      return { bytes, theme: theme.id };
    }
  }
  return null;
}
