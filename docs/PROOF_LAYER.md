# Umbra Proof Layer — Protocol Specification v1

This document specifies the Proof Layer precisely enough to build an
independent verifier from scratch. Three reference verifiers ship in this
repository (browser page, single-file HTML, Python CLI); if your
implementation disagrees with them on any artifact, at least one of the four
has a bug — please report it.

Design goal: **a user should be able to prove what the bridge did, and detect
what it undid, without trusting the bridge's website, API, database, or TLS.**

---

## 1. Cryptographic primitives

| Purpose | Primitive | Notes |
|---|---|---|
| Online signatures | Ed25519 (RFC 8032) | 32-byte keys, 64-byte signatures, hex-encoded |
| Post-quantum signatures | ML-DSA-65 (FIPS 204) | 1952-byte keys, 3309-byte signatures, hex-encoded; context string `umbra-proof-v1` |
| Hashing | SHA-256 | hex-encoded everywhere |
| Merkle tree | RFC 6962 / RFC 9162 | leaf prefix `0x00`, node prefix `0x01` |

### 1.1 Canonical JSON

Every signature covers the **canonical JSON** encoding of a payload object:

- UTF-8
- no insignificant whitespace (separators `,` and `:`)
- object keys sorted lexicographically (byte order), at every nesting level
- numbers as-is (receipt payloads use strings for all decimal quantities, so
  no float formatting ambiguity exists; the only raw integers are `sequence`
  and `tree_size`/`latest_tree_size`, which are small and exact)

Equivalent constructions: `serde_json::Value::to_string()` (Rust),
`json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`
(Python), or a recursive key-sorting stringify (JavaScript — see
`canonicalJson` in `verifier/umbra-verify.html`).

### 1.2 Key identifiers

`key_id` = first 8 bytes (16 hex chars) of `SHA-256(public_key_bytes)`. It is
a convenience for spotting rotation, not a security boundary — always verify
against the full pinned key.

---

## 2. Swap receipts

### 2.1 Payload

One receipt is issued per order lifecycle event. The signed payload is:

```json
{
  "version": "1",
  "key_id": "<16 hex>",
  "order_id": "br_<12 hex>",
  "sequence": 0,
  "event": "order_created | status_awaiting_deposit | status_confirming | ... ",
  "direction": "XMR_TO_TON",
  "source_chain": "XMR",
  "dest_chain": "TON",
  "from_amount": "5",
  "from_currency": "XMR",
  "to_amount": "492.5",
  "to_currency": "TON",
  "rate": "98.5",
  "fee": "1.5",
  "fee_percent": "0.3",
  "dest_address_sha256": "<64 hex — SHA-256 of the destination address string>",
  "deposit_tx_hash": null,
  "withdrawal_tx_hash": null,
  "prev_receipt_hash": "<64 hex — see 2.2>",
  "timestamp": "2026-07-07T12:00:00.000000Z"
}
```

Privacy note: the destination address appears only as a hash. The user, who
knows their own address, can verify the binding; a third party holding the
receipt learns nothing address-shaped.

### 2.2 Per-order hash chain

- `payload_hash` = SHA-256 of the canonical payload bytes (hex).
- Receipt `sequence = 0` has `prev_receipt_hash = "0" × 64` (genesis).
- Receipt `n > 0` must have `prev_receipt_hash` equal to receipt `n−1`'s
  `payload_hash`.

The chain makes an order's *history* tamper-evident on its own: replacing or
deleting any intermediate receipt breaks every later link.

### 2.3 Envelope

`GET /v1/proof/receipt/{order_id}` returns:

```json
{
  "order_id": "...",
  "count": 3,
  "receipts": [
    {
      "payload": { ... },
      "payload_canonical": "<canonical bytes as a string, convenience only>",
      "payload_hash": "<64 hex>",
      "signature": "<128 hex — Ed25519 over canonical payload bytes>",
      "public_key": "<64 hex>",
      "key_id": "<16 hex>",
      "signature_pq": "<6618 hex — ML-DSA-65, optional>",
      "pq_public_key": "<3904 hex, optional>",
      "pq_key_id": "<16 hex, optional>"
    }
  ]
}
```

### 2.4 Verification algorithm

For each receipt, in order:

1. Recompute canonical form from `payload`. If `payload_canonical` is present
   it MUST match byte-for-byte (a mismatch means the server lied about its
   own canonicalization).
2. `SHA-256(canonical)` MUST equal `payload_hash`.
3. `Ed25519.verify(public_key, canonical_bytes, signature)` MUST succeed.
4. If pinning: `public_key` MUST equal the pinned key.
5. Chain: first pasted receipt with `sequence = 0` MUST anchor to the genesis
   hash; each later receipt's `prev_receipt_hash` MUST equal the previous
   receipt's recomputed `payload_hash`.
6. All receipts in one order MUST share one signing key.
7. (Archival, optional) `ML-DSA-65.verify(pq_public_key, canonical_bytes,
   signature_pq, ctx="umbra-proof-v1")`.

Reject everything on any failure. There are no partial passes.

---

## 3. Transparency log

### 3.1 Leaves

The audit log is an append-only table where each row carries a SHA-256
`content_hash` chaining it to the previous row. The Merkle tree's **leaf data
is the 64-character lowercase hex string** of `content_hash`, as UTF-8 bytes
(not the decoded 32 bytes). Leaf index = the row's zero-based position in
`id` order.

### 3.2 Tree construction

RFC 6962: `leaf = SHA-256(0x00 || data)`,
`node = SHA-256(0x01 || left || right)`, split point = largest power of two
strictly less than n. The implementation is validated against the
certificate-transparency known-answer vectors (tree sizes 1–8).

### 3.3 Checkpoints (signed tree heads)

