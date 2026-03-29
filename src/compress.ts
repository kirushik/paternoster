/**
 * Compression dispatch: tries squash+smaz, squash-only, and literal,
 * picks the smallest.
 *
 * No internal flags byte — compression mode is stamped into the seed's
 * top 2 bits (authenticated by AEAD via HKDF salt inclusion).
 */

import { squashEncode, squashDecode } from './squash';
import { smazCyrillic } from './smaz';
import { COMP_LITERAL, COMP_SQUASH_SMAZ, COMP_SQUASH_ONLY } from './wire';

/** Compression result: raw payload bytes + which compression mode won. */
export interface CompressResult {
  payload: Uint8Array;
  compMode: number; // 2-bit value: COMP_LITERAL, COMP_SQUASH_SMAZ, or COMP_SQUASH_ONLY
}

/** Compress a plaintext string. Returns raw payload and the 2-bit compression mode. */
export function compress(text: string): CompressResult {
  const utf8 = new TextEncoder().encode(text);

  const squashed = squashEncode(text);
  const smazCompressed = smazCyrillic.compress(squashed);

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

/** Decompress. Compression mode comes from the seed's top 2 bits. */
export function decompress(data: Uint8Array, compMode: number): string {
  if (data.length === 0) return '';

  if (compMode === COMP_LITERAL) {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  }

  if (compMode === COMP_SQUASH_ONLY) {
    return squashDecode(data);
  }

  if (compMode === COMP_SQUASH_SMAZ) {
    const decompressed = smazCyrillic.decompress(data);
    return squashDecode(decompressed);
  }

  throw new Error(
    `Неизвестный режим сжатия (${compMode}). ` +
    'Возможно, сообщение создано более новой версией.'
  );
}
