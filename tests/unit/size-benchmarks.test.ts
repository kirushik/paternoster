import { describe, it, expect } from 'vitest';
import { compress } from '../../src/compress';
import { stegoEncode, stegoDecode } from '../../src/stego';
import { type ThemeId, THEME_MAP } from '../../src/dictionaries';
import { generateKeyPair, encrypt, encryptIntro, CLASS_MSG } from '../../src/crypto';
import { serializeMsg, serializeIntro } from '../../src/wire';
import { concatU8 } from '../../src/utils';
import { squashEncode } from '../../src/squash';
import { smazCyrillic } from '../../src/smaz';

const ALL_THEMES: ThemeId[] = ['КИТАЙ', 'PATER', 'БОЖЕ', 'БУХАЮ', 'РОССИЯ', 'СССР', '🙂', 'hex'];

function tokenCount(theme: ThemeId, bytes: number): number {
  const model = THEME_MAP.get(theme)!.model;
  switch (model) {
    case 0:
    case 16:
      return bytes * 2;
    case 1024: {
      const pad = (5 - ((bytes + 1) % 5)) % 5;
      return ((1 + bytes + pad) / 5) * 4;
    }
    case 4096: {
      const pad = (3 - ((bytes + 1) % 3)) % 3;
      return ((1 + bytes + pad) / 3) * 2;
    }
    default:
      return -1;
  }
}

interface SizeRow {
  theme: ThemeId;
  tokens: number;
  codepoints: number;
  utf16len: number;
}

async function buildFrames(text: string): Promise<{ msgFrame: Uint8Array; introFrame: Uint8Array; compressionInfo: string }> {
  const alice = await generateKeyPair();
  const bob = await generateKeyPair();
  const eph = await generateKeyPair();

  const { payload: compressed, compMode } = compress(text);

  const utf8Len = new TextEncoder().encode(text).length;
  const squashLen = squashEncode(text).length;
  const smazLen = smazCyrillic.compress(squashEncode(text)).length;
  const modeNames = ['literal', 'squash+smaz', 'squash-only'];
  const compressionInfo = `UTF-8: ${utf8Len}, squash: ${squashLen}, squash+smaz: ${smazLen} → ${modeNames[compMode]} (${compressed.length}B)`;

  const msgEncrypted = await encrypt(compressed, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG, compMode);
  const msgFrame = serializeMsg(msgEncrypted);

  const introPayload = concatU8(new Uint8Array([compMode]), alice.publicKey, compressed);
  const introEncrypted = await encryptIntro(introPayload, eph.privateKey, bob.publicKey, eph.publicKey, bob.publicKey);
  const introFrame = serializeIntro(eph.publicKey, introEncrypted);

  return { msgFrame, introFrame, compressionInfo };
}

function benchmarkFrame(frame: Uint8Array): SizeRow[] {
  const rows: SizeRow[] = [];
  for (const theme of ALL_THEMES) {
    const encoded = stegoEncode(frame, theme);

    const decoded = stegoDecode(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.bytes).toEqual(frame);

    rows.push({
      theme,
      tokens: tokenCount(theme, frame.length),
      codepoints: [...encoded].length,
      utf16len: encoded.length,
    });
  }
  return rows;
}

function printFrameTable(frameType: string, wireBytes: number, rows: SizeRow[]): void {
  const h = `  ${'Theme'.padEnd(10)} ${'wire'.padStart(6)} ${'tokens'.padStart(8)} ${'codepts'.padStart(9)} ${'.length'.padStart(9)}`;
  console.log(`  --- ${frameType} (${wireBytes}B) ---`);
  console.log(h);
  console.log(`  ${'─'.repeat(10)} ${'─'.repeat(6)} ${'─'.repeat(8)} ${'─'.repeat(9)} ${'─'.repeat(9)}`);
  for (const r of rows) {
    console.log(`  ${r.theme.padEnd(10)} ${(wireBytes + 'B').padStart(6)} ${String(r.tokens).padStart(8)} ${String(r.codepoints).padStart(9)} ${String(r.utf16len).padStart(9)}`);
  }
}

const PAYLOADS: [string, string][] = [
  ['minimal reply', 'Да'],
  ['short greeting', 'Привет!'],
  ['medium (pangram)', 'Съешь же ещё этих мягких французских булок, да выпей чаю.'],
  ['long message', 'Здравствуйте, коллеги. Напоминаю, что завтра в десять утра состоится совещание по проекту. Просьба подготовить отчёты за текущий квартал и быть готовыми к обсуждению дальнейших шагов.'],
];

describe('size benchmarks', () => {
  for (const [label, text] of PAYLOADS) {
    it(`${label}: "${text.slice(0, 30)}${text.length > 30 ? '…' : ''}"`, async () => {
      const { msgFrame, introFrame, compressionInfo } = await buildFrames(text);
      const msgRows = benchmarkFrame(msgFrame);
      const introRows = benchmarkFrame(introFrame);

      console.log(`\n=== ${label} ===`);
      console.log(`  Compression: ${compressionInfo}`);
      printFrameTable('MSG', msgFrame.length, msgRows);
      printFrameTable('INTRO', introFrame.length, introRows);

      // Compact theme ordering on codepoints: КИТАЙ < emoji ≤ hex
      for (const rows of [msgRows, introRows]) {
        const kitay = rows.find(r => r.theme === 'КИТАЙ')!;
        const emoji = rows.find(r => r.theme === '🙂')!;
        const hex = rows.find(r => r.theme === 'hex')!;

        expect(kitay.codepoints).toBeLessThan(emoji.codepoints);
        expect(emoji.codepoints).toBeLessThanOrEqual(hex.codepoints);
      }

      // All model-4096 themes have identical token counts
      for (const rows of [msgRows, introRows]) {
        const m4096 = rows.filter(r => ['КИТАЙ', 'PATER', 'БОЖЕ'].includes(r.theme));
        expect(m4096[0].tokens).toBe(m4096[1].tokens);
        expect(m4096[1].tokens).toBe(m4096[2].tokens);
      }
    });
  }
});
