use std::time::Duration;

use tokio::time;

use crate::services::transparency;
use crate::AppState;

/// Background task that seals the audit log into signed Merkle checkpoints.
pub async fn run(state: AppState) {
    let mut interval = time::interval(Duration::from_secs(
        state.config.transparency_seal_interval_secs,
    ));
    tracing::info!(
        interval_secs = state.config.transparency_seal_interval_secs,
        "transparency: checkpoint sealing scheduled"
    );

    loop {
        interval.tick().await;

        match transparency::seal(&state.db, &state.attestation).await {
            Ok(Some(cp)) => {
                tracing::info!(
                    tree_size = cp.tree_size,
                    root = %cp.root_hash,
                    "transparency: new checkpoint sealed"
                );
            }
            Ok(None) => {} // nothing new since the last seal
            Err(e) => {
                tracing::error!(error = %e, "transparency: seal cycle failed");
                metrics::counter!("transparency_seal_failures_total").increment(1);
            }
        }
    }
}
