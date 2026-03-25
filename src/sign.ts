/**
 * XEdDSA: Sign with X25519 keys, verify with Web Crypto Ed25519.
 *
 * Custom signing construction inspired by Signal's XEdDSA specification
 * (Trevor Perrin, 2016). Montgomery (X25519) and twisted Edwards (Ed25519)
 * curves are birationally equivalent — the same clamped scalar works for
 * both ECDH and signing.
 *
 * Signing uses inline BigInt Ed25519 arithmetic (no external library).
 * Verification converts the X25519 public key to Edwards form, then
 * delegates to Web Crypto Ed25519.verify(). The verification side is
 * entirely browser-native; only the signing path is custom code.
 *
 * NOT constant-time (BigInt). In this threat model, an attacker with
 * same-origin JS execution already has localStorage access (and thus
 * the private key), making timing attacks redundant. The main risk of
 * this module is correctness of the custom arithmetic — see docs/crypto.md.
 */

import { concatU8 } from './utils';

// ── Field constants ──────────────────────────────────────

const P = 2n ** 255n - 19n;
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;
const SQRT_M1 = 19681161376707505956807079304988542015446066515923890162744021073123829784752n;
const FE_PAD = new Uint8Array(32).fill(0xFE); // XEdDSA domain separator

// ── Field arithmetic ─────────────────────────────────────

function mod(a: bigint, m: bigint = P): bigint {
  return ((a % m) + m) % m;
}

function modPow(base: bigint, exp: bigint, m: bigint = P): bigint {
  let result = 1n, b = mod(base, m);
  for (let e = exp; e > 0n; e >>= 1n) {
    if (e & 1n) result = mod(result * b, m);
    b = mod(b * b, m);
  }
  return result;
}

function modInv(a: bigint): bigint { return modPow(a, P - 2n); }

// ── Extended coordinates (X, Y, Z, T) ───────────────────

interface ExtPoint { X: bigint; Y: bigint; Z: bigint; T: bigint; }

function extAdd(p1: ExtPoint, p2: ExtPoint): ExtPoint {
  const A = mod(p1.X * p2.X);
  const B = mod(p1.Y * p2.Y);
  const C = mod(p1.T * D * p2.T);
  const DD = mod(p1.Z * p2.Z);
  const E = mod((p1.X + p1.Y) * (p2.X + p2.Y) - A - B);
  const F = mod(DD - C);
  const G = mod(DD + C);
  const H = mod(B + A); // B - a*A where a=-1
  return { X: mod(E * F), Y: mod(G * H), Z: mod(F * G), T: mod(E * H) };
}

function extScalarMult(k: bigint, p: ExtPoint): ExtPoint {
  let result: ExtPoint = { X: 0n, Y: 1n, Z: 1n, T: 0n }; // identity
  let cur = p;
  for (let s = k; s > 0n; s >>= 1n) {
    if (s & 1n) result = extAdd(result, cur);
    cur = extAdd(cur, cur);
  }
  return result;
}

function extToAffine(p: ExtPoint): { x: bigint; y: bigint } {
  const zInv = modInv(p.Z);
  return { x: mod(p.X * zInv), y: mod(p.Y * zInv) };
}

// ── Point encoding ───────────────────────────────────────

function bytesToBigInt(b: Uint8Array): bigint {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]);
  return n;
}

function bigIntToBytes(n: bigint, len = 32): Uint8Array {
  const out = new Uint8Array(len);
  let v = n;
  for (let i = 0; i < len; i++) { out[i] = Number(v & 0xFFn); v >>= 8n; }
  return out;
}

/** Recover x-coordinate from y (RFC 8032 §5.2.3). sign: 0=even, 1=odd. */
function recoverX(y: bigint, sign: number): bigint {
  const y2 = mod(y * y);
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  const v3 = mod(v * v * v);
  const v7 = mod(v3 * v3 * v);
  let x = mod(u * v3 * modPow(u * v7, (P - 5n) / 8n));
  if (mod(v * x * x) !== mod(u)) {
    x = mod(x * SQRT_M1);
  }
  if (Number(x & 1n) !== sign) x = mod(P - x);
  return x;
}