Sealed periodically (default 300 s) when the log has grown. The signed
payload is:

```json
{
  "version": "1",
  "log_id": "umbra-audit-v1",
  "tree_size": 1234,
  "root_hash": "<64 hex>",
  "prev_root_hash": "<64 hex — previous checkpoint's root, or genesis>",
  "key_id": "<16 hex>",
  "sealed_at": "2026-07-07T12:00:00.000000Z"
}
```

Signature: Ed25519 over the canonical form; plus optional ML-DSA-65 with the
same context string. Endpoints: `/v1/proof/checkpoint/latest`,
`/v1/proof/checkpoints?limit=`.

### 3.4 Proofs

- **Inclusion** (`/v1/proof/inclusion/{audit_id}`): RFC 6962 audit path from
  the leaf to the newest checkpoint covering it. Verify with the RFC 9162
  §2.1.3.2 algorithm; the response's `leaf_data`, `leaf_index`, `tree_size`,
  `root_hash`, and `proof` array are all you need, and `root_hash`/`tree_size`
  MUST match a **signed** checkpoint.
- **Consistency** (`/v1/proof/consistency?old_size=&new_size=`): RFC 6962
  §2.1.2 proof that the old tree is a prefix of the new. Verify with RFC 9162
  §2.1.4.2. This is the append-only guarantee: a bridge that rewrites even one
  sealed audit entry can never again produce a valid consistency proof from
  the old checkpoint.

### 3.5 Witnessing

Anyone who periodically fetches and stores `(tree_size, root_hash, signature)`
becomes a witness. Two witnesses comparing notes detect **split-view attacks**
(serving different histories to different people). Suggested cadence: hourly
cron + on-demand before large swaps.

---

## 4. Canary

`GET /v1/proof/canary` returns a signed statement. Signed payload:

```json
{
  "version": "1",
  "type": "canary",
  "statement": "<operator-configured text>",
  "issued_at": "<RFC3339, generated per request>",
  "latest_root_hash": "<64 hex>",
  "latest_tree_size": 1234,
  "key_id": "<16 hex>"
}
```

Binding the latest checkpoint root means a canary cannot be replayed against
a rewound log; binding the issuance time makes staleness observable. Clients
SHOULD treat a canary older than their tolerance (the website uses 24 h/72 h
thresholds) — or one that stops being served — as a signal in itself.

---

## 5. Sentinel

Not a cryptographic artifact, but part of the accountability story because
its every action is forced into the audit chain (and therefore under the
transparency log):

- Guards: order velocity (5 min), failure spike (15 min), per-chain outflow
  velocity (1 h sliding), rate-source divergence (10 min), optional Isolation
  Forest anomaly score (1 h vs 7 day baseline via the risk engine).
- A trip sets a Redis flag checked at order creation → new intake gets HTTP
  503 with the reason; in-flight orders are unaffected.
- No auto-resume. `POST /v1/admin/sentinel/resume` requires an authenticated
  admin **and a note**, and writes `sentinel_resumed` to the audit chain.
- Public state: `GET /v1/proof/status` (accepting_orders, pause cause, recent
  events). Pausing the bridge secretly, or un-pausing it secretly, is not
  possible without breaking the transparency log.

Fail-open vs fail-closed: guard *evaluation* errors fail open (a broken risk
engine must not halt the bridge); the *pause flag* fails closed (order
creation checks it synchronously and refuses on Redis error only if the flag
read succeeds and is set — a Redis outage does not fabricate a pause).

---

## 6. Threat model summary

| Threat | Countermeasure |
|---|---|
| Operator rewrites an order's history after the fact | per-order receipt hash chain + user-held receipts |
| Operator rewrites the audit log | consistency proofs between sealed checkpoints |
| Operator shows different histories to different users | checkpoint witnessing (split-view detection) |
| Compromised web frontend lies about verification | all three verifiers run client-side / offline; key pinning |
| Key compromise drains the bridge | sentinel outflow caps + velocity guards pause intake in ≤ 30 s |
| Oracle poisoning misprices swaps | multi-source rate divergence guard |
| Novel drain pattern below fixed thresholds | Isolation Forest guard on flow-shape combinations |
| Secret legal compulsion | signed, freshness-bound, log-anchored canary |
| Future quantum adversary forges "historical" receipts | ML-DSA-65 hybrid signatures over the same bytes |
| Proof layer as metadata leak | receipts carry only a hash of the destination address |

Out of scope for v1: proof-of-reserves attestation (planned: Merkle-sum tree
over liabilities vs on-chain reserve addresses), externally co-signed
checkpoints (multiple independent log operators), and receipt delivery over
Telegram with client-side pinning.

---

## 7. Test vectors

Cross-implementation vectors used by the test suites:

- Ed25519: RFC 8032 §7.1 test vectors 1 and 2 (all shipped verifiers
  self-test against vector 1 on startup/load).
- Canonicalization + signing: seed `0x42 × 32`, payload
  `{"b":"2","a":"1","nested":{"z":true,"y":null}}` →
  canonical `{"a":"1","b":"2","nested":{"y":null,"z":true}}`,
  public key `2152f8d19b791d24453242e15f2eab6cb7cffa7b6a5ed30097960e069881db12`,
  signature `84e4e388944ebe54ebaf402847f4a77143dcc314782f9c3b7bd4398065e0f7b45f5ba8140d119bc64780b928c7f9780c6a8cbd3f44c046ef8afd71f4b812250f`
  (independently generated with Python `cryptography`, asserted in the Rust
  unit tests).
- Merkle: certificate-transparency known-answer roots for tree sizes 1–8
  (see `backend/src/utils/merkle.rs`); a sample inclusion proof can be
  regenerated with
  `cargo test print_sample_inclusion_proof -- --ignored --nocapture`.
