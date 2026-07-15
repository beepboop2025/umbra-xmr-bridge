"""Umbra Proof-Layer MCP server. The verifier is zero-dependency and only
VERIFIES, so the tests mint valid artifacts with cryptography's Ed25519
(dev-only) and assert: a genuine receipt/checkpoint/inclusion verifies, any
tamper flips valid to False, a pinned-key mismatch fails, and malformed input
is reported not crashed."""
import hashlib
import json
import os
import sys

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mcp_server as mcp  # noqa: E402
import verify_receipt as vr  # noqa: E402


@pytest.fixture()
def key():
    sk = Ed25519PrivateKey.generate()
    pub = sk.public_key().public_bytes_raw().hex()
    return sk, pub


def _sign(sk, payload: dict) -> dict:
    canonical = vr.canonical_json(payload)
    return {
        "payload": payload,
        "payload_hash": hashlib.sha256(canonical.encode()).hexdigest(),
        "signature": sk.sign(canonical.encode()).hex(),
        "public_key": sk.public_key().public_bytes_raw().hex(),
    }


def _call(name, arguments):
    resp = mcp.dispatch({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                         "params": {"name": name, "arguments": arguments}})
    return json.loads(resp["result"]["content"][0]["text"]), resp["result"].get("isError", False)


# ── protocol surface ────────────────────────────────────────────────────────────

def test_tools_list():
    r = mcp.dispatch({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert {t["name"] for t in r["result"]["tools"]} == {
        "verify_swap_receipt", "verify_checkpoint", "verify_inclusion"}


def test_initialize_is_read_only_framed():
    r = mcp.dispatch({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
    assert "Read-only" in r["result"]["instructions"]
    assert "Never moves funds" in r["result"]["instructions"]


# ── swap receipt ────────────────────────────────────────────────────────────────

def test_genuine_receipt_verifies(key):
    sk, pub = key
    payload = {"sequence": 0, "event": "completed", "timestamp": "2026-07-15T00:00:00Z",
               "prev_receipt_hash": "0" * 64, "order_id": "br_abc"}
    out, _ = _call("verify_swap_receipt", {"receipt": _sign(sk, payload)})
    assert out["valid"] is True
    assert all(c["ok"] for c in out["checks"])


def test_tampered_payload_fails(key):
    sk, _ = key
    payload = {"sequence": 0, "event": "completed", "timestamp": "t", "prev_receipt_hash": "0" * 64}
    r = _sign(sk, payload)
    r["payload"]["event"] = "refunded"  # tamper after signing
    out, _ = _call("verify_swap_receipt", {"receipt": r})
    assert out["valid"] is False


def test_pinned_key_mismatch_fails(key):
    sk, _ = key
    payload = {"sequence": 0, "event": "completed", "timestamp": "t", "prev_receipt_hash": "0" * 64}
    out, _ = _call("verify_swap_receipt",
                   {"receipt": _sign(sk, payload), "pinned_public_key": "ab" * 32})
    assert out["valid"] is False
    assert any("pinned key" in c["note"] and not c["ok"] for c in out["checks"])


def test_receipt_chain_linkage(key):
    sk, _ = key
    p0 = {"sequence": 0, "event": "created", "timestamp": "t0", "prev_receipt_hash": "0" * 64}
    r0 = _sign(sk, p0)
    h0 = hashlib.sha256(vr.canonical_json(p0).encode()).hexdigest()
    p1 = {"sequence": 1, "event": "completed", "timestamp": "t1", "prev_receipt_hash": h0}
    r1 = _sign(sk, p1)
    out, _ = _call("verify_swap_receipt", {"receipt": {"receipts": [r0, r1]}})
    assert out["valid"] is True and out["n_receipts"] == 2


def test_broken_chain_fails(key):
    sk, _ = key
    p0 = {"sequence": 0, "event": "created", "timestamp": "t0", "prev_receipt_hash": "0" * 64}
    p1 = {"sequence": 1, "event": "completed", "timestamp": "t1",
          "prev_receipt_hash": "f" * 64}  # does not link to r0
    out, _ = _call("verify_swap_receipt",
                   {"receipt": {"receipts": [_sign(sk, p0), _sign(sk, p1)]}})
    assert out["valid"] is False


def test_multiple_signers_flagged(key):
    sk, _ = key
    sk2 = Ed25519PrivateKey.generate()
    p = {"sequence": 0, "event": "x", "timestamp": "t", "prev_receipt_hash": "0" * 64}
    out, _ = _call("verify_swap_receipt", {"receipt": {"receipts": [_sign(sk, p), _sign(sk2, p)]}})
    assert out["valid"] is False
    assert any("MULTIPLE" in c["note"] for c in out["checks"])


# ── checkpoint ──────────────────────────────────────────────────────────────────

def test_genuine_checkpoint_verifies(key):
    sk, pub = key
    cp = {"tree_size": 42, "root_hash": "aa" * 32, "prev_root_hash": "bb" * 32,
          "key_id": "k1", "sealed_at": "2026-07-15T00:00:00Z"}
    canonical = vr.canonical_json(vr.tree_head_payload({**cp, "signature": "", "public_key": pub}))
    cp["signature"] = sk.sign(canonical.encode()).hex()
    cp["public_key"] = pub
    out, _ = _call("verify_checkpoint", {"checkpoint": cp})
    assert out["valid"] is True and out["tree_size"] == 42


def test_checkpoint_missing_field():
    out, _ = _call("verify_checkpoint", {"checkpoint": {"tree_size": 1}})
    assert out["valid"] is False and "missing fields" in out["checks"][0]["note"]


# ── inclusion ───────────────────────────────────────────────────────────────────

def test_single_leaf_inclusion_verifies():
    # a one-entry tree: the leaf hash IS the root, empty proof
    leaf_data = "audit-entry-0"
    leaf = vr.merkle_leaf_hash(leaf_data.encode())
    out, _ = _call("verify_inclusion", {"proof": {
        "leaf_data": leaf_data, "leaf_index": 0, "tree_size": 1,
        "root_hash": leaf.hex(), "proof": []}})
    assert out["valid"] is True


def test_inclusion_wrong_root_fails():
    out, _ = _call("verify_inclusion", {"proof": {
        "leaf_data": "x", "leaf_index": 0, "tree_size": 1,
        "root_hash": "00" * 32, "proof": []}})
    assert out["valid"] is False


# ── malformed input is reported, not crashed ────────────────────────────────────

def test_missing_argument_reported():
    out, err = _call("verify_swap_receipt", {})
    assert err and "missing required argument" in out["error"]


def test_unknown_tool_errors():
    r = mcp.dispatch({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                      "params": {"name": "nope", "arguments": {}}})
    assert "error" in r
