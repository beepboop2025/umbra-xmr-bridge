-- XMR Multi-Chain Bridge Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Order status enum
CREATE TYPE order_status AS ENUM (
    'created',
    'awaiting_deposit',
    'deposit_detected',
    'confirming',
    'bridging',
    'signing',
    'sending',
    'completed',
    'failed',
    'refunding',
    'refunded',
    'expired'
);

-- Bridge orders
CREATE TABLE bridge_orders (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id        VARCHAR(32) NOT NULL UNIQUE,
    direction       VARCHAR(16) NOT NULL,          -- 'xmr_to_btc', 'eth_to_xmr', etc.
    source_chain    VARCHAR(8) NOT NULL,
    dest_chain      VARCHAR(8) NOT NULL,
    from_amount     NUMERIC(28, 12) NOT NULL,
    from_currency   VARCHAR(8) NOT NULL,
    to_amount       NUMERIC(28, 12) NOT NULL,
    to_currency     VARCHAR(8) NOT NULL,
    dest_address    TEXT NOT NULL,
    deposit_address TEXT,
    rate_at_creation NUMERIC(28, 12) NOT NULL,
    fee             NUMERIC(28, 12) NOT NULL DEFAULT 0,
    fee_percent     NUMERIC(6, 4) NOT NULL DEFAULT 0.3,
    min_received    NUMERIC(28, 12),
    slippage        NUMERIC(6, 4) NOT NULL DEFAULT 0.5,
    status          order_status NOT NULL DEFAULT 'created',
    step            SMALLINT NOT NULL DEFAULT 0,
    deposit_tx_hash     TEXT,
    withdrawal_tx_hash  TEXT,
    confirmations_current  INTEGER NOT NULL DEFAULT 0,
    confirmations_required INTEGER NOT NULL DEFAULT 10,
    telegram_user_id BIGINT,
    ip_address       INET,
    error_message    TEXT,
    metadata         JSONB DEFAULT '{}',
    expires_at       TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_status ON bridge_orders(status);
CREATE INDEX idx_orders_telegram_user ON bridge_orders(telegram_user_id);
CREATE INDEX idx_orders_order_id ON bridge_orders(order_id);
CREATE INDEX idx_orders_created_at ON bridge_orders(created_at DESC);
CREATE INDEX idx_orders_expires_at ON bridge_orders(expires_at) WHERE status = 'awaiting_deposit';
CREATE INDEX idx_orders_deposit_address ON bridge_orders(deposit_address) WHERE deposit_address IS NOT NULL;

-- Exchange rates
CREATE TABLE exchange_rates (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    direction   VARCHAR(16) NOT NULL,
    rate        NUMERIC(28, 12) NOT NULL,
    source      VARCHAR(32) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rates_direction ON exchange_rates(direction, created_at DESC);

-- Audit log (hash-chain)
CREATE TABLE audit_log (
    id            BIGSERIAL PRIMARY KEY,
    action        VARCHAR(64) NOT NULL,
    entity_type   VARCHAR(32) NOT NULL,
    entity_id     VARCHAR(64),
    details       JSONB DEFAULT '{}',
    actor         VARCHAR(64) NOT NULL DEFAULT 'system',
    ip_address    INET,
    prev_hash     VARCHAR(64) NOT NULL,
    content_hash  VARCHAR(64) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_created_at ON audit_log(created_at DESC);

-- Admin users
CREATE TABLE admin_users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username      VARCHAR(64) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          VARCHAR(16) NOT NULL DEFAULT 'admin',
    is_active     BOOLEAN NOT NULL DEFAULT true,
    last_login    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- MPC key ceremonies
CREATE TABLE mpc_key_ceremonies (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain             VARCHAR(8) NOT NULL,
    threshold         SMALLINT NOT NULL,
    total_signers     SMALLINT NOT NULL,
    group_public_key  TEXT,
    status            VARCHAR(16) NOT NULL DEFAULT 'pending',
    metadata          JSONB DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at      TIMESTAMPTZ
);

-- MPC signature requests
CREATE TABLE mpc_signature_requests (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id          UUID NOT NULL REFERENCES bridge_orders(id),
    chain             VARCHAR(8) NOT NULL,
    tx_data_hash      VARCHAR(64) NOT NULL,
    shares_received   SMALLINT NOT NULL DEFAULT 0,
    shares_required   SMALLINT NOT NULL DEFAULT 2,
    status            VARCHAR(16) NOT NULL DEFAULT 'pending',
    final_signature   TEXT,
    metadata          JSONB DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_mpc_sig_order ON mpc_signature_requests(order_id);
CREATE INDEX idx_mpc_sig_status ON mpc_signature_requests(status);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_bridge_orders_updated_at
    BEFORE UPDATE ON bridge_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_admin_users_updated_at
    BEFORE UPDATE ON admin_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
