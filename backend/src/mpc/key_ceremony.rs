//! Distributed Key Generation (DKG) ceremony using FROST-secp256k1.
//!
//! Wraps [`frost_bridge::generate_keys`] and exposes a higher-level
//! [`KeyCeremonyResult`] that includes the hex-encoded group public key
//! for easy storage / transmission.

use anyhow::Result;
use frost_secp256k1 as frost;
use frost::keys::{KeyPackage, PublicKeyPackage};
use frost::Identifier;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::frost_bridge;

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/// Output of a successful key ceremony.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyCeremonyResult {
    /// Per-signer key packages (serialised as hex for transport).
    /// Key: signer index (1-based), Value: serialized `KeyPackage` bytes.
    pub key_packages: HashMap<u16, Vec<u8>>,
    /// The FROST public key package (serialised for storage).
    pub public_key_package: Vec<u8>,
    /// Hex-encoded group verifying (public) key for convenient display.
    pub group_public_key_hex: String,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Run a full trusted-dealer key generation ceremony.
///
/// * `threshold` — the *t* in a *t-of-n* scheme.
/// * `total`     — total number of signers (*n*).
///
/// Returns a [`KeyCeremonyResult`] containing serialised key material.
pub fn generate_shares(threshold: u32, total: u32) -> Result<KeyCeremonyResult> {
    let threshold_u16 = threshold as u16;
    let total_u16 = total as u16;

    let (key_packages, pubkey_package) =
        frost_bridge::generate_keys(threshold_u16, total_u16)?;

    // Serialize key packages for transport / storage.
    let serialized_packages = serialize_key_packages(&key_packages)?;

    // Serialize the public key package.
    let pubkey_bytes = serialize_public_key_package(&pubkey_package)?;

    // Extract the group verifying key as hex.
    let verifying_key = pubkey_package.verifying_key();
    let vk_bytes = verifying_key.serialize();
    let group_public_key_hex = hex::encode(vk_bytes);

    tracing::debug!(
        threshold = threshold,
        total = total,
        group_pubkey = %group_public_key_hex,
        "Key ceremony complete"
    );

    Ok(KeyCeremonyResult {
        key_packages: serialized_packages,
        public_key_package: pubkey_bytes,
        group_public_key_hex,
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Serialize FROST `KeyPackage`s into a transport-friendly format.
///
/// Uses `postcard` (serde) serialization via the FROST crate's own
/// serde support. Since `KeyPackage` implements `Serialize`, we serialise
/// each one to JSON bytes.
fn serialize_key_packages(
    packages: &HashMap<Identifier, KeyPackage>,
) -> Result<HashMap<u16, Vec<u8>>> {
    let mut out = HashMap::new();
    for (id, kp) in packages {
        let id_bytes = id.serialize();
        // Identifier serializes to a fixed-size array; use the last two bytes
        // as a u16 index (FROST identifiers are 1-based scalars).
        let idx = u16::from_be_bytes([
            id_bytes[id_bytes.len() - 2],
            id_bytes[id_bytes.len() - 1],
        ]);
        let serialized = serde_json::to_vec(kp)
            .map_err(|e| anyhow::anyhow!("Failed to serialize KeyPackage: {e}"))?;
        out.insert(idx, serialized);
    }
    Ok(out)
}

/// Serialize the `PublicKeyPackage` to bytes for storage.
fn serialize_public_key_package(pkg: &PublicKeyPackage) -> Result<Vec<u8>> {
    serde_json::to_vec(pkg)
        .map_err(|e| anyhow::anyhow!("Failed to serialize PublicKeyPackage: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_ceremony() {
        let result = generate_shares(2, 3).expect("key ceremony failed");
        assert_eq!(result.key_packages.len(), 3);
        assert!(!result.public_key_package.is_empty());
        assert!(!result.group_public_key_hex.is_empty());
        // Group public key should be a valid hex string.
        hex::decode(&result.group_public_key_hex).expect("invalid hex");
    }
}
