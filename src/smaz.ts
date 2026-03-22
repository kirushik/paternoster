/**
 * Smaz: short message compression using a codebook of common byte sequences.
 *
 * Port of the Python trie-based implementation from compression/results/guide.md §4.
 * Uses a codebook of up to 253 byte sequences. Matched entries are replaced by
 * their 1-byte index. Unmatched bytes use escape codes:
 *   0xFE (254): next 1 byte is a literal
 *   0xFF (255): next byte is length N, then N literal bytes follow
 */

const VERBATIM_1 = 254;
const VERBATIM_N = 255;

interface TrieNode {
  children: Map<number, TrieNode>;
  index?: number; // codebook index if this node terminates a match
}

function buildTrie(codebook: Uint8Array[]): TrieNode {
  const root: TrieNode = { children: new Map() };
  for (let idx = 0; idx < codebook.length; idx++) {
    let node = root;
    for (const b of codebook[idx]) {
      let child = node.children.get(b);
      if (!child) {
        child = { children: new Map() };
        node.children.set(b, child);
      }
      node = child;
    }
    node.index = idx;
  }
  return root;
}

export class Smaz {
  private codebook: Uint8Array[];
  private trie: TrieNode;

  constructor(codebook: Uint8Array[]) {
    if (codebook.length > 253) throw new Error('Codebook too large (max 253 entries)');
    this.codebook = codebook;
    this.trie = buildTrie(codebook);
  }

  compress(data: Uint8Array): Uint8Array {
    const out: number[] = [];
    const pending: number[] = [];

    const flush = () => {
      while (pending.length > 0) {
        if (pending.length === 1) {
          out.push(VERBATIM_1);
          out.push(pending.shift()!);
        } else {
          const chunk = pending.splice(0, Math.min(pending.length, 255));
          out.push(VERBATIM_N);
          out.push(chunk.length);
          out.push(...chunk);
        }
      }
    };

    let i = 0;
    while (i < data.length) {
      let node = this.trie;
      let bestIdx = -1;
      let bestLen = 0;
      let j = i;

      while (j < data.length) {
        const child = node.children.get(data[j]);
        if (!child) break;
        node = child;
        j++;
        if (node.index !== undefined) {
          bestIdx = node.index;
          bestLen = j - i;
        }
      }

      if (bestLen > 0) {
        flush();
        out.push(bestIdx);
        i += bestLen;
      } else {
        pending.push(data[i]);
        i++;
      }
    }
    flush();

    return new Uint8Array(out);
  }

  decompress(data: Uint8Array): Uint8Array {
    const out: number[] = [];
    let i = 0;
    while (i < data.length) {
      const b = data[i];
      if (b === VERBATIM_1) {
        if (i + 1 >= data.length) throw new Error('smaz: truncated VERBATIM_1');
        out.push(data[i + 1]);
        i += 2;
      } else if (b === VERBATIM_N) {
        if (i + 1 >= data.length) throw new Error('smaz: truncated VERBATIM_N length');
        const length = data[i + 1];
        if (i + 2 + length > data.length) throw new Error('smaz: truncated VERBATIM_N data');
        for (let k = 0; k < length; k++) out.push(data[i + 2 + k]);
        i += 2 + length;
      } else {
        if (b >= this.codebook.length) throw new Error(`smaz: invalid codebook index ${b}`);
        const entry = this.codebook[b];
        for (let k = 0; k < entry.length; k++) out.push(entry[k]);
        i += 1;
      }
    }
    return new Uint8Array(out);
  }
}

// Trained codebook from compression/results/smaz_codebook_squash.json (253 entries)
// Each entry is a hex string → Uint8Array
const CODEBOOK_HEX: string[] = ["ee20","e520","2c20","20ef","f2ee","20ed","20efee","e820","20e2","20f1","20ede5","f2ee20","20ede520","edee","e020","f1f2","20ede0","20eff0","ede520","ede5","20e820","ede0","f2fc20","20f7f2ee20","20e8","efee","f0e0","20e220","20f7f2ee","ede8","eaee","f0ee","20ea","e5ed","ff20","20eff0ee","edee20","2c20f7f2ee20","20f2","eee2","2c20f7f2ee","f2e0","20ee","fc20","20ede020","e5f2","f2fc","eff0","2e20","f7f2ee20","ebe8","eae0","f220","eef2","ede020","20e4","eff0ee","e5f0","20fdf2ee","f2e5","f0e5","eef1","e920","e0f2","f7f2ee","ec20","e2e0","20f7f2","e3ee20","ebe820","e220","e3ee","20e7e0","e8f2","eef1f2","e0eb","e2ee","20ec","eef0","20eaee","eeec","2c20f7f2","eeeb","e0ea","e0f2fc","20e1","20f2ee","e0f2fc20","ebfc","20fdf2ee20","20eae0","eee920","20f7","eee3ee20","e5f1","20fdf2","e4e5","e0ed","f320","20eae0ea","20eff0e8","e5f220","f0e8","202d20","20f0e0","eef4","eee3ee","e5eb","ebee","ece5","e5ede8","f2e8","eeed","eee3","e4e0","20f2e0ea","fdf2ee","20f0","ebe5","e7e0","e520ef","ebfced","f1ff20","2c20f7","e0ea20","edfb","20f2e0","e5f1f2","20eae0ea20","fb20","ee20ef","f1f2e0","e2e5","eee1","20e7","f7e5","e5ec","fdf2ee20","e8ed","20e1fb","eff0e8","eeebfceaee20","ecee","ee20ed","20f3","eeec20","eeebfc","e0ec","ee20e2","20e2ee","e6e5","eae0ea","20e2f1","e6e520","ebfcedee","ebe0","ece5ed","f2eef0","ee2c20","e0f1","eae8","ea20","2c20ed","f1ea","20f1f2","f1f2e2","20ecee","20e2f1e5","eee9","f2f1ff20","20eef2","e5e3ee20","f2f1ff","f1ff","e4ee","e8eb","20f120","f1f2ee","eee2e0","ee20f1","e52c20","20f1ee","eae0ea20","2c20ea","e0e2","e0e5f2","20f0e0e7","f520","20e2fb","f2e0ea","e520f1","eeebfceaee","e8f2fc","20eaeef2eef0","20e4ee","f0e0e7","f7f2","f1e5","e5eded","e8f2fc20","2c20e020","e8e520","e820ef","ee20ede5","ebfceaee20","e0e7","e520e2","f2e5eb","fbe920","e8ec","20fd","e520ed","e8f1","e520efee","eef2ee","20ede520ef","f2f0","eaeef2eef0","eef220","ee20ede520","f1eb","e5e3ee","20efeee4","20e4e5","e820ed","e5f0e5","e0ebfced","ece0","efeeeb","e5f2f1ff","f1f2fc20","e2e8","eef0ee","f1ee","e82c20","f1f2fc","20efee20","e02c20","e0f0","e820e2","e0ede8","e2f1e5","ece8","ee20efee","edeee3ee20","2c20ef","20e1fbeb","f120","edfbe920","e1fb","fdf2","e5ec20","f1f2e8"];

const CODEBOOK: Uint8Array[] = CODEBOOK_HEX.map(hex => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
});

/** Singleton smaz compressor with the trained Cyrillic codebook. */
export const smazCyrillic = new Smaz(CODEBOOK);
