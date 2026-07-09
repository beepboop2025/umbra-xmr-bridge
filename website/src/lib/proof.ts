/**
 * Umbra Proof Layer verification library.
 *
 * Zero runtime dependencies: Ed25519 (RFC 8032) is implemented with plain
 * BigInt arithmetic, hashes use the browser's built-in WebCrypto
 * SHA-256/512. The cryptographic core is copied verbatim from
 * /verifier/umbra-verify.html, which is validated against the official
 * RFC 8032 test vectors — only TypeScript types were added.
 *
 * Everything here runs client-side, in the user's own browser.
 */

// ===========================================================================
// Types for the /v1/proof/* API surface
// ===========================================================================

export interface ReceiptPayload {
  version: string;
  key_id: string;
  order_id: string;
  sequence: number;
  event: string;
  direction: string;
  source_chain: string;
  dest_chain: string;
  from_amount: string | number;
  from_currency: string;
  to_amount: string | number;
  to_currency: string;
  rate: string | number;
  fee: string | number;
  fee_percent: string | number;
  dest_address_sha256: string;
  deposit_tx_hash: string | null;
  withdrawal_tx_hash: string | null;
  /** 64 zeros for sequence 0, otherwise the previous receipt's payload_hash. */
  prev_receipt_hash: string;
  /** RFC 3339 timestamp. */
  timestamp: string;
}

export interface ReceiptEnvelope {
  payload: ReceiptPayload;
  payload_canonical?: string;
  payload_hash?: string;
  signature: string;
  public_key: string;
  key_id?: string;
  /** ML-DSA-65 (FIPS 204) signature — archival, not verified in-browser. */
  signature_pq?: string | null;
  pq_public_key?: string | null;
  pq_key_id?: string | null;
}

export interface ReceiptBundle {
  order_id: string;
  count: number;
  receipts: ReceiptEnvelope[];
  verify_hint?: string;
}

export interface Checkpoint {
  id: number;
  tree_size: number;
  root_hash: string;
  prev_root_hash: string;
  signature: string;
  public_key: string;
  key_id: string;
  signature_pq?: string | null;
  pq_public_key?: string | null;
  pq_key_id?: string | null;
  sealed_at: string;
}

export interface CheckpointEnvelope {
  checkpoint: Checkpoint;
  tree_head_canonical?: string;
}

export interface ProofKey {
  algorithm: string;
  public_key: string;
  key_id: string;
  pq_algorithm: string | null;
  pq_public_key: string | null;
  pq_key_id: string | null;
  receipt_version: string;
  canonicalization: string;
  usage: string;
}

export interface SentinelPause {
  check: string;
  reason: string;
  actor: string;
  tripped_at: string;
}

export interface SentinelEvent {
  id: number;
  kind: string;
  check_name: string;
  reason: string;
  details: string;
  actor: string;
  created_at: string;
}

export interface ProofStatus {
  accepting_orders: boolean;
  paused: SentinelPause | null;
  recent_events: SentinelEvent[];
}

export interface Canary {
  statement: string;
  issued_at: string;
  latest_root_hash: string;
  latest_tree_size: number;
  key_id: string;
  public_key: string;
  signature: string;
}

// ===========================================================================
// Ed25519 verification (RFC 8032), BigInt implementation.
// Validated against RFC 8032 test vectors 1 & 2 and a cross-implementation
// vector generated with Python's `cryptography` package.
// ===========================================================================

type Point = [bigint, bigint, bigint, bigint];

const P = (1n << 255n) - 19n;
const L = (1n << 252n) + 27742317777372353535851937790883648493n;
function mod(a: bigint, m: bigint = P): bigint { const r = a % m; return r >= 0n ? r : r + m; }
function modpow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n; b = mod(b, m);
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
  return r;
}
function inv(a: bigint): bigint { return modpow(mod(a), P - 2n, P); }
const D = mod(-121665n * inv(121666n));
const SQRT_M1 = modpow(2n, (P - 1n) / 4n, P);
const IDENTITY: Point = [0n, 1n, 1n, 0n];

