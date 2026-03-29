import { concatU8 } from './utils';

/** Protobuf unsigned varint (LEB128). */
function varint(n: number): Uint8Array {
  const bytes: number[] = [];
  while (n > 0x7F) { bytes.push((n & 0x7F) | 0x80); n >>>= 7; }
  bytes.push(n);
  return new Uint8Array(bytes);
}

/** Wrap raw file bytes in UnixFS File protobuf. */
function unixfsFile(data: Uint8Array): Uint8Array {
  const type = new Uint8Array([0x08, 0x02]);                         // field 1: Type = File
  const body = data.length > 0                                        // field 2: Data (omit if empty)
    ? concatU8(new Uint8Array([0x12]), varint(data.length), data)
    : new Uint8Array(0);
  const size = concatU8(new Uint8Array([0x18]), varint(data.length)); // field 3: filesize
  return concatU8(type, body, size);
}

/** Wrap UnixFS bytes in DAG-PB PBNode protobuf (no Links). */
function dagPbNode(unixfs: Uint8Array): Uint8Array {
  return concatU8(new Uint8Array([0x0A]), varint(unixfs.length), unixfs);
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58btc (Bitcoin alphabet). */
function base58btc(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  const chars: string[] = [];
  while (num > 0n) { chars.push(B58[Number(num % 58n)]); num /= 58n; }
  return '1'.repeat(zeros) + chars.reverse().join('');
}

/** CIDv0 matching `ipfs add` for single-chunk files (<256KB). Returns 46-char "Qm..." string. */
export async function cidv0(file: Uint8Array): Promise<string> {
  const node = dagPbNode(unixfsFile(file));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', node as BufferSource));
  return base58btc(concatU8(new Uint8Array([0x12, 0x20]), digest));
}
