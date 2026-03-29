import { describe, it, expect } from 'vitest';
import { cidv0 } from '../../src/ipfs';

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
});