function pointAdd(p1: Point, p2: Point): Point {
  const [X1, Y1, Z1, T1] = p1, [X2, Y2, Z2, T2] = p2;
  const A = mod((Y1 - X1) * (Y2 - X2));
  const B = mod((Y1 + X1) * (Y2 + X2));
  const C = mod(2n * T1 * T2 * D);
  const Dd = mod(2n * Z1 * Z2);
  const E = B - A, F = Dd - C, G = Dd + C, H = B + A;
  return [mod(E * F), mod(G * H), mod(F * G), mod(E * H)];
}
function scalarMult(k: bigint, point: Point): Point {
  let q = IDENTITY, base = point;
  while (k > 0n) { if (k & 1n) q = pointAdd(q, base); base = pointAdd(base, base); k >>= 1n; }
  return q;
}
function pointEqual(p1: Point, p2: Point): boolean {
  const [X1, Y1, Z1] = p1, [X2, Y2, Z2] = p2;
  return mod(X1 * Z2 - X2 * Z1) === 0n && mod(Y1 * Z2 - Y2 * Z1) === 0n;
}
function bytesToNumberLE(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}
function decompress(bytes32: Uint8Array): Point | null {
  if (bytes32.length !== 32) return null;
  const signX = (bytes32[31] & 0x80) !== 0;
  const yBytes = bytes32.slice(); yBytes[31] &= 0x7f;
  const y = bytesToNumberLE(yBytes);
  if (y >= P) return null;
  const y2 = mod(y * y);
  const u = mod(y2 - 1n), v = mod(D * y2 + 1n);
  let x = mod(u * modpow(v, 3n, P) * modpow(mod(u * modpow(v, 7n, P)), (P - 5n) / 8n, P));
  const vx2 = mod(v * x * x);
  if (vx2 === u) { /* ok */ }
  else if (vx2 === mod(-u)) x = mod(x * SQRT_M1);
  else return null;
  if (x === 0n && signX) return null;
  if ((x & 1n) !== (signX ? 1n : 0n)) x = mod(-x);
  return [x, y, 1n, mod(x * y)];
}
const BASE_POINT: Point = (() => {
  const gy = mod(4n * inv(5n));
  const gy2 = mod(gy * gy);
  const u = mod(gy2 - 1n), v = mod(D * gy2 + 1n);
  let gx = mod(u * modpow(v, 3n, P) * modpow(mod(u * modpow(v, 7n, P)), (P - 5n) / 8n, P));
  if (mod(v * gx * gx) !== u) gx = mod(gx * SQRT_M1);
  if ((gx & 1n) !== 0n) gx = mod(-gx);
  return [gx, gy, 1n, mod(gx * gy)] as Point;
})();

export async function sha512(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-512', bytes as BufferSource));
}
export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

