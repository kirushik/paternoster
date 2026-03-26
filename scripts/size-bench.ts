/**
 * Size benchmark: shows wire + stego overhead for all frame types and themes.
 *
 * Usage: npm run bench
 */

import { compress } from '../src/compress';
import { stegoEncode } from '../src/stego';
import { type ThemeId, THEME_MAP } from '../src/dictionaries';
import { generateKeyPair, encrypt, encryptIntro, CLASS_MSG } from '../src/crypto';
import { serializeMsg, serializeIntro } from '../src/wire';
import { concatU8 } from '../src/utils';
import { squashEncode } from '../src/squash';
import { smazCyrillic } from '../src/smaz';
import { serializeBroadcastUnsigned, serializeBroadcastSigned } from '../src/broadcast';

const ALL_THEMES: ThemeId[] = ['КИТАЙ', 'PATER', 'БОЖЕ', 'БУХАЮ', 'РОССИЯ', 'СССР', '🙂', 'hex'];

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

interface SizeRow {
  theme: ThemeId;
  tokens: number;
  codepoints: number;
  utf16len: number;
}

function benchmarkFrame(frame: Uint8Array): SizeRow[] {
  return ALL_THEMES.map(theme => {
    const encoded = stegoEncode(frame, theme);
    return {
      theme,
      tokens: tokenCount(theme, frame.length),
      codepoints: [...encoded].length,
      utf16len: encoded.length,
    };
  });
}

function printTable(label: string, wireBytes: number, rows: SizeRow[]): void {
  const h = `  ${'Theme'.padEnd(10)} ${'wire'.padStart(6)} ${'tokens'.padStart(8)} ${'codepts'.padStart(9)} ${'.length'.padStart(9)}`;
  console.log(`  --- ${label} (${wireBytes}B) ---`);
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

async function main() {
  const alice = await generateKeyPair();
  const bob = await generateKeyPair();
  const eph = await generateKeyPair();

  for (const [label, text] of PAYLOADS) {
    const { payload: compressed, compMode } = compress(text);

    const utf8Len = new TextEncoder().encode(text).length;
    const squashLen = squashEncode(text).length;
    const smazLen = smazCyrillic.compress(squashEncode(text)).length;
    const modeNames = ['literal', 'squash+smaz', 'squash-only'];

    console.log(`\n=== ${label} ===`);
    console.log(`  Compression: UTF-8: ${utf8Len}, squash: ${squashLen}, squash+smaz: ${smazLen} → ${modeNames[compMode]} (${compressed.length}B)`);

    // MSG
    const msgEncrypted = await encrypt(compressed, alice.privateKey, bob.publicKey, alice.publicKey, bob.publicKey, CLASS_MSG, compMode);
    const msgFrame = serializeMsg(msgEncrypted);
    printTable('MSG', msgFrame.length, benchmarkFrame(msgFrame));

    // INTRO
    const introPayload = concatU8(new Uint8Array([compMode]), alice.publicKey, compressed);
    const introEncrypted = await encryptIntro(introPayload, eph.privateKey, bob.publicKey, eph.publicKey, bob.publicKey);
    const introFrame = serializeIntro(eph.publicKey, introEncrypted);
    printTable('INTRO', introFrame.length, benchmarkFrame(introFrame));

    // BROADCAST_UNSIGNED
    const unsignedFrame = serializeBroadcastUnsigned(compressed, compMode);
    printTable('BROADCAST (unsigned)', unsignedFrame.length, benchmarkFrame(unsignedFrame));

    // BROADCAST_SIGNED (XEdDSA)
    const signedFrame = await serializeBroadcastSigned(compressed, compMode, alice.publicKey, alice.privateKey);
    printTable('BROADCAST (signed)', signedFrame.length, benchmarkFrame(signedFrame));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
