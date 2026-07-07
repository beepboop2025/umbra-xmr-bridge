//! Signed swap receipts ("attestations").
//!
//! Every order lifecycle event produces an Ed25519-signed receipt that anyone
//! can verify offline against the bridge's published public key — no trust in
//! the API, the website, or TLS required. Receipts for one order are chained
//! together (each embeds the SHA-256 of the previous receipt's payload), so a
//! user holding the final receipt can detect any retroactive edit to their
//! order's history.
//!
//! # Canonical form
//!
//! The signature covers the *canonical JSON* encoding of the payload:
//! UTF-8, no insignificant whitespace, object keys sorted lexicographically.
//! `serde_json::Value` serialization already satisfies this (its map is a
//! `BTreeMap`), and every verifier we ship (browser, offline HTML, Python CLI)
//! re-canonicalizes the same way before checking the signature.
//!
//! # Post-quantum hybrid
//!
//! Every artifact is additionally signed with **ML-DSA-65** (FIPS 204,
//! CRYSTALS-Dilithium) over the *same canonical bytes*. Receipts are archival
//! evidence with a multi-decade shelf life; a future quantum adversary who
//! breaks Ed25519 could otherwise forge "historical" receipts and rewrite the
//! bridge's past. The two signatures are independent — verifiers check
//! Ed25519 today (cheap, universal) while the ML-DSA signature keeps the
//! archive sound in a post-quantum world. Forging a receipt requires breaking
//! BOTH schemes.

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use fips204::ml_dsa_65;
use fips204::traits::{KeyGen, SerDes, Signer as PqSigner, Verifier as PqVerifier};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};
use crate::models::order::BridgeOrder;

pub const RECEIPT_VERSION: &str = "1";
const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// Post-quantum (ML-DSA-65) signing identity.
struct PqIdentity {
    signing_key: ml_dsa_65::PrivateKey,
    public_key_hex: String,
    key_id: String,
}

/// Holds the bridge's attestation identity. Constructed once at startup.
pub struct AttestationService {
    signing_key: SigningKey,
    verifying_key: VerifyingKey,
    key_id: String,
    pq: Option<PqIdentity>,
}

fn derive_seed(explicit_hex: Option<&str>, domain: &[u8], app_secret: &str, var: &str) -> anyhow::Result<[u8; 32]> {
    match explicit_hex {
        Some(hex_seed) => {
            let bytes = hex::decode(hex_seed.trim())
                .map_err(|_| anyhow::anyhow!("{var} must be hex"))?;
            bytes
                .try_into()
                .map_err(|_| anyhow::anyhow!("{var} must be 32 bytes (64 hex chars)"))
        }
        None => {
            let mut h = Sha256::new();
            h.update(domain);
            h.update(app_secret.as_bytes());
            Ok(h.finalize().into())
        }
    }
}

impl AttestationService {
    /// Build from a 32-byte hex seed. If `seed_hex` is `None`, the key is
    /// derived deterministically from the app secret so restarts keep the
    /// same identity: seed = SHA-256("umbra/attestation/v1:" || SECRET_KEY).
    pub fn new(seed_hex: Option<&str>, app_secret: &str) -> anyhow::Result<Self> {
        Self::with_pq(seed_hex, None, app_secret, true)
    }

    /// Full constructor. `pq_seed_hex` seeds the ML-DSA-65 keypair (derived
    /// from the app secret when absent); `pq_enabled = false` skips the
    /// post-quantum layer entirely.
    pub fn with_pq(
        seed_hex: Option<&str>,
        pq_seed_hex: Option<&str>,
        app_secret: &str,
        pq_enabled: bool,
    ) -> anyhow::Result<Self> {
        let seed = derive_seed(
            seed_hex,
            b"umbra/attestation/v1:",
            app_secret,
            "ATTESTATION_SECRET_KEY",
        )?;

        let signing_key = SigningKey::from_bytes(&seed);
        let verifying_key = signing_key.verifying_key();
        let key_id = derive_key_id(&verifying_key);

        let pq = if pq_enabled {
            use rand::SeedableRng;
            let pq_seed = derive_seed(
                pq_seed_hex,
                b"umbra/attestation-pq/v1:",
                app_secret,
                "ATTESTATION_PQ_SEED",
            )?;
            // Deterministic keygen: the seed fully determines the keypair via
            // a seeded CSPRNG, so restarts keep the same PQ identity.
            let mut rng = rand::rngs::StdRng::from_seed(pq_seed);
            let (pq_pk, pq_sk) = ml_dsa_65::KG::try_keygen_with_rng(&mut rng)
                .map_err(|e| anyhow::anyhow!("ML-DSA keygen failed: {e}"))?;
            let pk_bytes = pq_pk.into_bytes();
            let public_key_hex = hex::encode(pk_bytes);
            let key_id = hex::encode(&Sha256::digest(pk_bytes)[..8]);
            Some(PqIdentity {
                signing_key: pq_sk,
                public_key_hex,
                key_id,
            })
        } else {
            None
        };

        Ok(Self {
            signing_key,
            verifying_key,
            key_id,
            pq,
        })
    }

