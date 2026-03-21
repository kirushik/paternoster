/**
 * Compression dispatch: tries squash+smaz, picks the smaller of
 * compressed vs literal. Prepends a 1-byte flags header.
 *
 * Per compression/results/guide.md §5.
 *
 * Flags byte layout:
 *   0xC0 = Squash + smaz
 *   0x3F = literal (uncompressed UTF-8)
 */

import { squashEncode, squashDecode } from './squash';
import { smazCyrillic } from './smaz';

const FLAG_SQUASH_SMAZ = 0xC0;
const FLAG_LITERAL = 0x3F;

/** Compress a plaintext string. Returns [flags byte][compressed payload]. */
export function compress(text: string): Uint8Array {
  const utf8 = new TextEncoder().encode(text);
  const literalSize = 1 + utf8.length; // 1 byte header + raw UTF-8

  // Try squash + smaz
  const squashed = squashEncode(text);
  const smazCompressed = smazCyrillic.compress(squashed);
  const compressedSize = 1 + smazCompressed.length; // 1 byte header + compressed

  if (compressedSize < literalSize) {
    const result = new Uint8Array(1 + smazCompressed.length);
    result[0] = FLAG_SQUASH_SMAZ;
    result.set(smazCompressed, 1);
    return result;
  }

  // Literal fallback
  const result = new Uint8Array(1 + utf8.length);
  result[0] = FLAG_LITERAL;
  result.set(utf8, 1);
  return result;
}

/** Decompress a compressed blob (with flags header). Returns the original string. */
export function decompress(data: Uint8Array): string {
  if (data.length === 0) return '';
  const flags = data[0];
  const payload = data.slice(1);

  if (flags === FLAG_LITERAL) {
    return new TextDecoder().decode(payload);
  }

  if (flags === FLAG_SQUASH_SMAZ) {
    const decompressed = smazCyrillic.decompress(payload);
    return squashDecode(decompressed);
  }

  // Unknown flags — try literal as fallback
  return new TextDecoder().decode(payload);
}
