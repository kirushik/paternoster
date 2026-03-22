/**
 * Compression dispatch: tries squash+smaz, squash-only, and literal,
 * picks the smallest.
 *
 * No internal flags byte — compression mode is signaled in the wire header
 * (AAD-authenticated, not encrypted).
 *
 * Modes:
 *   COMP_LITERAL     — raw UTF-8 (no compression)
 *   COMP_SQUASH_SMAZ — CP1251 encoding + smaz dictionary compression
 *   COMP_SQUASH_ONLY — CP1251 encoding only (no smaz). Better than squash+smaz
 *                      when smaz's verbatim escapes expand the output.
 */

import { squashEncode, squashDecode } from './squash';
import { smazCyrillic } from './smaz';
import { COMP_LITERAL, COMP_SQUASH_SMAZ, COMP_SQUASH_ONLY } from './wire';

/** Compression result: raw payload bytes + which compression mode won. */
export interface CompressResult {
  payload: Uint8Array;
  compMode: number;
}

/** Compress a plaintext string. Returns raw payload and the compression mode for the wire header. */
export function compress(text: string): CompressResult {
  const utf8 = new TextEncoder().encode(text);

  // Squash: Cyrillic UTF-8 (2 bytes/char) → CP1251 (1 byte/char)
  const squashed = squashEncode(text);

  // Squash + smaz: dictionary compression on top of squash
  const smazCompressed = smazCyrillic.compress(squashed);

  // Pick the smallest
  let best: Uint8Array = utf8;
  let bestMode = COMP_LITERAL;

  if (squashed.length < best.length) {
    best = squashed;
    bestMode = COMP_SQUASH_ONLY;
  }

  if (smazCompressed.length < best.length) {
    best = smazCompressed;
    bestMode = COMP_SQUASH_SMAZ;
  }

  return { payload: best, compMode: bestMode };
}

/** Decompress. Compression mode comes from the wire header, not the payload. */
export function decompress(data: Uint8Array, compMode: number): string {
  if (data.length === 0) return '';

  if (compMode === COMP_LITERAL) {
    return new TextDecoder().decode(data);
  }

  if (compMode === COMP_SQUASH_ONLY) {
    return squashDecode(data);
  }

  if (compMode === COMP_SQUASH_SMAZ) {
    const decompressed = smazCyrillic.decompress(data);
    return squashDecode(decompressed);
  }

  throw new Error(
    `Неизвестный режим сжатия (0x${compMode.toString(16).padStart(2, '0')}). ` +
    'Возможно, сообщение создано более новой версией.'
  );
}
