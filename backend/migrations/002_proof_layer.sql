-- Umbra Proof Layer: signed receipts, transparency checkpoints, sentinel events.

-- Signed swap receipts (attestations). One row per order lifecycle event.
-- Each receipt is chained to the previous receipt for the same order via
-- prev_receipt_hash, so the full per-order history is tamper-evident on its own.
CREATE TABLE order_attestations (
    id                BIGSERIAL PRIMARY KEY,
    order_id          VARCHAR(64) NOT NULL,
    sequence          INTEGER NOT NULL,
    event             VARCHAR(32) NOT NULL,
    payload           JSONB NOT NULL,
    payload_hash      VARCHAR(64) NOT NULL,
    prev_receipt_hash VARCHAR(64) NOT NULL,
    signature         VARCHAR(128) NOT NULL,
    public_key        VARCHAR(64) NOT NULL,
    key_id            VARCHAR(16) NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id, sequence)
);

CREATE INDEX idx_attestations_order ON order_attestations(order_id, sequence);

-- Transparency log checkpoints (signed Merkle tree heads over audit_log).
-- Append-only; each checkpoint commits to the entire audit history up to
-- tree_size entries, RFC 6962 construction over audit_log.content_hash.
CREATE TABLE transparency_checkpoints (
    id             BIGSERIAL PRIMARY KEY,
    tree_size      BIGINT NOT NULL,
    root_hash      VARCHAR(64) NOT NULL,
    prev_root_hash VARCHAR(64) NOT NULL,
    signature      VARCHAR(128) NOT NULL,
    public_key     VARCHAR(64) NOT NULL,
    key_id         VARCHAR(16) NOT NULL,
    sealed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tree_size)
);

CREATE INDEX idx_checkpoints_sealed_at ON transparency_checkpoints(sealed_at DESC);

-- Sentinel (circuit breaker) events: every trip, manual pause, and resume.
CREATE TABLE sentinel_events (
    id          BIGSERIAL PRIMARY KEY,
    kind        VARCHAR(16) NOT NULL,        -- 'tripped' | 'paused' | 'resumed'
    check_name  VARCHAR(48) NOT NULL,        -- which guard fired (or 'manual')
    reason      TEXT NOT NULL,
    details     JSONB NOT NULL DEFAULT '{}',
    actor       VARCHAR(64) NOT NULL DEFAULT 'sentinel',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sentinel_events_created_at ON sentinel_events(created_at DESC);
