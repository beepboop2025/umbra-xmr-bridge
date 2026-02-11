use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SessionStatus {
    /// Waiting for signer shares.
    Pending,
    /// Enough shares collected; final signature produced.
    Complete,
    /// Explicitly cancelled or timed out.
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningSession {
    pub request_id: String,
    /// SHA-256 hex digest of the original transaction data.
    pub tx_data_hash: String,
    /// Collected partial signature shares keyed by signer id.
    pub shares: HashMap<String, Vec<u8>>,
    pub created_at: DateTime<Utc>,
    pub status: SessionStatus,
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

/// Orchestrates multi-party threshold signing sessions.
///
/// The coordinator collects partial signature shares from individual signers
/// and, once the threshold is met, combines them into a final signature.
pub struct MpcCoordinator {
    threshold: u32,
    #[allow(dead_code)]
    total_signers: u32,
    active_requests: HashMap<String, SigningSession>,
    /// Tracks all request_ids that have ever been used (anti-replay).
    used_request_ids: HashSet<String>,
}

impl MpcCoordinator {
    pub fn new(threshold: u32, total_signers: u32) -> Self {
        Self {
            threshold,
            total_signers,
            active_requests: HashMap::new(),
            used_request_ids: HashSet::new(),
        }
    }

    /// Initiate a new signing session for the given `request_id`.
    ///
    /// Returns an error if the `request_id` has already been used (anti-replay).
    pub async fn request_signing(
        &mut self,
        request_id: String,
        tx_data: &[u8],
    ) -> Result<()> {
        // Anti-replay check.
        if self.used_request_ids.contains(&request_id) {
            return Err(anyhow!(
                "Signing request `{}` has already been processed (replay detected)",
                request_id
            ));
        }

        if self.active_requests.contains_key(&request_id) {
            return Err(anyhow!(
                "Signing session `{}` already exists",
                request_id
            ));
        }

        let tx_data_hash = hex::encode(Sha256::digest(tx_data));

        let session = SigningSession {
            request_id: request_id.clone(),
            tx_data_hash,
            shares: HashMap::new(),
            created_at: Utc::now(),
            status: SessionStatus::Pending,
        };

        self.active_requests.insert(request_id.clone(), session);
        self.used_request_ids.insert(request_id.clone());

        tracing::debug!(
            request_id = %request_id,
            "Created new signing session"
        );

        Ok(())
    }

    /// Submit a partial signature share from a signer.
    ///
    /// When enough shares have been collected (>= threshold), the coordinator
    /// combines them and returns the final aggregated signature bytes.
    /// Otherwise returns `Ok(None)`.
    pub async fn submit_share(
        &mut self,
        request_id: &str,
        signer_id: &str,
        share: Vec<u8>,
    ) -> Result<Option<Vec<u8>>> {
        let session = self
            .active_requests
            .get_mut(request_id)
            .ok_or_else(|| anyhow!("No active session for request `{request_id}`"))?;

        if session.status != SessionStatus::Pending {
            return Err(anyhow!(
                "Session `{request_id}` is no longer pending (status: {:?})",
                session.status
            ));
        }

        if session.shares.contains_key(signer_id) {
            return Err(anyhow!(
                "Signer `{signer_id}` has already submitted a share for `{request_id}`"
            ));
        }

        session
            .shares
            .insert(signer_id.to_string(), share);

        tracing::debug!(
            request_id = request_id,
            signer_id = signer_id,
            shares_collected = session.shares.len(),
            threshold = self.threshold,
            "Received signing share"
        );

        if session.shares.len() >= self.threshold as usize {
            // Combine shares — in a real deployment this would invoke
            // FROST aggregation (see `frost_bridge::sign_message`).
            // Here we perform a simple concatenation as a placeholder;
            // the actual aggregation depends on the signing protocol
            // wired through `frost_bridge`.
            let combined = combine_shares(session)?;

            session.status = SessionStatus::Complete;

            tracing::debug!(
                request_id = request_id,
                "Threshold met — signing session complete"
            );

            return Ok(Some(combined));
        }

        Ok(None)
    }

    /// Return a reference to a session (for status queries).
    pub fn get_session(&self, request_id: &str) -> Option<&SigningSession> {
        self.active_requests.get(request_id)
    }

    /// Mark a session as failed (e.g. on timeout).
    pub fn fail_session(&mut self, request_id: &str) {
        if let Some(session) = self.active_requests.get_mut(request_id) {
            session.status = SessionStatus::Failed;
        }
    }

}

// ---------------------------------------------------------------------------
// Free function
// ---------------------------------------------------------------------------

/// Combine the collected partial shares into a final signature.
///
/// The real implementation should delegate to `frost_bridge::aggregate`.
/// This placeholder concatenates shares with a domain-separation tag so
/// downstream code can later split/verify.
fn combine_shares(session: &SigningSession) -> Result<Vec<u8>> {
    // Deterministic ordering: sort by signer id.
    let mut ordered: Vec<(&String, &Vec<u8>)> = session.shares.iter().collect();
    ordered.sort_by_key(|(id, _)| *id);

    let mut combined = Vec::new();
    // Domain separator
    combined.extend_from_slice(b"FROST-SIG:");
    combined.extend_from_slice(session.tx_data_hash.as_bytes());
    combined.push(b':');

    for (_, share) in &ordered {
        combined.extend_from_slice(share);
    }

    // Hash the whole thing so the output is a fixed-size digest.
    let digest = sha2::Sha256::digest(&combined);
    Ok(digest.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_signing_session_lifecycle() {
        let mut coord = MpcCoordinator::new(2, 3);
        let tx_data = b"withdraw 1 XMR to TON";

        // Start session.
        coord
            .request_signing("req-1".into(), tx_data)
            .await
            .unwrap();

        // Replay should fail.
        assert!(coord
            .request_signing("req-1".into(), tx_data)
            .await
            .is_err());

        // Submit first share — should return None.
        let res = coord
            .submit_share("req-1", "signer-a", vec![1, 2, 3])
            .await
            .unwrap();
        assert!(res.is_none());

        // Duplicate share from same signer should fail.
        assert!(coord
            .submit_share("req-1", "signer-a", vec![4, 5, 6])
            .await
            .is_err());

        // Submit second share — meets threshold, should return combined sig.
        let res = coord
            .submit_share("req-1", "signer-b", vec![7, 8, 9])
            .await
            .unwrap();
        assert!(res.is_some());

        // Session should now be complete.
        let session = coord.get_session("req-1").unwrap();
        assert_eq!(session.status, SessionStatus::Complete);
    }
}
