/** Convert Uint8Array to uppercase hex string */
export function u8hex(u8: Uint8Array): string {
  let o = '';
  for (let i = 0; i < u8.length; i++) {
    o += u8[i].toString(16).padStart(2, '0').toUpperCase();
  }
  return o;
}

/** Convert hex string to Uint8Array. Throws on invalid input. */
export function hexU8(hex: string): Uint8Array {
  const clean = hex.replace(/\s/g, '');
  if (clean.length === 0) return new Uint8Array(0);
  if (clean.length % 2 !== 0 || !/^[0-9A-Fa-f]+$/.test(clean)) {
    throw new Error('Invalid hex string');
  }
  const matches = clean.match(/.{2}/g)!;
  return new Uint8Array(matches.map(b => parseInt(b, 16)));
}

/** Encode Uint8Array to base64url string (no padding) */
export function u8toBase64url(u8: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode base64url string to Uint8Array */
export function base64urlToU8(s: string): Uint8Array {
  const base64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i);
  return u8;
}

/** Concatenate multiple Uint8Arrays */
export function concatU8(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

/** SHA-256 of data, return first n bytes. */
export async function sha256Bytes(data: Uint8Array, n: number): Promise<Uint8Array> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
  return hash.slice(0, n);
}

/** SHA-256 of (data || domain), return first n bytes. */
export async function sha256WithDomain(data: Uint8Array, domain: Uint8Array, n: number): Promise<Uint8Array> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', concatU8(data, domain) as BufferSource));
  return hash.slice(0, n);
}

/** Compute a short verification code from a public key (SHA-256, first 8 bytes as grouped hex). */
export async function contactCode(publicKey: Uint8Array): Promise<string> {
  const first8 = await sha256Bytes(publicKey, 8);
  return u8hex(first8).match(/.{4}/g)!.join(' ');
}

/** Generate a random hex string of the specified byte length. */
export function randomHexId(byteLength: number): string {
  return u8hex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** Compare two Uint8Arrays for equality */
export function u8eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
