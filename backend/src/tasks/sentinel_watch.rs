use std::time::Duration;

use tokio::time;

use crate::services::sentinel;
use crate::AppState;

/// Background task that evaluates the sentinel guards on a fixed cadence and
/// trips the circuit breaker when any invariant breaks.
pub async fn run(state: AppState) {
    if !state.config.sentinel_enabled {
        tracing::warn!("sentinel: DISABLED via config — the bridge has no drain guard");
        return;
    }

    let cfg = sentinel::GuardConfig::from_config(&state.config);
    tracing::info!(
        interval_secs = state.config.sentinel_check_interval_secs,
        "sentinel: watching (order velocity, failure spike, outflow caps, rate divergence)"
    );

    let mut interval = time::interval(Duration::from_secs(
        state.config.sentinel_check_interval_secs,
    ));

    loop {
        interval.tick().await;

        // Already paused? Nothing to evaluate until a human resumes.
        if sentinel::pause_state(&state.redis).await.is_some() {
            continue;
        }

        let snapshot = match sentinel::take_snapshot(&state.db).await {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(error = %e, "sentinel: failed to take snapshot");
                metrics::counter!("sentinel_snapshot_failures_total").increment(1);
                continue;
            }
        };

        let mut trips = sentinel::evaluate(&snapshot, &cfg);
        metrics::counter!("sentinel_evaluations_total").increment(1);

        // Optional fifth guard: Isolation Forest via the risk engine.
        // Only consulted when the cheap invariant guards are quiet.
        if trips.is_empty() {
            if let Some(trip) = sentinel::ml_anomaly_check(&state).await {
                trips.push(trip);
            }
        }

        if let Some(trip) = trips.first() {
            if let Err(e) = sentinel::pause(
                &state.db,
                &state.redis,
                &trip.check,
                &trip.reason,
                trip.details.clone(),
                "sentinel",
            )
            .await
            {
                tracing::error!(error = %e, "sentinel: failed to engage circuit breaker");
            }
        }
    }
}
