/**
 * Squash encoding: hybrid CP1251/UTF-8 single-byte encoding.
 *
 * Maps CP1251-representable characters to their single-byte CP1251 values.
 * Everything else is escaped as 0x98 + inline UTF-8 bytes.
 *
 * Per compression/results/guide.md §2.
 */

const ESCAPE = 0x98;

// CP1251 decode table: byte -> Unicode codepoint (for 0x80-0xFF range, excluding 0x98)
const CP1251_TO_CHAR: Map<number, string> = new Map();
const CHAR_TO_CP1251: Map<string, number> = new Map();

// CP1251 upper half mapping (0x80-0xFF)
const CP1251_MAP: Record<number, number> = {
  0x80: 0x0402, 0x81: 0x0403, 0x82: 0x201A, 0x83: 0x0453, 0x84: 0x201E,
  0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x20AC, 0x89: 0x2030,
  0x8A: 0x0409, 0x8B: 0x2039, 0x8C: 0x040A, 0x8D: 0x040C, 0x8E: 0x040B,
  0x8F: 0x040F, 0x90: 0x0452, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C,
  0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  // 0x98 is our escape byte — skip it
  0x99: 0x2122, 0x9A: 0x0459, 0x9B: 0x203A, 0x9C: 0x045A, 0x9D: 0x045C,
  0x9E: 0x045B, 0x9F: 0x045F, 0xA0: 0x00A0, 0xA1: 0x040E, 0xA2: 0x045E,
  0xA3: 0x0408, 0xA4: 0x00A4, 0xA5: 0x0490, 0xA6: 0x00A6, 0xA7: 0x00A7,
  0xA8: 0x0401, 0xA9: 0x00A9, 0xAA: 0x0404, 0xAB: 0x00AB, 0xAC: 0x00AC,
  0xAD: 0x00AD, 0xAE: 0x00AE, 0xAF: 0x0407, 0xB0: 0x00B0, 0xB1: 0x00B1,
  0xB2: 0x0406, 0xB3: 0x0456, 0xB4: 0x0491, 0xB5: 0x00B5, 0xB6: 0x00B6,
  0xB7: 0x00B7, 0xB8: 0x0451, 0xB9: 0x2116, 0xBA: 0x0454, 0xBB: 0x00BB,
  0xBC: 0x0458, 0xBD: 0x0405, 0xBE: 0x0455, 0xBF: 0x0457,
};
// 0xC0-0xFF: А-я (U+0410-U+044F)
for (let b = 0xC0; b <= 0xFF; b++) {
  CP1251_MAP[b] = 0x0410 + (b - 0xC0);
}

// Build both lookup tables
for (const [byte, codepoint] of Object.entries(CP1251_MAP)) {
  const b = Number(byte);
  const ch = String.fromCodePoint(codepoint);
  CP1251_TO_CHAR.set(b, ch);
  CHAR_TO_CP1251.set(ch, b);
}

/** Encode Unicode text to squash format. */
export function squashEncode(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) {
      out.push(cp);
    } else if (CHAR_TO_CP1251.has(ch)) {
      out.push(CHAR_TO_CP1251.get(ch)!);
    } else {
      out.push(ESCAPE);
      const utf8 = new TextEncoder().encode(ch);
      for (let i = 0; i < utf8.length; i++) out.push(utf8[i]);
    }
  }
  return new Uint8Array(out);
}

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });

/** Decode squash-encoded bytes back to Unicode string. */
export function squashDecode(data: Uint8Array): string {
  const chars: string[] = [];
  let i = 0;
  while (i < data.length) {
    const b = data[i];
    if (b < 0x80) {
      chars.push(String.fromCharCode(b));
      i++;
    } else if (b === ESCAPE) {
      // Read inline UTF-8 sequence
      i++;
      if (i >= data.length) throw new Error('Squash: неожиданный конец данных после escape-байта');
      const lead = data[i];
      if (lead < 0xC2 || lead > 0xF4) throw new Error('Squash: некорректный UTF-8 после escape-байта');
      let seqLen: number;
      if (lead < 0xE0) seqLen = 2;
      else if (lead < 0xF0) seqLen = 3;
      else seqLen = 4;
      if (i + seqLen > data.length) throw new Error('Squash: неполная UTF-8 последовательность');
      const utf8Bytes = data.slice(i, i + seqLen);
      chars.push(STRICT_UTF8.decode(utf8Bytes));
      i += seqLen;
    } else {
      const ch = CP1251_TO_CHAR.get(b);
      if (ch) {
        chars.push(ch);
      } else {
        chars.push('?'); // Unknown byte
      }
      i++;
    }
  }
  return chars.join('');
}
