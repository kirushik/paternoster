import { describe, it, expect } from 'vitest';
import { stegoEncode, stegoDecode } from '../../src/stego';
import { compress } from '../../src/compress';
import { type ThemeId } from '../../src/dictionaries';

const THEMES: ThemeId[] = ['БОЖЕ', 'РОССИЯ', 'СССР', 'БУХАЮ', 'КИТАЙ', 'PATER', '🙂', 'hex'];

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

describe('stego output stays within transport limits', () => {
  // MAX_STEGO_CHARS in main.ts is 50,000. Verify that reasonable inputs stay under it.
  const MAX_STEGO_CHARS = 50_000;

  for (const themeId of THEMES) {
    it(`${themeId}: 1000 bytes produces stego under ${MAX_STEGO_CHARS} chars`, () => {
      const input = randomBytes(1000);
      const encoded = stegoEncode(input, themeId);
      expect(encoded.length).toBeLessThan(MAX_STEGO_CHARS);
    });
  }

  it('worst-case theme (БУХАЮ ~12x) exceeds limit at ~4300 bytes', () => {
    // БУХАЮ has ~11.8x expansion, so 50000/11.8 ≈ 4237 bytes is the threshold
    const input = randomBytes(4300);
    const encoded = stegoEncode(input, 'БУХАЮ');
    expect(encoded.length).toBeGreaterThan(MAX_STEGO_CHARS);
  });

  it('best practical theme (РОССИЯ ~8x) exceeds limit at ~6400 bytes', () => {
    const input = randomBytes(6400);
    const encoded = stegoEncode(input, 'РОССИЯ');
    expect(encoded.length).toBeGreaterThan(MAX_STEGO_CHARS);
  });
});

describe('stego expansion ratio and decode timing', () => {
  const payloadSizes = [100, 500, 1000, 2000, 5000, 10000, 20000, 50000];

  for (const themeId of THEMES) {
    it(`reports expansion and timing for ${themeId}`, () => {
      const results: string[] = [];
      for (const size of payloadSizes) {
        const input = randomBytes(size);
        const encoded = stegoEncode(input, themeId);

        const t0 = performance.now();
        const decoded = stegoDecode(encoded);
        const decodeMs = performance.now() - t0;

        expect(decoded).not.toBeNull();
        expect(decoded!.bytes).toEqual(input);

        results.push(
          `${size} bytes → ${encoded.length} chars stego (${(encoded.length / size).toFixed(1)}x) decode: ${decodeMs.toFixed(1)}ms`,
        );
      }
      console.log(`\n[${themeId}] expansion/timing:`);
      for (const r of results) console.log(`  ${r}`);
    });
  }

  it('reports compression ratio for Russian text of various lengths', () => {
    const base = 'Съешь же ещё этих мягких французских булок, да выпей чаю. ';
    const sizes = [10, 50, 100, 200, 500];
    console.log('\n[Compression] Russian text:');
    for (const repeats of sizes) {
      const text = base.repeat(repeats);
      const { payload, compMode } = compress(text);
      console.log(
        `  ${text.length} chars → ${payload.length} bytes (${(payload.length / text.length * 100).toFixed(0)}%) mode=${compMode}`,
      );
    }
  });

  it('reports full pipeline: Russian text → compress → encrypt overhead → stego output length', () => {
    const base = 'Съешь же ещё этих мягких французских булок, да выпей чаю. ';
    const msgOverhead = 14; // seed:6 + tag:8
    console.log('\n[Full pipeline] text chars → compressed bytes → wire bytes → stego chars per theme:');
    for (const repeats of [10, 50, 100, 200]) {
      const text = base.repeat(repeats);
      const { payload } = compress(text);
      const wireSize = payload.length + msgOverhead;
      const wire = randomBytes(wireSize); // simulate wire frame

      const stegoLengths: string[] = [];
      for (const themeId of THEMES) {
        const encoded = stegoEncode(wire, themeId);
        stegoLengths.push(`${themeId}:${encoded.length}`);
      }
      console.log(`  ${text.length} chars → ${payload.length}B compressed → ${wireSize}B wire → ${stegoLengths.join(', ')}`);
    }
  });
});
