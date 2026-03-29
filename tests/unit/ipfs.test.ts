import { describe, it, expect } from 'vitest';
import { cidv0 } from '../../src/ipfs';
import { CID } from 'multiformats/cid';
import * as dagPb from '@ipld/dag-pb';
import { UnixFS } from 'ipfs-unixfs';
import { sha256 } from 'multiformats/hashes/sha2';

/** Reference CIDv0 using official IPFS libraries. */
async function referenceCidv0(data: Uint8Array): Promise<string> {
  const unixfs = new UnixFS({ type: 'file', data });
  const node = dagPb.encode({ Data: unixfs.marshal(), Links: [] });
  const hash = await sha256.digest(node);
  return CID.createV0(hash).toString();
}

describe('cidv0', () => {
  it('empty file', async () => {
    expect(await cidv0(new Uint8Array(0)))
      .toBe('QmbFMke1KXqnYyBBWxB74N4c5SBnJMVAiMNRcGu6x1AwQH');
  });

  it('hello\\n', async () => {
    const hello = new TextEncoder().encode('hello\n');
    expect(await cidv0(hello))
      .toBe('QmZULkCELmmk5XNfCgTnCyFgAVxBRBXyDHGGMVoLFLiXEN');
  });

  it('Hello World\\n', async () => {
    const hw = new TextEncoder().encode('Hello World\n');
    expect(await cidv0(hw))
      .toBe('QmWATWQ7fVPP2EFGu71UkfnqhYXDYH566qy47CnJDgvs8u');
  });

  it('result is always 46 characters starting with Qm', async () => {
    const cid = await cidv0(new Uint8Array([0x42]));
    expect(cid).toHaveLength(46);
    expect(cid.startsWith('Qm')).toBe(true);
  });

  it('different content produces different CID', async () => {
    const a = await cidv0(new Uint8Array([0x00]));
    const b = await cidv0(new Uint8Array([0x01]));
    expect(a).not.toBe(b);
  });

  it('rejects files at or above IPFS chunk limit', async () => {
    const big = new Uint8Array(262144);
    await expect(cidv0(big)).rejects.toThrow('File too large');
  });

  describe('matches reference IPFS libraries', () => {
    const cases: [string, Uint8Array][] = [
      ['empty', new Uint8Array(0)],
      ['single byte', new Uint8Array([0xFF])],
      ['hello\\n', new TextEncoder().encode('hello\n')],
      ['128 bytes (varint boundary)', crypto.getRandomValues(new Uint8Array(128))],
      ['1KB', crypto.getRandomValues(new Uint8Array(1024))],
      ['100KB', new Uint8Array(100_000).map((_, i) => i & 0xFF)],
    ];

    for (const [label, data] of cases) {
      it(label, async () => {
        expect(await cidv0(data)).toBe(await referenceCidv0(data));
      });
    }
  });
});
