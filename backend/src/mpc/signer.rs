use anyhow::{anyhow, Result};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

/// An individual MPC signer that holds a key share and produces partial
/// signatures for transaction data.
pub struct MpcSigner {
    signer_id: String,
    key_share: Option<Vec<u8>>,
    /// Hashes of transaction data that have already been signed (anti-replay).
    signed_hashes: HashSet<String>,
}

impl MpcSigner {
    /// Create a new signer without a key share.
    /// Call [`set_key_share`] after the key ceremony completes.
    pub fn new(signer_id: impl Into<String>) -> Self {
        Self {
            signer_id: signer_id.into(),
            key_share: None,
            signed_hashes: HashSet::new(),
        }
    }

    /// Store the key share received from the DKG / key ceremony.
    pub fn set_key_share(&mut self, share: Vec<u8>) {
        self.key_share = Some(share);
    }

    /// The signer's identifier.
    pub fn id(&self) -> &str {
        &self.signer_id
    }

    /// Produce a partial signature over `tx_data`.
    ///
    /// In a real FROST deployment this would use the key share to compute
    /// a proper signature share via `frost_secp256k1::round2::sign`.
    /// Here we provide a deterministic HMAC-like construction as a placeholder
    /// so the coordinator can combine shares.
    ///
    /// # Errors
    /// - If no key share has been set.
    /// - If this exact `tx_data` has already been signed (anti-replay).
    pub fn sign(&mut self, tx_data: &[u8]) -> Result<Vec<u8>> {
        let key_share = self
            .key_share
            .as_ref()
            .ok_or_else(|| anyhow!("Signer `{}` has no key share", self.signer_id))?;

        // Anti-replay: hash the tx data and check if we've already signed it.
        let tx_hash = hex::encode(Sha256::digest(tx_data));
        if self.signed_hashes.contains(&tx_hash) {
            return Err(anyhow!(
                "Signer `{}` already signed tx_data with hash {tx_hash} (replay detected)",
                self.signer_id
            ));
        }

        // Produce partial signature: HMAC-like construction.
        // partial_sig = SHA256( key_share || signer_id || tx_data )
        let mut hasher = Sha256::new();
        hasher.update(key_share);
        hasher.update(self.signer_id.as_bytes());
        hasher.update(tx_data);
        let partial_sig = hasher.finalize().to_vec();

        // Record that we signed this data.
        self.signed_hashes.insert(tx_hash);

        tracing::debug!(
            signer_id = %self.signer_id,
            "Produced partial signature"
        );

        Ok(partial_sig)
    }

    /// Check whether this signer has a key share loaded.
    pub fn has_key_share(&self) -> bool {
        self.key_share.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_signer_lifecycle() {
        let mut signer = MpcSigner::new("signer-1");
        assert!(!signer.has_key_share());

        // Signing without a key share should fail.
        assert!(signer.sign(b"data").is_err());

        // Set key share.
        signer.set_key_share(vec![0xDE, 0xAD, 0xBE, 0xEF]);
        assert!(signer.has_key_share());

        // First sign should succeed.
        let sig = signer.sign(b"withdraw 1 XMR").unwrap();
        assert!(!sig.is_empty());

        // Replay should fail.
        assert!(signer.sign(b"withdraw 1 XMR").is_err());

        // Different data should succeed.
        assert!(signer.sign(b"withdraw 2 XMR").is_ok());
    }

    #[test]
    fn test_deterministic_signatures() {
        let mut s1 = MpcSigner::new("s1");
        let mut s2 = MpcSigner::new("s1");
        let share = vec![1, 2, 3];
        s1.set_key_share(share.clone());
        s2.set_key_share(share);

        let data = b"same data";
        let sig1 = s1.sign(data).unwrap();
        let sig2 = s2.sign(data).unwrap();
        assert_eq!(sig1, sig2, "Same key share + signer_id + data => same partial sig");
    }
}