    pub fn public_key_hex(&self) -> String {
        hex::encode(self.verifying_key.as_bytes())
    }

    pub fn key_id(&self) -> &str {
        &self.key_id
    }

    /// Sign arbitrary canonical bytes; returns hex signature.
    pub fn sign(&self, message: &[u8]) -> String {
        hex::encode(self.signing_key.sign(message).to_bytes())
    }

    /// Verify a hex signature over `message` against this service's key.
    pub fn verify(&self, message: &[u8], signature_hex: &str) -> bool {
        let Ok(sig_bytes) = hex::decode(signature_hex) else {
            return false;
        };
        let sig_array: [u8; 64] = match sig_bytes.try_into() {
            Ok(a) => a,
            Err(_) => return false,
        };
        let sig = Signature::from_bytes(&sig_array);
        self.verifying_key.verify(message, &sig).is_ok()
    }

    /// Sign a JSON value in canonical form. Returns (canonical_bytes_hash_hex, signature_hex).
    pub fn sign_json(&self, payload: &serde_json::Value) -> (String, String) {
        let canonical = canonical_json(payload);
        let hash = hex::encode(Sha256::digest(canonical.as_bytes()));
        let signature = self.sign(canonical.as_bytes());
        (hash, signature)
    }

    // -- Post-quantum layer ------------------------------------------------

    pub fn pq_enabled(&self) -> bool {
        self.pq.is_some()
    }

    pub fn pq_public_key_hex(&self) -> Option<&str> {
        self.pq.as_ref().map(|p| p.public_key_hex.as_str())
    }

    pub fn pq_key_id(&self) -> Option<&str> {
        self.pq.as_ref().map(|p| p.key_id.as_str())
    }

    /// ML-DSA-65 signature over `message` (hex, 6618 chars). Returns None
    /// when the PQ layer is disabled.
    pub fn sign_pq(&self, message: &[u8]) -> Option<String> {
        let pq = self.pq.as_ref()?;
        match pq.signing_key.try_sign(message, PQ_CONTEXT) {
            Ok(sig) => Some(hex::encode(sig)),
            Err(e) => {
                tracing::error!(error = %e, "attestation: ML-DSA signing failed");
                None
            }
        }
    }

    /// Verify an ML-DSA-65 hex signature against an arbitrary hex public key.
    pub fn verify_pq(public_key_hex: &str, message: &[u8], signature_hex: &str) -> bool {
        let Ok(pk_bytes) = hex::decode(public_key_hex) else {
            return false;
        };
        let pk_array: [u8; ml_dsa_65::PK_LEN] = match pk_bytes.try_into() {
            Ok(a) => a,
            Err(_) => return false,
        };
        let Ok(pk) = ml_dsa_65::PublicKey::try_from_bytes(pk_array) else {
            return false;
        };
        let Ok(sig_bytes) = hex::decode(signature_hex) else {
            return false;
        };
        let sig: [u8; ml_dsa_65::SIG_LEN] = match sig_bytes.try_into() {
            Ok(a) => a,
            Err(_) => return false,
        };
        pk.verify(message, &sig, PQ_CONTEXT)
    }
}

/// FIPS 204 context string: domain-separates Umbra signatures from any other
/// use of the same key.
const PQ_CONTEXT: &[u8] = b"umbra-proof-v1";

/// `key_id` is the first 8 bytes (16 hex chars) of SHA-256(public_key),
/// letting verifiers detect key rotation at a glance.
fn derive_key_id(vk: &VerifyingKey) -> String {
    let digest = Sha256::digest(vk.as_bytes());
    hex::encode(&digest[..8])
}

/// Canonical JSON: compact separators, keys sorted lexicographically.
/// `serde_json::Value` uses a BTreeMap internally, so `to_string` already
/// emits sorted keys with no whitespace — this wrapper exists to make that
/// contract explicit at every call site.
pub fn canonical_json(value: &serde_json::Value) -> String {
    value.to_string()
}

/// A stored attestation row.
#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub struct Attestation {
    pub id: i64,
    pub order_id: String,
    pub sequence: i32,
    pub event: String,
    pub payload: serde_json::Value,
    pub payload_hash: String,
    pub prev_receipt_hash: String,
    pub signature: String,
    pub public_key: String,
    pub key_id: String,
    pub signature_pq: Option<String>,
    pub pq_public_key: Option<String>,
    pub pq_key_id: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Create and persist a signed receipt for an order lifecycle event.
