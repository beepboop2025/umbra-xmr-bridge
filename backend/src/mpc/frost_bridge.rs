//! Wrapper around the `frost-secp256k1` crate providing high-level helpers
//! for FROST threshold key generation, signing, and verification.

use anyhow::{anyhow, Result};
use frost_secp256k1 as frost;
use frost::keys::{KeyPackage, PublicKeyPackage};
use frost::{Identifier, Signature, SigningPackage};
use rand::thread_rng;
use std::collections::{BTreeMap, HashMap};

/// Generate FROST key material using a trusted dealer.
///
/// * `threshold` — minimum number of signers required to produce a signature.
/// * `max_signers` — total number of key shares to generate.
///
/// Returns a map from signer `Identifier` to their `KeyPackage`, plus the
/// shared `PublicKeyPackage`.
pub fn generate_keys(
    threshold: u16,
    max_signers: u16,
) -> Result<(HashMap<Identifier, KeyPackage>, PublicKeyPackage)> {
    let mut rng = thread_rng();

    let (shares, pubkey_package) =
        frost::keys::generate_with_dealer(max_signers, threshold, frost::keys::IdentifierList::Default, &mut rng)
            .map_err(|e| anyhow!("FROST key generation failed: {e}"))?;

    // Convert each SecretShare into a KeyPackage for the signer.
    let mut key_packages: HashMap<Identifier, KeyPackage> = HashMap::new();
    for (id, secret_share) in shares {
        let kp = frost::keys::KeyPackage::try_from(secret_share)
            .map_err(|e| anyhow!("Failed to build KeyPackage for signer {id:?}: {e}"))?;
        key_packages.insert(id, kp);
    }

    tracing::debug!(
        threshold = threshold,
        max_signers = max_signers,
        "FROST keys generated via trusted dealer"
    );

    Ok((key_packages, pubkey_package))
}

/// Perform a complete FROST signing round (single-machine simulation).
///
/// In production the commitment / signing steps would happen across
/// multiple network round-trips; here we run the full protocol locally
/// for testing and as a reference implementation.
///
/// * `key_packages` — all signer key packages (at least `threshold` entries
///   will be selected).
/// * `pubkey_package` — the group public key package.
/// * `message` — the raw bytes to sign.
/// * `threshold` — minimum signers.
pub fn sign_message(
    key_packages: &HashMap<Identifier, KeyPackage>,
    pubkey_package: &PublicKeyPackage,
    message: &[u8],
    threshold: u16,
) -> Result<Signature> {
    let mut rng = thread_rng();

    // Select `threshold` signers.
    let signers: Vec<_> = key_packages
        .iter()
        .take(threshold as usize)
        .collect();

    if signers.len() < threshold as usize {
        return Err(anyhow!(
            "Not enough signers: have {}, need {threshold}",
            signers.len()
        ));
    }

    // --- Round 1: each signer generates nonces + commitments ---------------
    let mut nonces_map: BTreeMap<Identifier, frost::round1::SigningNonces> = BTreeMap::new();
    let mut commitments_map: BTreeMap<Identifier, frost::round1::SigningCommitments> =
        BTreeMap::new();

    for (&id, kp) in &signers {
        let (nonces, commitments) = frost::round1::commit(kp.signing_share(), &mut rng);
        nonces_map.insert(id, nonces);
        commitments_map.insert(id, commitments);
    }

    // --- Build the signing package ------------------------------------------
    let signing_package = SigningPackage::new(commitments_map, message);

    // --- Round 2: each signer produces a signature share --------------------
    let mut signature_shares: BTreeMap<Identifier, frost::round2::SignatureShare> =
        BTreeMap::new();

    for (&id, kp) in &signers {
        let nonces = nonces_map
            .get(&id)
            .ok_or_else(|| anyhow!("Missing nonces for signer {id:?}"))?;

        let share = frost::round2::sign(&signing_package, nonces, kp)
            .map_err(|e| anyhow!("Signer {id:?} failed to sign: {e}"))?;

        signature_shares.insert(id, share);
    }

    // --- Aggregation --------------------------------------------------------
    let group_signature =
        frost::aggregate(&signing_package, &signature_shares, pubkey_package)
            .map_err(|e| anyhow!("FROST signature aggregation failed: {e}"))?;

    tracing::debug!("FROST signature produced successfully");

    Ok(group_signature)
}

/// Verify a FROST group signature against the group public key.
pub fn verify_signature(
    pubkey_package: &PublicKeyPackage,
    message: &[u8],
    signature: &Signature,
) -> bool {
    let verifying_key = pubkey_package.verifying_key();
    verifying_key.verify(message, signature).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_sign_verify() {
        let threshold = 2u16;
        let max_signers = 3u16;

        let (key_packages, pubkey_package) =
            generate_keys(threshold, max_signers).expect("keygen failed");

        assert_eq!(key_packages.len(), max_signers as usize);

        let message = b"bridge withdrawal: 1.5 XMR -> TON";

        let sig =
            sign_message(&key_packages, &pubkey_package, message, threshold)
                .expect("signing failed");

        assert!(
            verify_signature(&pubkey_package, message, &sig),
            "valid signature should verify"
        );

        // Tampered message should not verify.
        assert!(
            !verify_signature(&pubkey_package, b"tampered", &sig),
            "tampered message should fail verification"
        );
    }
}
