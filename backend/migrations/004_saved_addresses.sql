-- Saved destination addresses, scoped to an anonymous per-browser client id
-- (no accounts on a no-KYC bridge). See src/routes/wallet.rs.
CREATE TABLE IF NOT EXISTS saved_addresses (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id  VARCHAR(128) NOT NULL,
    chain      VARCHAR(16)  NOT NULL,
    address    TEXT         NOT NULL,
    label      VARCHAR(64)  NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_addresses_client
    ON saved_addresses (client_id, created_at DESC);
