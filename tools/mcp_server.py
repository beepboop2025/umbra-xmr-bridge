#!/usr/bin/env python3
"""Umbra Proof-Layer MCP server — verify a bridge's accountability artifacts.

READ-ONLY BY DESIGN. This server exposes exactly the mature, safe half of Umbra:
the offline verification of the Proof Layer's signed, transparency-logged
artifacts. It does NOT quote swaps, move funds, hold keys, or touch the bridge —
it only checks cryptographic proofs an agent already holds. An AI agent that
received an Umbra swap receipt, a transparency checkpoint, or an inclusion proof
can verify it here before trusting it, without running the CLI itself.

Three tools over the zero-dependency verifier in tools/verify_receipt.py (RFC
8032 Ed25519 + RFC 6962 Merkle, pure stdlib):

  verify_swap_receipt   A receipt (or a chain of them) is exactly what the bridge
                        signed: Ed25519 over the canonical payload, the SHA-256
                        payload hash, and the per-order hash-chain linkage.
  verify_checkpoint     A transparency checkpoint is a valid signed tree head —
                        the bridge is committed to that exact audit history.
  verify_inclusion      A Merkle audit path proves a specific entry is in the
                        log committed to by a checkpoint.

Each tool takes the artifact JSON and an optional pinned public key, and returns
a structured verdict (valid + per-check booleans + a summary) instead of the
CLI's text report, so an agent can branch on it. Honest by construction: an
unverifiable signature or a broken chain returns valid=false with the failing
check named — it never asserts a proof it could not check.
"""
from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import verify_receipt as vr  # noqa: E402

PROTOCOL_VERSION = "2025-06-18"
SERVER_NAME = "umbra-proof"
SERVER_VERSION = "0.1.0"
GENESIS_RE = re.compile(r"^0{64}$")


def _check(ok: bool, note: str) -> dict:
    return {"ok": bool(ok), "note": note}


# ── verification (structured; mirrors verify_receipt.cmd_* without the CLI Report)

def verify_swap_receipt(args: dict) -> dict:
    data = args["receipt"]
    pin = args.get("pinned_public_key")
    receipts = data if isinstance(data, list) else data.get("receipts", [data])
    if not receipts:
        return {"valid": False, "checks": [_check(False, "no receipts in input")]}

    checks: list[dict] = []
    prev_hash = None
    keys = set()
    for r in receipts:
        payload = r.get("payload")
        if payload is None or "signature" not in r or "public_key" not in r:
            return {"valid": False,
                    "checks": [_check(False, "each receipt needs payload, signature, public_key")]}
        keys.add(r["public_key"].lower())
        seq = payload.get("sequence")
        canonical = vr.canonical_json(payload)
        if "payload_hash" in r:
            checks.append(_check(vr.sha256_hex(canonical.encode()) == r["payload_hash"].lower(),
                                 f"receipt #{seq}: SHA-256(payload) matches payload_hash"))
        checks.append(_check(vr.ed25519_verify(r["public_key"], canonical.encode(), r["signature"]),
                             f"receipt #{seq}: Ed25519 signature valid over canonical payload"))
        if pin:
            checks.append(_check(r["public_key"].lower() == pin.lower(),
                                 f"receipt #{seq}: signed by the pinned key"))
        # hash-chain linkage
        digest = vr.sha256_hex(canonical.encode())
        if prev_hash is None:
            if payload.get("sequence") == 0:
                checks.append(_check(bool(GENESIS_RE.match(payload.get("prev_receipt_hash", ""))),
                                     "first receipt anchors to the genesis hash"))
        else:
            checks.append(_check(payload.get("prev_receipt_hash") == prev_hash,
                                 f"receipt #{seq}: prev_receipt_hash links to the previous receipt"))
        prev_hash = digest
    if len(keys) > 1:
        checks.append(_check(False, "receipts signed by MULTIPLE different keys"))

    valid = all(c["ok"] for c in checks)
    return {"valid": valid, "n_receipts": len(receipts), "checks": checks,
            "summary": (f"{len(receipts)} receipt(s): this history is exactly what the bridge "
                        "signed" if valid else "verification FAILED — do not trust this history")}


def verify_checkpoint(args: dict) -> dict:
    data = args["checkpoint"]
    pin = args.get("pinned_public_key")
    cp = data.get("checkpoint", data)
    need = ("tree_size", "root_hash", "prev_root_hash", "signature", "public_key", "key_id", "sealed_at")
    missing = [f for f in need if f not in cp]
    if missing:
        return {"valid": False, "checks": [_check(False, f"checkpoint missing fields: {missing}")]}

    canonical = vr.canonical_json(vr.tree_head_payload(cp))
    checks = [_check(vr.ed25519_verify(cp["public_key"], canonical.encode(), cp["signature"]),
                     f"Ed25519 signature valid over tree head (size {cp['tree_size']})")]
    if pin:
        checks.append(_check(cp["public_key"].lower() == pin.lower(), "signed by the pinned key"))
    valid = all(c["ok"] for c in checks)
    return {"valid": valid, "tree_size": cp["tree_size"], "root_hash": cp["root_hash"],
            "checks": checks,
            "summary": ("the bridge is committed to this exact audit history" if valid
                        else "checkpoint signature INVALID"),
            "note": "compare (tree_size, root_hash) with other witnesses for split-view safety"}