///
/// The receipt intentionally contains the SHA-256 of the destination address
/// rather than the address itself: receipts are fetchable by order id, and a
/// privacy bridge should not turn its proof layer into a metadata leak. The
/// user, who knows their own address, can still verify the binding.
pub async fn attest(
    db: &crate::db::Pool,
    service: &AttestationService,
    order: &BridgeOrder,
    event: &str,
) -> AppResult<Attestation> {
    #[derive(sqlx::FromRow)]
    struct PrevRow {
        sequence: i32,
        payload_hash: String,
    }

    let prev = sqlx::query_as::<_, PrevRow>(
        "SELECT sequence, payload_hash FROM order_attestations \
         WHERE order_id = $1 ORDER BY sequence DESC LIMIT 1",
    )
    .bind(&order.order_id)
    .fetch_optional(db)
    .await?;

    let (sequence, prev_receipt_hash) = match prev {
        Some(p) => (p.sequence + 1, p.payload_hash),
        None => (0, GENESIS_HASH.to_string()),
    };

    let dest_address_sha256 = hex::encode(Sha256::digest(order.dest_address.as_bytes()));
    let timestamp = chrono::Utc::now();

    let payload = serde_json::json!({
        "version": RECEIPT_VERSION,
        "key_id": service.key_id(),
        "order_id": order.order_id,
        "sequence": sequence,
        "event": event,
        "direction": order.direction,
        "source_chain": order.source_chain,
        "dest_chain": order.dest_chain,
        "from_amount": order.from_amount.to_string(),
        "from_currency": order.from_currency,
        "to_amount": order.to_amount.to_string(),
        "to_currency": order.to_currency,
        "rate": order.rate_at_creation.to_string(),
        "fee": order.fee.to_string(),
        "fee_percent": order.fee_percent.to_string(),
        "dest_address_sha256": dest_address_sha256,
        "deposit_tx_hash": order.deposit_tx_hash,
        "withdrawal_tx_hash": order.withdrawal_tx_hash,
        "prev_receipt_hash": prev_receipt_hash,
        "timestamp": timestamp.to_rfc3339_opts(chrono::SecondsFormat::Micros, true),
    });

    let (payload_hash, signature) = service.sign_json(&payload);
    let canonical = canonical_json(&payload);
    let signature_pq = service.sign_pq(canonical.as_bytes());

    let row = sqlx::query_as::<_, Attestation>(
        r#"
        INSERT INTO order_attestations
            (order_id, sequence, event, payload, payload_hash,
             prev_receipt_hash, signature, public_key, key_id,
             signature_pq, pq_public_key, pq_key_id, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
        "#,
    )
    .bind(&order.order_id)
    .bind(sequence)
    .bind(event)
    .bind(&payload)
    .bind(&payload_hash)
    .bind(payload["prev_receipt_hash"].as_str().unwrap_or(GENESIS_HASH))
    .bind(&signature)
    .bind(service.public_key_hex())
    .bind(service.key_id())
    .bind(&signature_pq)
    .bind(service.pq_public_key_hex())
    .bind(service.pq_key_id())
    .bind(timestamp)
    .fetch_one(db)
    .await?;

    metrics::counter!("attestations_issued_total", "event" => event.to_string()).increment(1);
    Ok(row)
}

/// Best-effort attestation: a receipt failure must never block a swap, but it
/// must never be silent either.
pub async fn attest_or_warn(
    db: &crate::db::Pool,
    service: &AttestationService,
    order: &BridgeOrder,
    event: &str,
) {
    if let Err(e) = attest(db, service, order, event).await {
        tracing::error!(order_id = %order.order_id, event = %event, error = %e,
            "attestation: failed to issue signed receipt");
        metrics::counter!("attestations_failed_total").increment(1);
    }
}

/// Fetch all receipts for an order, oldest first.
pub async fn receipts_for_order(
    db: &crate::db::Pool,
    order_id: &str,
) -> AppResult<Vec<Attestation>> {
    let rows = sqlx::query_as::<_, Attestation>(
        "SELECT * FROM order_attestations WHERE order_id = $1 ORDER BY sequence ASC",
    )
    .bind(order_id)
    .fetch_all(db)
    .await?;

    if rows.is_empty() {
        return Err(AppError::NotFound(format!(
            "No receipts found for order {order_id}"
        )));
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> AttestationService {
        AttestationService::new(None, "test-secret-key-at-least-32-chars!!").unwrap()
    }

    #[test]
    fn key_derivation_is_deterministic() {
        let a = service();
        let b = service();
        assert_eq!(a.public_key_hex(), b.public_key_hex());
        assert_eq!(a.key_id(), b.key_id());
        assert_eq!(a.key_id().len(), 16);
    }

    #[test]
    fn explicit_seed_beats_derivation() {
        let seed = "11".repeat(32);
        let a = AttestationService::new(Some(&seed), "secret").unwrap();
        let b = AttestationService::new(None, "secret").unwrap();
        assert_ne!(a.public_key_hex(), b.public_key_hex());
    }

    #[test]
    fn rejects_malformed_seed() {
        assert!(AttestationService::new(Some("nothex"), "s").is_err());
        assert!(AttestationService::new(Some("abcd"), "s").is_err()); // too short
    }

    #[test]
    fn sign_verify_round_trip() {
        let svc = service();
        let msg = b"the shadow proves the light";
        let sig = svc.sign(msg);
        assert!(svc.verify(msg, &sig));
        assert!(!svc.verify(b"tampered", &sig));
        assert!(!svc.verify(msg, "deadbeef"));
    }

    #[test]
    fn canonical_json_sorts_keys_and_strips_whitespace() {
        let v = serde_json::json!({"zebra": 1, "alpha": {"nested_z": true, "nested_a": null}});
        assert_eq!(
            canonical_json(&v),
            r#"{"alpha":{"nested_a":null,"nested_z":true},"zebra":1}"#
        );
    }

    /// Cross-implementation vector: signature computed independently with
    /// Python (`cryptography` Ed25519 + `json.dumps(sort_keys=True,
    /// separators=(',',':'))`) over the same seed and payload. Guarantees
    /// receipts stay verifiable by third-party implementations.
    #[test]
    fn matches_independent_python_implementation() {
        let seed = "42".repeat(32);
        let svc = AttestationService::new(Some(&seed), "unused").unwrap();
        assert_eq!(
            svc.public_key_hex(),
            "2152f8d19b791d24453242e15f2eab6cb7cffa7b6a5ed30097960e069881db12"
        );
        assert_eq!(svc.key_id(), "3097e2dee2cb4a34");

        let payload = serde_json::json!({"b":"2","a":"1","nested":{"z":true,"y":null}});
        let canonical = canonical_json(&payload);
        assert_eq!(canonical, r#"{"a":"1","b":"2","nested":{"y":null,"z":true}}"#);

        let expected_sig = "84e4e388944ebe54ebaf402847f4a77143dcc314782f9c3b7bd4398065e0f7b4\
                            5f5ba8140d119bc64780b928c7f9780c6a8cbd3f44c046ef8afd71f4b812250f"
            .replace(char::is_whitespace, "");
        assert_eq!(svc.sign(canonical.as_bytes()), expected_sig);
    }

    #[test]
    fn pq_hybrid_sign_verify_round_trip() {
        let svc = service();
        assert!(svc.pq_enabled());
        let pk = svc.pq_public_key_hex().unwrap().to_string();
        assert_eq!(pk.len(), ml_dsa_65::PK_LEN * 2);
        assert_eq!(svc.pq_key_id().unwrap().len(), 16);

        let msg = b"archival evidence outlives the curve";
        let sig = svc.sign_pq(msg).unwrap();
        assert_eq!(sig.len(), ml_dsa_65::SIG_LEN * 2);
        assert!(AttestationService::verify_pq(&pk, msg, &sig));
        assert!(!AttestationService::verify_pq(&pk, b"tampered", &sig));
        assert!(!AttestationService::verify_pq(&pk, msg, &sig.replacen('0', "1", 4)));
        assert!(!AttestationService::verify_pq("deadbeef", msg, &sig));
    }

    #[test]
    fn pq_keygen_is_deterministic_and_independent_of_ed25519() {
        let a = service();
        let b = service();
        assert_eq!(a.pq_public_key_hex(), b.pq_public_key_hex());
        // Distinct explicit seeds produce distinct PQ identities.
        let c = AttestationService::with_pq(None, Some(&"33".repeat(32)), "test-secret-key-at-least-32-chars!!", true).unwrap();
        assert_ne!(a.pq_public_key_hex(), c.pq_public_key_hex());
        // ...without touching the Ed25519 identity.
        assert_eq!(a.public_key_hex(), c.public_key_hex());
    }

    #[test]
    fn pq_can_be_disabled() {
        let svc = AttestationService::with_pq(None, None, "some-secret", false).unwrap();
        assert!(!svc.pq_enabled());
        assert!(svc.sign_pq(b"x").is_none());
        assert!(svc.pq_public_key_hex().is_none());
    }

    #[test]
    fn sign_json_binds_to_canonical_form() {
        let svc = service();
        // Two structurally identical values must produce identical signatures
        // regardless of construction order.
        let v1 = serde_json::json!({"b": "2", "a": "1"});
        let v2 = serde_json::json!({"a": "1", "b": "2"});
        let (h1, s1) = svc.sign_json(&v1);
        let (h2, _s2) = svc.sign_json(&v2);
        assert_eq!(h1, h2);
        assert!(svc.verify(canonical_json(&v2).as_bytes(), &s1));
    }
}