function compressPoint(x: bigint, y: bigint): Uint8Array {
  const out = bigIntToBytes(y);
  if (x & 1n) out[31] |= 0x80;
  return out;
}

// ── Base point ───────────────────────────────────────────

const BY = mod(4n * modInv(5n));
const BX = recoverX(BY, 0);
const BASE_EXT: ExtPoint = { X: BX, Y: BY, Z: 1n, T: mod(BX * BY) };

// ── Montgomery ↔ Edwards ─────────────────────────────────

/**
 * Convert X25519 public key (Montgomery u-coordinate) to Ed25519 compressed
 * point (Edwards y with sign bit). XEdDSA convention: always sign bit 0.
 */
export function montgomeryToEdwards(x25519Pub: Uint8Array): Uint8Array {
  let u = bytesToBigInt(x25519Pub);
  u &= (1n << 255n) - 1n;
  const y = mod((u - 1n) * modInv(mod(u + 1n)));
  // Sign bit always 0 (XEdDSA convention: public key has even x)
  // y < P < 2^255, so bit 255 is naturally 0
  return bigIntToBytes(y);
}

// ── XEdDSA sign ──────────────────────────────────────────

/**
 * XEdDSA keypair: compute Edwards public key from X25519 scalar,
 * negate scalar if public key x-coordinate is odd (force sign bit 0).
 */
function xeddsaKeyPair(x25519Priv: Uint8Array): { a: bigint; pubCompressed: Uint8Array } {
  // Clamp private key to match X25519 convention.
  // Chrome exports raw seed (unclamped); Node.js exports clamped scalar.
  // Clamping is idempotent — safe to always apply.
  const clamped = x25519Priv.slice();
  clamped[0] &= 248;
  clamped[31] &= 127;
  clamped[31] |= 64;
  let a = bytesToBigInt(clamped);
  const A = extToAffine(extScalarMult(a, BASE_EXT));
  if (A.x & 1n) {
    a = L - (a % L); // negate scalar mod L
    return { a, pubCompressed: compressPoint(mod(P - A.x), A.y) };
  }
  return { a, pubCompressed: compressPoint(A.x, A.y) };
}

/**
 * Sign message with X25519 private key using XEdDSA.
 * Produces a 64-byte signature compatible with Ed25519 verification.
 */
export async function xeddsaSign(x25519Priv: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const { a, pubCompressed } = xeddsaKeyPair(x25519Priv);
  const aBytes = bigIntToBytes(mod(a, L));

  // Deterministic nonce (XEdDSA spec: 0xFE pad + scalar + message)
  const rHash = new Uint8Array(await crypto.subtle.digest(
    'SHA-512', concatU8(FE_PAD, aBytes, message) as BufferSource,
  ));
  const r = mod(bytesToBigInt(rHash), L);

  // Nonce commitment R = r * B
  const R = extToAffine(extScalarMult(r, BASE_EXT));
  const RCompressed = compressPoint(R.x, R.y);

  // Challenge hash h = SHA-512(R || A || message) mod L
  const hHash = new Uint8Array(await crypto.subtle.digest(
    'SHA-512', concatU8(RCompressed, pubCompressed, message) as BufferSource,
  ));
  const h = mod(bytesToBigInt(hHash), L);

  // Response s = (r + h * a) mod L
  const s = mod(r + h * a, L);

  return concatU8(RCompressed, bigIntToBytes(s));
}

// ── XEdDSA verify (via Web Crypto) ───────────────────────

/**
 * Verify XEdDSA signature using Web Crypto Ed25519.
 * Converts x25519 public key to Edwards form, then delegates to SubtleCrypto.
 */
export async function xeddsaVerify(
  x25519Pub: Uint8Array,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  try {
    const edwardsPub = montgomeryToEdwards(x25519Pub);
    const pubKey = await crypto.subtle.importKey(
      'raw', edwardsPub as BufferSource, 'Ed25519', false, ['verify'],
    );
    return await crypto.subtle.verify(
      'Ed25519', pubKey, signature as BufferSource, data as BufferSource,
    );
  } catch {
    return false;
  }
}

/** Check if the browser supports Ed25519 verification. */
export async function checkEd25519Support(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    return true;
  } catch {
    return false;
  }
}