def verify_inclusion(args: dict) -> dict:
    data = args["proof"]
    pin = args.get("pinned_public_key")
    need = ("leaf_data", "leaf_index", "tree_size", "root_hash", "proof")
    missing = [f for f in need if f not in data]
    if missing:
        return {"valid": False, "checks": [_check(False, f"proof missing fields: {missing}")]}

    leaf = vr.merkle_leaf_hash(data["leaf_data"].encode())
    checks = [_check(vr.verify_inclusion(leaf, int(data["leaf_index"]), int(data["tree_size"]),
                                         data["proof"], data["root_hash"]),
                     f"Merkle audit path proves leaf {data['leaf_index']} is in the tree of "
                     f"{data['tree_size']} entries")]
    cp = data.get("checkpoint")
    if cp:
        canonical = vr.canonical_json(vr.tree_head_payload(cp))
        checks.append(_check(vr.ed25519_verify(cp["public_key"], canonical.encode(), cp["signature"]),
                             "enclosed checkpoint signature is valid"))
        checks.append(_check(cp["root_hash"] == data["root_hash"] and cp["tree_size"] == data["tree_size"],
                             "proof root matches the signed checkpoint root"))
        if pin:
            checks.append(_check(cp["public_key"].lower() == pin.lower(), "signed by the pinned key"))
    valid = all(c["ok"] for c in checks)
    return {"valid": valid, "checks": checks,
            "summary": ("this audit entry is cryptographically committed to by the log" if valid
                        else "inclusion proof INVALID")}


TOOLS = [
    {
        "name": "verify_swap_receipt",
        "description": (
            "Verify an Umbra swap receipt (or a chain of them) is exactly what the "
            "bridge signed — Ed25519 over the canonical payload, the SHA-256 payload "
            "hash, and the per-order hash-chain linkage. Call before trusting a "
            "receipt you were handed. Returns valid + per-check booleans; pass "
            "pinned_public_key to also require a specific signer. Read-only: verifies "
            "a proof you already hold, never touches the bridge or funds."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "receipt": {"description": "A receipt object, {receipts:[...]}, or a list."},
                "pinned_public_key": {"type": "string",
                                      "description": "Optional hex pubkey the signer must match."},
            },
            "required": ["receipt"],
        },
    },
    {
        "name": "verify_checkpoint",
        "description": (
            "Verify an Umbra transparency-log checkpoint is a valid signed tree head — "
            "proof that the bridge is committed to that exact audit history. Returns "
            "valid, tree_size, root_hash. Compare (tree_size, root_hash) across "
            "witnesses to detect a split view. Read-only."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "checkpoint": {"description": "A checkpoint object or {checkpoint:{...}}."},
                "pinned_public_key": {"type": "string"},
            },
            "required": ["checkpoint"],
        },
    },
    {
        "name": "verify_inclusion",
        "description": (
            "Verify an RFC-6962 Merkle inclusion proof: that a specific audit entry is "
            "in the log committed to by a checkpoint. Include the checkpoint in the "
            "proof to also verify its signature and that the roots match. Read-only."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "proof": {"description": "An inclusion-proof object (leaf_data, leaf_index, "
                                         "tree_size, root_hash, proof[], optional checkpoint)."},
                "pinned_public_key": {"type": "string"},
            },
            "required": ["proof"],
        },
    },
]

HANDLERS = {
    "verify_swap_receipt": verify_swap_receipt,
    "verify_checkpoint": verify_checkpoint,
    "verify_inclusion": verify_inclusion,
}


# ── JSON-RPC plumbing ────────────────────────────────────────────────────────────

def _result(mid, result):
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def _error(mid, code, message):
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}}


def _text(mid, payload, is_error=False):
    return _result(mid, {"content": [{"type": "text",
                                      "text": json.dumps(payload, indent=2, default=str)}],
                         "isError": is_error})


def dispatch(msg: dict) -> dict | None:
    method = msg.get("method")
    mid = msg.get("id")
    if method == "initialize":
        return _result(mid, {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            "instructions": (
                "Read-only verification of the Umbra Proof Layer. verify_swap_receipt, "
                "verify_checkpoint, and verify_inclusion check the bridge's signed, "
                "transparency-logged accountability artifacts (Ed25519 + RFC-6962 "
                "Merkle) so you can trust a receipt or proof you were handed. Never "
                "moves funds or touches the bridge. Gate on the `valid` field; pass "
                "pinned_public_key to require a known operator signer."),
        })
    if method in ("notifications/initialized", "notifications/cancelled"):
        return None
    if method == "tools/list":
        return _result(mid, {"tools": TOOLS})
    if method == "tools/call":
        params = msg.get("params") or {}
        handler = HANDLERS.get(params.get("name"))
        if handler is None:
            return _error(mid, -32601, f"unknown tool {params.get('name')!r}")
        try:
            return _text(mid, handler(params.get("arguments") or {}))
        except KeyError as exc:
            return _text(mid, {"error": f"missing required argument: {exc}"}, is_error=True)
        except Exception as exc:  # noqa: BLE001 — report, never crash
            return _text(mid, {"error": f"{type(exc).__name__}: {exc}"}, is_error=True)
    if mid is not None:
        return _error(mid, -32601, f"unknown method {method!r}")
    return None


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        resp = dispatch(msg)
        if resp is not None:
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
