-- Post-quantum hybrid signatures (ML-DSA-65 / FIPS 204).
--
-- Receipts and checkpoints gain a second, quantum-resistant signature over
-- the same canonical bytes. Ed25519 remains the online-verifiable layer;
-- the ML-DSA signature keeps the archive forgery-proof against a future
-- quantum adversary ("harvest now, forge later").

ALTER TABLE order_attestations
    ADD COLUMN signature_pq  TEXT,
    ADD COLUMN pq_public_key TEXT,
    ADD COLUMN pq_key_id     VARCHAR(16);

ALTER TABLE transparency_checkpoints
    ADD COLUMN signature_pq  TEXT,
    ADD COLUMN pq_public_key TEXT,
    ADD COLUMN pq_key_id     VARCHAR(16);
