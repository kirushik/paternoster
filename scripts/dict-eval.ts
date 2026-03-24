/**
 * Dictionary evaluation script.
 * Generates random bytes and encodes them with every theme,
 * printing the full encoded text and stats for each.
 *
 * Usage: npx tsx scripts/dict-eval.ts [byte-count]
 */

import { stegoEncode, stegoDecode } from '../src/stego';
import { type ThemeId, THEMES, THEME_MAP } from '../src/dictionaries';
import { u8hex } from '../src/utils';

const INPUT_BYTES = parseInt(process.argv[2] ?? '100', 10);

function tokenCount(theme: ThemeId, bytes: number): number {
  const model = THEME_MAP.get(theme)!.model;
  switch (model) {
    case 0:
    case 16:
      return bytes * 2;
    case 1024:
      return Math.ceil((4 + bytes * 8) / 10);
    case 4096: {
      const pad = (3 - ((bytes + 1) % 3)) % 3;
      return ((1 + bytes + pad) / 3) * 2;
    }
    default:
      return -1;
  }
}

const bytes = new Uint8Array(INPUT_BYTES);
crypto.getRandomValues(bytes);

console.log(`Random payload: ${INPUT_BYTES} bytes`);
console.log(u8hex(bytes));
console.log();

// Summary table header
const hdr = [
  'Theme'.padEnd(10),
  'Model'.padStart(5),
  'Tokens'.padStart(7),
  'Codepts'.padStart(8),
  'UTF-16'.padStart(7),
  'UTF-8'.padStart(7),
  'Expand'.padStart(7),
].join('  ');
const sep = [10, 5, 7, 8, 7, 7, 7].map(n => '─'.repeat(n)).join('  ');

console.log('=== Summary ===');
console.log(hdr);
console.log(sep);

interface Row {
  theme: ThemeId;
  model: number;
  tokens: number;
  codepoints: number;
  utf16len: number;
  utf8bytes: number;
  expansion: string;
  encoded: string;
}

const rows: Row[] = [];

for (const theme of THEMES) {
  const encoded = stegoEncode(bytes, theme.id);

  const decoded = stegoDecode(encoded);
  if (!decoded) {
    console.error(`ROUNDTRIP FAILED for ${theme.id}: decode returned null`);
    process.exit(1);
  }
  if (u8hex(decoded.bytes) !== u8hex(bytes)) {
    console.error(`ROUNDTRIP FAILED for ${theme.id}: bytes differ`);
    process.exit(1);
  }

  const tokens = tokenCount(theme.id, INPUT_BYTES);
  const codepoints = [...encoded].length;
  const utf16len = encoded.length;
  const utf8bytes = new TextEncoder().encode(encoded).length;
  const expansion = (utf8bytes / INPUT_BYTES).toFixed(2);

  rows.push({
    theme: theme.id,
    model: theme.model,
    tokens,
    codepoints,
    utf16len,
    utf8bytes,
    expansion,
    encoded,
  });

  console.log([
    theme.id.padEnd(10),
    String(theme.model).padStart(5),
    String(tokens).padStart(7),
    String(codepoints).padStart(8),
    String(utf16len).padStart(7),
    String(utf8bytes).padStart(7),
    (expansion + 'x').padStart(7),
  ].join('  '));
}

console.log();

// Full encoded texts
for (const row of rows) {
  console.log(`=== ${row.theme} (model ${row.model}) ===`);
  console.log(row.encoded);
  console.log();
}