export function hexToBytes(hex: string): Uint8Array | null {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let off = 0; for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

export async function ed25519Verify(
  publicKeyHex: string,
  message: Uint8Array,
  signatureHex: string
): Promise<boolean> {
  try {
    const pk = hexToBytes(publicKeyHex), sig = hexToBytes(signatureHex);
    if (!pk || pk.length !== 32 || !sig || sig.length !== 64) return false;
    const A = decompress(pk), R = decompress(sig.slice(0, 32));
    if (!A || !R) return false;
    const S = bytesToNumberLE(sig.slice(32));
    if (S >= L) return false;
    const hram = await sha512(concatBytes(sig.slice(0, 32), pk, message));
    const k = mod(bytesToNumberLE(hram), L);
    return pointEqual(scalarMult(S, BASE_POINT), pointAdd(R, scalarMult(k, A)));
  } catch { return false; }
}

// ===========================================================================
// Canonical JSON — must match the server: keys sorted, compact separators.
// ===========================================================================

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const obj = value as Record<string, unknown>;
  return '{' + Object.keys(obj).sort().map((k) =>
    JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

// ===========================================================================
// RFC 6962 Merkle inclusion verification (leaf 0x00 / node 0x01 prefixes).
// ===========================================================================

export async function merkleLeafHash(dataBytes: Uint8Array): Promise<Uint8Array> {
  return sha256(concatBytes(new Uint8Array([0]), dataBytes));
}
export async function merkleNodeHash(l: Uint8Array, r: Uint8Array): Promise<Uint8Array> {
  return sha256(concatBytes(new Uint8Array([1]), l, r));
}

export async function verifyInclusion(
  leafHash: Uint8Array,
  index: number,
  treeSize: number,
  proofHexes: string[],
  rootHex: string
): Promise<boolean> {
  if (index >= treeSize) return false;
  let fn = BigInt(index), sn = BigInt(treeSize) - 1n;
  let r = leafHash;
  for (const pHex of proofHexes) {
    const p = hexToBytes(pHex);
    if (!p || p.length !== 32 || sn === 0n) return false;
    if ((fn & 1n) === 1n || fn === sn) {
      r = await merkleNodeHash(p, r);
      if ((fn & 1n) === 0n) { while ((fn & 1n) === 0n && fn !== 0n) { fn >>= 1n; sn >>= 1n; } }
    } else {
      r = await merkleNodeHash(r, p);
    }
    fn >>= 1n; sn >>= 1n;
  }
  return sn === 0n && bytesToHex(r) === rootHex.toLowerCase();
}

// ===========================================================================
// High-level verification helpers
// ===========================================================================

const encoder = new TextEncoder();

const GENESIS_HASH = /^0{64}$/;

export interface ReceiptCheckResult {
  /** Recomputed canonical JSON matches the server-provided payload_canonical
   *  (true when the server did not include one — nothing to compare). */
  canonicalMatches: boolean;
  /** SHA-256 of the canonical payload matches payload_hash. */
  hashMatches: boolean;
  /** Ed25519 signature is valid over the canonical payload. */
  signatureValid: boolean;
  /** prev_receipt_hash links to the previous receipt (or the genesis hash
   *  for sequence 0). */
  chainLinks: boolean;
  /** Signed by the pinned key. null when no key is pinned. */
  pinMatches: boolean | null;
  /** Locally recomputed SHA-256 of the canonical payload. */
  payloadHash: string;
  /** An ML-DSA-65 archival signature is attached. */
  hasPqSignature: boolean;
}

export interface ReceiptChainVerdict {
  /** Every check on every receipt passed. */
  ok: boolean;
  results: ReceiptCheckResult[];
  /** All receipts were signed by a single key. */
  singleKey: boolean;
  /** The pasted history starts mid-chain (first receipt has sequence > 0).
   *  Not a failure — earlier receipts simply were not provided. */
  partialHistory: boolean;
  error?: string;
}

/**
 * Verify a full receipt chain for an order: canonicalization, payload
 * hashes, Ed25519 signatures, hash-chain linkage, and (optionally) that
 * every signature was made by a pinned public key.
 */
export async function verifyReceiptChain(
  receipts: ReceiptEnvelope[],
  pinnedKey?: string | null
): Promise<ReceiptChainVerdict> {
  const pin = pinnedKey?.trim().toLowerCase() || null;
  const results: ReceiptCheckResult[] = [];
  const keys = new Set<string>();
  let allOk = true;
  let partialHistory = false;
  let prevHash: string | null = null;

  if (!receipts.length) {
    return { ok: false, results, singleKey: true, partialHistory, error: 'No receipts to verify' };
  }

  for (const r of receipts) {
    const payload = r.payload;
    if (!payload || !r.signature || !r.public_key) {
      return {
        ok: false,
        results,
        singleKey: keys.size <= 1,
        partialHistory,
        error: 'Each receipt needs payload, signature, and public_key fields',
      };
    }
    keys.add(r.public_key.toLowerCase());

    // 1. Canonicalization: recompute from payload; compare with server copy if present.
    const canonical = canonicalJson(payload);
    const canonicalMatches =
      r.payload_canonical === undefined || r.payload_canonical === canonical;

    // 2. Payload hash.
    const hash = bytesToHex(await sha256(encoder.encode(canonical)));
    const hashMatches =
      r.payload_hash === undefined || hash === r.payload_hash.toLowerCase();

    // 3. Signature.
    const signatureValid = await ed25519Verify(r.public_key, encoder.encode(canonical), r.signature);

    // 4. Pin.
    const pinMatches = pin ? r.public_key.toLowerCase() === pin : null;

    // 5. Chain linkage.
    let chainLinks: boolean;
    if (prevHash === null) {
      if (payload.sequence === 0) {
        chainLinks = GENESIS_HASH.test(payload.prev_receipt_hash || '');
      } else {
        // Partial history: earlier receipts were not provided; nothing to link against.
        chainLinks = true;
        partialHistory = true;
      }
    } else {
      chainLinks = payload.prev_receipt_hash === prevHash;
    }
    prevHash = hash;

    const result: ReceiptCheckResult = {
      canonicalMatches,
      hashMatches,
      signatureValid,
      chainLinks,
      pinMatches,
      payloadHash: hash,
      hasPqSignature: Boolean(r.signature_pq),
    };
    results.push(result);

    if (!canonicalMatches || !hashMatches || !signatureValid || !chainLinks || pinMatches === false) {
      allOk = false;
    }
  }

  const singleKey = keys.size <= 1;
  if (!singleKey) allOk = false;

  return { ok: allOk, results, singleKey, partialHistory };
}

export interface CheckpointVerdict {
  ok: boolean;
  /** Locally rebuilt tree head matches the server's tree_head_canonical
   *  (true when the server did not include one). */
  canonicalMatches: boolean;
  /** Ed25519 signature is valid over the canonical tree head. */
  signatureValid: boolean;
  /** Signed by the pinned key. null when no key is pinned. */
  pinMatches: boolean | null;
  /** The canonical tree head that was verified. */
  canonical: string;
  /** An ML-DSA-65 archival signature is attached. */
  hasPqSignature: boolean;
  error?: string;
}

/**
 * Verify a transparency checkpoint: rebuild the exact signed tree-head
 * payload from its fields and check the Ed25519 signature over it.
 */
export async function verifyCheckpoint(
  envelope: CheckpointEnvelope | Checkpoint,
  pinnedKey?: string | null
): Promise<CheckpointVerdict> {
  const pin = pinnedKey?.trim().toLowerCase() || null;
  const cp = 'checkpoint' in envelope ? envelope.checkpoint : envelope;
  const treeHeadCanonical =
    'checkpoint' in envelope ? envelope.tree_head_canonical : undefined;

  const fail = (error: string): CheckpointVerdict => ({
    ok: false,
    canonicalMatches: false,
    signatureValid: false,
    pinMatches: pin ? false : null,
    canonical: '',
    hasPqSignature: false,
    error,
  });

  if (!cp) return fail('Missing checkpoint object');
  for (const f of ['tree_size', 'root_hash', 'prev_root_hash', 'signature', 'public_key', 'key_id', 'sealed_at'] as const) {
    if (cp[f] === undefined) return fail(`Checkpoint is missing field "${f}"`);
  }

  // Rebuild the exact signed tree-head payload.
  const head = {
    version: '1', log_id: 'umbra-audit-v1',
    tree_size: cp.tree_size, root_hash: cp.root_hash,
    prev_root_hash: cp.prev_root_hash, key_id: cp.key_id,
    sealed_at: cp.sealed_at,
  };
  const canonical = canonicalJson(head);

  const canonicalMatches =
    treeHeadCanonical === undefined || treeHeadCanonical === canonical;
  const signatureValid = await ed25519Verify(cp.public_key, encoder.encode(canonical), cp.signature);
  const pinMatches = pin ? cp.public_key.toLowerCase() === pin : null;

  return {
    ok: canonicalMatches && signatureValid && pinMatches !== false,
    canonicalMatches,
    signatureValid,
    pinMatches,
    canonical,
    hasPqSignature: Boolean(cp.signature_pq),
  };
}

/**
 * Verify a warrant-canary signature. The signed message is the canonical
 * JSON of the canary fields (keys sorted), excluding public_key/signature.
 */
export async function verifyCanary(canary: Canary): Promise<boolean> {
  const body = {
    version: '1',
    type: 'canary',
    statement: canary.statement,
    issued_at: canary.issued_at,
    latest_root_hash: canary.latest_root_hash,
    latest_tree_size: canary.latest_tree_size,
    key_id: canary.key_id,
  };
  return ed25519Verify(canary.public_key, encoder.encode(canonicalJson(body)), canary.signature);
}

// ===========================================================================
// Pinned-key persistence (shared by /verify and /transparency)
// ===========================================================================

const PINNED_KEY_STORAGE = 'umbra_pinned_proof_key';

export function getStoredPinnedKey(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(PINNED_KEY_STORAGE);
  } catch {
    return null;
  }
}

export function storePinnedKey(key: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (key && key.trim()) {
      window.localStorage.setItem(PINNED_KEY_STORAGE, key.trim().toLowerCase());
    } else {
      window.localStorage.removeItem(PINNED_KEY_STORAGE);
    }
  } catch {
    // localStorage unavailable (private mode etc.) — pin just won't persist.
  }
}
