#!/usr/bin/env python3
"""Umbra offline proof verifier — pure Python, zero dependencies.

Verifies the three artifact types of the Umbra Proof Layer without touching
the network or trusting anything but this file and Python's stdlib:

  swap receipts       Ed25519 signatures over canonical payload JSON,
                      SHA-256 payload hashes, per-order hash chain linkage
  checkpoints         Ed25519 signatures over transparency tree heads
  inclusion proofs    RFC 6962 Merkle audit paths against a checkpoint

Usage:
  verify_receipt.py receipts   <file.json|-> [--pin PUBKEY_HEX]
  verify_receipt.py checkpoint <file.json|-> [--pin PUBKEY_HEX]
  verify_receipt.py inclusion  <file.json|-> [--pin PUBKEY_HEX]

Pass '-' to read from stdin, e.g.:
  curl -s https://bridge.example/v1/proof/receipt/br_ab12cd34ef56 \
      | verify_receipt.py receipts - --pin 2152f8…db12

Exit codes: 0 verified, 1 verification failed, 2 usage/input error.

The Ed25519 implementation below follows RFC 8032 exactly and is validated
against the RFC test vectors by `--self-test`. It is intentionally simple and
non-constant-time: it only ever handles PUBLIC data (signature verification),
never secrets.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys

# ---------------------------------------------------------------------------
# Ed25519 verification (RFC 8032)
# ---------------------------------------------------------------------------

P = 2**255 - 19
L = 2**252 + 27742317777372353535851937790883648493
D = (-121665 * pow(121666, P - 2, P)) % P
SQRT_M1 = pow(2, (P - 1) // 4, P)
IDENTITY = (0, 1, 1, 0)


def _point_add(p1, p2):
    x1, y1, z1, t1 = p1
    x2, y2, z2, t2 = p2
    a = (y1 - x1) * (y2 - x2) % P
    b = (y1 + x1) * (y2 + x2) % P
    c = 2 * t1 * t2 * D % P
    d = 2 * z1 * z2 % P
    e, f, g, h = b - a, d - c, d + c, b + a
    return (e * f % P, g * h % P, f * g % P, e * h % P)


def _scalar_mult(k, point):
    q, base = IDENTITY, point
    while k > 0:
        if k & 1:
            q = _point_add(q, base)
        base = _point_add(base, base)
        k >>= 1
    return q


def _point_equal(p1, p2):
    x1, y1, z1, _ = p1
    x2, y2, z2, _ = p2
    return (x1 * z2 - x2 * z1) % P == 0 and (y1 * z2 - y2 * z1) % P == 0


def _decompress(b: bytes):
    if len(b) != 32:
        return None
    sign_x = b[31] >> 7
    y = int.from_bytes(bytes(b[:31]) + bytes([b[31] & 0x7F]), "little")
    if y >= P:
        return None
    y2 = y * y % P
    u, v = (y2 - 1) % P, (D * y2 + 1) % P
    x = u * pow(v, 3, P) * pow(u * pow(v, 7, P), (P - 5) // 8, P) % P
    vx2 = v * x * x % P
    if vx2 == u:
        pass
    elif vx2 == (-u) % P:
        x = x * SQRT_M1 % P
    else:
        return None
    if x == 0 and sign_x:
        return None
    if x & 1 != sign_x:
        x = P - x
    return (x, y, 1, x * y % P)


def _base_point():
    gy = 4 * pow(5, P - 2, P) % P
    gy2 = gy * gy % P
    u, v = (gy2 - 1) % P, (D * gy2 + 1) % P
    gx = u * pow(v, 3, P) * pow(u * pow(v, 7, P), (P - 5) // 8, P) % P
    if v * gx * gx % P != u:
        gx = gx * SQRT_M1 % P
    if gx & 1:
        gx = P - gx
    return (gx, gy, 1, gx * gy % P)


BASE_POINT = _base_point()


def ed25519_verify(public_key_hex: str, message: bytes, signature_hex: str) -> bool:
    try:
        pk = bytes.fromhex(public_key_hex)
        sig = bytes.fromhex(signature_hex)
    except ValueError:
        return False
    if len(pk) != 32 or len(sig) != 64:
        return False
    a = _decompress(pk)
    r = _decompress(sig[:32])
    if a is None or r is None:
        return False
    s = int.from_bytes(sig[32:], "little")
    if s >= L:
        return False
    hram = hashlib.sha512(sig[:32] + pk + message).digest()
    k = int.from_bytes(hram, "little") % L
    return _point_equal(_scalar_mult(s, BASE_POINT), _point_add(r, _scalar_mult(k, a)))


# ---------------------------------------------------------------------------
# Canonical JSON (must byte-match the server: sorted keys, compact separators)
# ---------------------------------------------------------------------------

def canonical_json(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


# ---------------------------------------------------------------------------
# RFC 6962 Merkle inclusion verification
# ---------------------------------------------------------------------------

def merkle_leaf_hash(data: bytes) -> bytes:
    return hashlib.sha256(b"\x00" + data).digest()


def merkle_node_hash(left: bytes, right: bytes) -> bytes:
    return hashlib.sha256(b"\x01" + left + right).digest()


def verify_inclusion(leaf: bytes, index: int, tree_size: int, proof: list[str], root_hex: str) -> bool:
    if index >= tree_size:
        return False
    fn, sn, r = index, tree_size - 1, leaf
    for p_hex in proof:
        try:
            p = bytes.fromhex(p_hex)
        except ValueError:
            return False
        if len(p) != 32 or sn == 0:
            return False
        if fn & 1 or fn == sn:
            r = merkle_node_hash(p, r)
            if not fn & 1:
                while not fn & 1 and fn != 0:
                    fn >>= 1
                    sn >>= 1
        else:
            r = merkle_node_hash(r, p)
        fn >>= 1
        sn >>= 1
    return sn == 0 and r.hex() == root_hex.lower()


# ---------------------------------------------------------------------------
# Verification report helpers
# ---------------------------------------------------------------------------

GENESIS_RE = re.compile(r"^0{64}$")
OK, BAD, WARN = "✓", "✗", "△"


class Report:
    def __init__(self):
        self.lines: list[str] = []
        self.ok = True

    def add(self, passed: bool, text: str, warn_only: bool = False):
        mark = OK if passed else (WARN if warn_only else BAD)
        self.lines.append(f"  {mark} {text}")
        if not passed and not warn_only:
            self.ok = False

    def render(self, subject: str) -> int:
        print("\n".join(self.lines))
        print()
        if self.ok:
            print(f"{OK} VERIFIED — {subject}")
            return 0
        print(f"{BAD} VERIFICATION FAILED — do not trust this data")
        return 1


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

def cmd_receipts(data, pin: str | None) -> int:
    receipts = data if isinstance(data, list) else data.get("receipts", [data])
    if not receipts:
        print("No receipts found in input", file=sys.stderr)
        return 2

    rpt = Report()
    prev_hash = None
    keys = set()

    for r in receipts:
        payload = r.get("payload")
        if payload is None or "signature" not in r or "public_key" not in r:
            print("Each receipt needs payload, signature, and public_key", file=sys.stderr)
            return 2
        keys.add(r["public_key"].lower())
        seq, event = payload.get("sequence"), payload.get("event")
        rpt.lines.append(f"receipt #{seq} · {event} · {payload.get('timestamp')}")

        canonical = canonical_json(payload)
        if "payload_canonical" in r:
            rpt.add(r["payload_canonical"] == canonical,
                    "server canonical form matches local re-canonicalization")

        digest = sha256_hex(canonical.encode())
        if "payload_hash" in r:
            rpt.add(digest == r["payload_hash"].lower(),
                    f"SHA-256(payload) = {digest[:16]}… matches payload_hash")

        rpt.add(ed25519_verify(r["public_key"], canonical.encode(), r["signature"]),
                "Ed25519 signature valid over canonical payload")

        if pin:
            rpt.add(r["public_key"].lower() == pin.lower(),
                    "signed by the pinned key")

        if prev_hash is None:
            if payload.get("sequence") == 0:
                rpt.add(bool(GENESIS_RE.match(payload.get("prev_receipt_hash", ""))),
                        "first receipt anchors to the genesis hash")
            else:
                rpt.add(True, f"starts at sequence {seq} (partial history)", warn_only=True)
        else:
            rpt.add(payload.get("prev_receipt_hash") == prev_hash,
                    "prev_receipt_hash links to the previous receipt")
        prev_hash = digest

    if len(keys) > 1:
        rpt.add(False, "receipts signed by MULTIPLE different keys")

    return rpt.render(f"{len(receipts)} receipt(s): this history is exactly what the bridge signed")


def tree_head_payload(cp: dict) -> dict:
    return {
        "version": "1",
        "log_id": "umbra-audit-v1",
        "tree_size": cp["tree_size"],
        "root_hash": cp["root_hash"],
        "prev_root_hash": cp["prev_root_hash"],
        "key_id": cp["key_id"],
        "sealed_at": cp["sealed_at"],
    }


def cmd_checkpoint(data, pin: str | None) -> int:
    cp = data.get("checkpoint", data)
    for f in ("tree_size", "root_hash", "prev_root_hash", "signature", "public_key", "key_id", "sealed_at"):
        if f not in cp:
            print(f"Checkpoint is missing field {f!r}", file=sys.stderr)
            return 2

    rpt = Report()
    canonical = canonical_json(tree_head_payload(cp))

    if "tree_head_canonical" in data:
        rpt.add(data["tree_head_canonical"] == canonical,
                "server tree-head canonical form matches local reconstruction")

    rpt.add(ed25519_verify(cp["public_key"], canonical.encode(), cp["signature"]),
            f"Ed25519 signature valid over tree head "
            f"(size {cp['tree_size']}, root {str(cp['root_hash'])[:16]}…)")

    if pin:
        rpt.add(cp["public_key"].lower() == pin.lower(), "signed by the pinned key")

    rpt.add(True, f"sealed at {cp['sealed_at']} — compare (size, root) with other witnesses",
            warn_only=True)
    return rpt.render("checkpoint: the bridge is committed to this exact audit history")


def cmd_inclusion(data, pin: str | None) -> int:
    for f in ("leaf_data", "leaf_index", "tree_size", "root_hash", "proof"):
        if f not in data:
            print(f"Proof is missing field {f!r}", file=sys.stderr)
            return 2

    rpt = Report()
    leaf = merkle_leaf_hash(data["leaf_data"].encode())

    if "leaf_hash" in data:
        rpt.add(leaf.hex() == data["leaf_hash"].lower(), "recomputed RFC 6962 leaf hash matches")

    rpt.add(verify_inclusion(leaf, int(data["leaf_index"]), int(data["tree_size"]),
                             data["proof"], data["root_hash"]),
            f"Merkle audit path proves leaf {data['leaf_index']} is in the tree "
            f"of {data['tree_size']} entries")

    cp = data.get("checkpoint")
    if cp:
        canonical = canonical_json(tree_head_payload(cp))
        rpt.add(ed25519_verify(cp["public_key"], canonical.encode(), cp["signature"]),
                "enclosed checkpoint signature is valid")
        rpt.add(cp["root_hash"] == data["root_hash"] and cp["tree_size"] == data["tree_size"],
                "proof root matches the signed checkpoint root")
        if pin:
            rpt.add(cp["public_key"].lower() == pin.lower(), "signed by the pinned key")

    return rpt.render("inclusion: this audit entry is cryptographically committed to by the log")


# ---------------------------------------------------------------------------
# Self-test (RFC 8032 vectors)
# ---------------------------------------------------------------------------

def self_test() -> int:
    pk1 = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
    sig1 = ("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155"
            "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b")
    pk2 = "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c"
    sig2 = ("92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da"
            "085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00")

    checks = [
        ed25519_verify(pk1, b"", sig1),                 # RFC 8032 vector 1
        not ed25519_verify(pk1, b"x", sig1),            # tamper rejection
        ed25519_verify(pk2, b"\x72", sig2),             # RFC 8032 vector 2
        not ed25519_verify(pk2, b"\x72", "ff" + sig2[2:]),
    ]
    if all(checks):
        print(f"{OK} self-test passed (RFC 8032 vectors)")
        return 0
    print(f"{BAD} SELF-TEST FAILED — do not use this copy")
    return 1


# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["receipts", "checkpoint", "inclusion", "self-test"])
    parser.add_argument("file", nargs="?", help="JSON file, or '-' for stdin")
    parser.add_argument("--pin", help="expected bridge public key (64 hex chars)")
    args = parser.parse_args()

    if args.command == "self-test":
        return self_test()

    if not args.file:
        parser.error("a JSON file (or '-') is required")
    try:
        raw = sys.stdin.read() if args.file == "-" else open(args.file, encoding="utf-8").read()
        data = json.loads(raw)
    except (OSError, json.JSONDecodeError) as e:
        print(f"Cannot read input: {e}", file=sys.stderr)
        return 2

    return {"receipts": cmd_receipts,
            "checkpoint": cmd_checkpoint,
            "inclusion": cmd_inclusion}[args.command](data, args.pin)


if __name__ == "__main__":
    sys.exit(main())
