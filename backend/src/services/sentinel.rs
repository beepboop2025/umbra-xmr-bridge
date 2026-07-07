//! Sentinel: an always-on circuit breaker between the bridge and catastrophe.
//!
//! Nearly every large bridge exploit (Ronin, Nomad, Harmony, Multichain) drained
//! funds over minutes-to-hours while nothing watched aggregate behavior. The
//! sentinel watches four invariants on a fixed cadence and halts new order
//! intake the moment one breaks:
//!
//! 1. **Outflow velocity** — per-chain sum of outbound value over a sliding
//!    hour vs a hard cap. A key compromise shows up here first.
//! 2. **Order velocity** — orders created per 5 minutes. Bot floods and
//!    griefing precede most probing attacks.
//! 3. **Failure spike** — failed orders per 15 minutes. A sudden cluster of
//!    failures usually means a subsystem is being exploited or has broken in a
//!    way that misprices swaps.
//! 4. **Rate divergence** — disagreement between independent price sources.
//!    A poisoned oracle mints free money; two honest sources rarely disagree
//!    by more than a few percent.
//!
//! A trip *pauses order creation only* — in-flight swaps keep settling, so a
//! false positive costs minutes of intake, not user funds. Every trip, pause,
//! and resume lands in the sentinel_events table, the tamper-evident audit
//! chain, and the public `/v1/proof/status` endpoint: the bridge cannot be
//! paused (or unpaused) in secret.

use std::collections::HashMap;

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub const PAUSE_KEY: &str = "sentinel:paused";

// ---------------------------------------------------------------------------
// Pause state (stored in Redis so every replica sees it instantly)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PauseState {
    pub check: String,
    pub reason: String,
    pub actor: String,
    pub tripped_at: chrono::DateTime<chrono::Utc>,
}

pub async fn pause_state(redis: &crate::redis::RedisPool) -> Option<PauseState> {
    let mut conn = redis.clone();
    let raw: Option<String> = redis::cmd("GET")
        .arg(PAUSE_KEY)
        .query_async::<_, Option<String>>(&mut conn)
        .await
        .ok()
        .flatten();
    raw.and_then(|s| serde_json::from_str(&s).ok())
}

/// Gate for order intake. Fails closed with 503 when the sentinel has tripped.
pub async fn ensure_accepting_orders(redis: &crate::redis::RedisPool) -> AppResult<()> {
    if let Some(p) = pause_state(redis).await {
        metrics::counter!("sentinel_rejected_orders_total").increment(1);
        return Err(AppError::ServiceUnavailable(format!(
            "Bridge intake is paused ({}): {}. Existing orders continue to settle; \
             see /v1/proof/status for live state.",
            p.check, p.reason
        )));
    }
    Ok(())
}

/// Engage the circuit breaker. Idempotent; the first trip wins.
pub async fn pause(
    db: &crate::db::Pool,
    redis: &crate::redis::RedisPool,
    check: &str,
    reason: &str,
    details: serde_json::Value,
    actor: &str,
) -> AppResult<bool> {
    let state = PauseState {
        check: check.to_string(),
        reason: reason.to_string(),
        actor: actor.to_string(),
        tripped_at: chrono::Utc::now(),
    };
    let payload = serde_json::to_string(&state)?;

    // SET NX so a concurrent trip doesn't overwrite the original cause.
    let mut conn = redis.clone();
    let set: Option<String> = redis::cmd("SET")
        .arg(PAUSE_KEY)
        .arg(&payload)
        .arg("NX")
        .query_async::<_, Option<String>>(&mut conn)
        .await?;

    if set.is_none() {
        return Ok(false); // already paused
    }

    let kind = if actor == "sentinel" { "tripped" } else { "paused" };
    record_event(db, redis, kind, check, reason, details, actor).await;
    metrics::counter!("sentinel_trips_total", "check" => check.to_string()).increment(1);
    metrics::gauge!("sentinel_paused").set(1.0);
    tracing::error!(check = %check, reason = %reason, actor = %actor,
        "SENTINEL: bridge intake paused");
    Ok(true)
}

/// Lift the circuit breaker (admin only — the task never auto-resumes; a human
/// must look at what tripped before turning intake back on).
pub async fn resume(
    db: &crate::db::Pool,
    redis: &crate::redis::RedisPool,
    actor: &str,
    note: &str,
) -> AppResult<bool> {
    let mut conn = redis.clone();
    let removed: i64 = redis::cmd("DEL")
        .arg(PAUSE_KEY)
        .query_async::<_, i64>(&mut conn)
        .await?;

    if removed == 0 {
        return Ok(false);
    }

    record_event(
        db,
        redis,
        "resumed",
        "manual",
        note,
        serde_json::json!({}),
        actor,
    )
    .await;
    metrics::gauge!("sentinel_paused").set(0.0);
    tracing::warn!(actor = %actor, "SENTINEL: bridge intake resumed");
    Ok(true)
}

async fn record_event(
    db: &crate::db::Pool,
    redis: &crate::redis::RedisPool,
    kind: &str,
    check: &str,
    reason: &str,
    details: serde_json::Value,
    actor: &str,
) {
    if let Err(e) = sqlx::query(
        "INSERT INTO sentinel_events (kind, check_name, reason, details, actor) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(kind)
    .bind(check)
    .bind(reason)
    .bind(&details)
    .bind(actor)
    .execute(db)
    .await
    {
        tracing::error!(error = %e, "sentinel: failed to record event");
    }

    // Into the tamper-evident audit chain (and thus the transparency log).
    if let Err(e) = crate::services::audit_service::log(
        db,
        &format!("sentinel_{kind}"),
        "sentinel",
        Some(check),
        serde_json::json!({"reason": reason, "details": details}),
        actor,
    )
    .await
    {
        tracing::error!(error = %e, "sentinel: failed to write audit entry");
    }

    // Broadcast so dashboards flip in real time.
    let mut conn = redis.clone();
    let msg = serde_json::json!({
        "kind": kind, "check": check, "reason": reason, "actor": actor,
        "at": chrono::Utc::now().to_rfc3339(),
    })
    .to_string();
    let _ = redis::cmd("PUBLISH")
        .arg("sentinel:events")
        .arg(&msg)
        .query_async::<_, i64>(&mut conn)
        .await;
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SentinelEvent {
    pub id: i64,
    pub kind: String,
    pub check_name: String,
    pub reason: String,
    pub details: serde_json::Value,
    pub actor: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn recent_events(db: &crate::db::Pool, limit: i64) -> AppResult<Vec<SentinelEvent>> {
    let rows = sqlx::query_as::<_, SentinelEvent>(
        "SELECT * FROM sentinel_events ORDER BY id DESC LIMIT $1",
    )
    .bind(limit.clamp(1, 100))
    .fetch_all(db)
    .await?;
    Ok(rows)
}

// ---------------------------------------------------------------------------
// Guard evaluation (pure — unit-testable without a database)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct GuardConfig {
    pub max_orders_per_5m: i64,
    pub max_failures_per_15m: i64,
    pub max_rate_divergence_percent: f64,
    /// Per-chain outflow caps over a sliding hour, in native units.
    pub hourly_outflow_caps: HashMap<String, Decimal>,
}

impl GuardConfig {
    pub fn from_config(cfg: &crate::config::Config) -> Self {
        Self {
            max_orders_per_5m: cfg.sentinel_max_orders_per_5m,
            max_failures_per_15m: cfg.sentinel_max_failures_per_15m,
            max_rate_divergence_percent: cfg.sentinel_rate_divergence_percent,
            hourly_outflow_caps: parse_outflow_caps(&cfg.sentinel_outflow_caps),
        }
    }
}

/// Parse "XMR:1000,BTC:20,TON:100000" into a cap map, falling back to
/// conservative defaults for anything unspecified.
pub fn parse_outflow_caps(spec: &str) -> HashMap<String, Decimal> {
    let mut caps: HashMap<String, Decimal> = default_outflow_caps();
    for part in spec.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((chain, amount)) = part.split_once(':') {
            if let Ok(v) = amount.trim().parse::<Decimal>() {
                caps.insert(chain.trim().to_uppercase(), v);
            } else {
                tracing::warn!(entry = %part, "sentinel: ignoring malformed outflow cap");
            }
        }
    }
    caps
}

fn default_outflow_caps() -> HashMap<String, Decimal> {
    // Roughly 2x the single-order maximum, per hour — generous for organic
    // traffic, suffocating for a drain.
    [
        ("XMR", Decimal::new(1_000, 0)),
        ("BTC", Decimal::new(20, 0)),
        ("ETH", Decimal::new(200, 0)),
        ("ARB", Decimal::new(200, 0)),
        ("BASE", Decimal::new(200, 0)),
        ("TON", Decimal::new(100_000, 0)),
        ("SOL", Decimal::new(10_000, 0)),
        ("USDC", Decimal::new(100_000, 0)),
        ("USDT", Decimal::new(100_000, 0)),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect()
}

/// A point-in-time reading of everything the guards need.
#[derive(Debug, Default)]
pub struct Snapshot {
    pub orders_last_5m: i64,
    pub failures_last_15m: i64,
    /// (dest_chain, summed outbound amount) over the last hour.
    pub hourly_outflow: Vec<(String, Decimal)>,
    /// (direction, source, rate) rows observed in the last 10 minutes.
    pub recent_rates: Vec<(String, String, Decimal)>,
}

#[derive(Debug, PartialEq)]
pub struct Trip {
    pub check: String,
    pub reason: String,
    pub details: serde_json::Value,
}

/// Evaluate all guards against a snapshot. Returns every guard that fired.
pub fn evaluate(snapshot: &Snapshot, cfg: &GuardConfig) -> Vec<Trip> {
    let mut trips = Vec::new();

    if snapshot.orders_last_5m > cfg.max_orders_per_5m {
        trips.push(Trip {
            check: "order_velocity".into(),
            reason: format!(
                "{} orders created in 5 minutes (limit {})",
                snapshot.orders_last_5m, cfg.max_orders_per_5m
            ),
            details: serde_json::json!({
                "observed": snapshot.orders_last_5m,
                "limit": cfg.max_orders_per_5m,
            }),
        });
    }

    if snapshot.failures_last_15m > cfg.max_failures_per_15m {
        trips.push(Trip {
            check: "failure_spike".into(),
            reason: format!(
                "{} failed orders in 15 minutes (limit {})",
                snapshot.failures_last_15m, cfg.max_failures_per_15m
            ),
            details: serde_json::json!({
                "observed": snapshot.failures_last_15m,
                "limit": cfg.max_failures_per_15m,
            }),
        });
    }

    for (chain, outflow) in &snapshot.hourly_outflow {
        if let Some(cap) = cfg.hourly_outflow_caps.get(&chain.to_uppercase()) {
            if outflow > cap {
                trips.push(Trip {
                    check: "outflow_velocity".into(),
                    reason: format!(
                        "outbound {chain} volume {outflow} exceeded hourly cap {cap}"
                    ),
                    details: serde_json::json!({
                        "chain": chain,
                        "observed": outflow.to_string(),
                        "cap": cap.to_string(),
                    }),
                });
            }
        }
    }

    // Rate divergence: group by direction, compare min/max across sources.
    let mut by_direction: HashMap<&str, Vec<(&str, Decimal)>> = HashMap::new();
    for (direction, source, rate) in &snapshot.recent_rates {
        if *rate > Decimal::ZERO {
            by_direction
                .entry(direction.as_str())
                .or_default()
                .push((source.as_str(), *rate));
        }
    }
    for (direction, rates) in by_direction {
        let distinct_sources: std::collections::HashSet<&str> =
            rates.iter().map(|(s, _)| *s).collect();
        if distinct_sources.len() < 2 {
            continue; // divergence needs at least two independent opinions
        }
        let min = rates.iter().map(|(_, r)| *r).min().unwrap_or(Decimal::ZERO);
        let max = rates.iter().map(|(_, r)| *r).max().unwrap_or(Decimal::ZERO);
        if min <= Decimal::ZERO {
            continue;
        }
        use rust_decimal::prelude::ToPrimitive;
        let divergence = ((max - min) / min * Decimal::new(100, 0))
            .to_f64()
            .unwrap_or(0.0);
        if divergence > cfg.max_rate_divergence_percent {
            trips.push(Trip {
                check: "rate_divergence".into(),
                reason: format!(
                    "{direction} price sources disagree by {divergence:.2}% (limit {}%)",
                    cfg.max_rate_divergence_percent
                ),
                details: serde_json::json!({
                    "direction": direction,
                    "min": min.to_string(),
                    "max": max.to_string(),
                    "divergence_percent": divergence,
                }),
            });
        }
    }

    trips
}

/// Read a fresh snapshot from the database.
pub async fn take_snapshot(db: &crate::db::Pool) -> AppResult<Snapshot> {
    #[derive(sqlx::FromRow)]
    struct CountRow {
        count: Option<i64>,
    }

    let orders_last_5m = sqlx::query_as::<_, CountRow>(
        "SELECT COUNT(*) AS count FROM bridge_orders \
         WHERE created_at > NOW() - INTERVAL '5 minutes'",
    )
    .fetch_one(db)
    .await?
    .count
    .unwrap_or(0);

    let failures_last_15m = sqlx::query_as::<_, CountRow>(
        "SELECT COUNT(*) AS count FROM bridge_orders \
         WHERE status = 'failed' AND updated_at > NOW() - INTERVAL '15 minutes'",
    )
    .fetch_one(db)
    .await?
    .count
    .unwrap_or(0);

    #[derive(sqlx::FromRow)]
    struct OutflowRow {
        dest_chain: String,
        total: Option<Decimal>,
    }
    let outflow_rows = sqlx::query_as::<_, OutflowRow>(
        "SELECT dest_chain, SUM(to_amount) AS total FROM bridge_orders \
         WHERE status IN ('sending', 'completed') \
           AND updated_at > NOW() - INTERVAL '1 hour' \
         GROUP BY dest_chain",
    )
    .fetch_all(db)
    .await?;

    #[derive(sqlx::FromRow)]
    struct RateRow {
        direction: String,
        source: String,
        rate: Decimal,
    }
    let rate_rows = sqlx::query_as::<_, RateRow>(
        "SELECT direction, source, rate FROM exchange_rates \
         WHERE created_at > NOW() - INTERVAL '10 minutes'",
    )
    .fetch_all(db)
    .await?;

    Ok(Snapshot {
        orders_last_5m,
        failures_last_15m,
        hourly_outflow: outflow_rows
            .into_iter()
            .map(|r| (r.dest_chain, r.total.unwrap_or(Decimal::ZERO)))
            .collect(),
        recent_rates: rate_rows
            .into_iter()
            .map(|r| (r.direction, r.source, r.rate))
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> GuardConfig {
        GuardConfig {
            max_orders_per_5m: 60,
            max_failures_per_15m: 10,
            max_rate_divergence_percent: 5.0,
            hourly_outflow_caps: default_outflow_caps(),
        }
    }

    #[test]
    fn quiet_snapshot_trips_nothing() {
        let snap = Snapshot {
            orders_last_5m: 3,
            failures_last_15m: 0,
            hourly_outflow: vec![("XMR".into(), Decimal::new(12, 0))],
            recent_rates: vec![
                ("XMR_TO_TON".into(), "coingecko".into(), Decimal::new(1000, 1)),
                ("XMR_TO_TON".into(), "binance".into(), Decimal::new(1010, 1)),
            ],
        };
        assert!(evaluate(&snap, &cfg()).is_empty());
    }

    #[test]
    fn order_flood_trips_velocity_guard() {
        let snap = Snapshot {
            orders_last_5m: 500,
            ..Default::default()
        };
        let trips = evaluate(&snap, &cfg());
        assert_eq!(trips.len(), 1);
        assert_eq!(trips[0].check, "order_velocity");
    }

    #[test]
    fn failure_cluster_trips_spike_guard() {
        let snap = Snapshot {
            failures_last_15m: 11,
            ..Default::default()
        };
        let trips = evaluate(&snap, &cfg());
        assert_eq!(trips[0].check, "failure_spike");
    }

    #[test]
    fn drain_trips_outflow_guard() {
        // A drain pushes 21 BTC out in under an hour: over the 20 BTC cap.
        let snap = Snapshot {
            hourly_outflow: vec![
                ("BTC".into(), Decimal::new(21, 0)),
                ("TON".into(), Decimal::new(500, 0)), // well under cap
            ],
            ..Default::default()
        };
        let trips = evaluate(&snap, &cfg());
        assert_eq!(trips.len(), 1);
        assert_eq!(trips[0].check, "outflow_velocity");
        assert!(trips[0].reason.contains("BTC"));
    }

    #[test]
    fn outflow_at_exact_cap_does_not_trip() {
        let snap = Snapshot {
            hourly_outflow: vec![("BTC".into(), Decimal::new(20, 0))],
            ..Default::default()
        };
        assert!(evaluate(&snap, &cfg()).is_empty());
    }

    #[test]
    fn unknown_chain_outflow_is_ignored() {
        let snap = Snapshot {
            hourly_outflow: vec![("DOGE".into(), Decimal::new(1_000_000, 0))],
            ..Default::default()
        };
        assert!(evaluate(&snap, &cfg()).is_empty());
    }

    #[test]
    fn poisoned_oracle_trips_divergence_guard() {
        // Second source reports a rate 40% higher — classic oracle attack.
        let snap = Snapshot {
            recent_rates: vec![
                ("XMR_TO_ETH".into(), "coingecko".into(), Decimal::new(100, 3)),
                ("XMR_TO_ETH".into(), "binance".into(), Decimal::new(140, 3)),
            ],
            ..Default::default()
        };
        let trips = evaluate(&snap, &cfg());
        assert_eq!(trips.len(), 1);
        assert_eq!(trips[0].check, "rate_divergence");
    }

    #[test]
    fn single_source_cannot_diverge() {
        let snap = Snapshot {
            recent_rates: vec![
                ("XMR_TO_ETH".into(), "coingecko".into(), Decimal::new(100, 3)),
                ("XMR_TO_ETH".into(), "coingecko".into(), Decimal::new(150, 3)),
            ],
            ..Default::default()
        };
        // Same source moving fast is volatility, not divergence.
        assert!(evaluate(&snap, &cfg()).is_empty());
    }

    #[test]
    fn multiple_guards_can_fire_together() {
        let snap = Snapshot {
            orders_last_5m: 1000,
            failures_last_15m: 50,
            hourly_outflow: vec![("XMR".into(), Decimal::new(5_000, 0))],
            recent_rates: vec![],
        };
        let trips = evaluate(&snap, &cfg());
        assert_eq!(trips.len(), 3);
    }

    #[test]
    fn cap_spec_parsing_overrides_defaults_and_ignores_junk() {
        let caps = parse_outflow_caps("XMR:50, btc:1.5, MALFORMED, TON:abc");
        assert_eq!(caps.get("XMR"), Some(&Decimal::new(50, 0)));
        assert_eq!(caps.get("BTC"), Some(&Decimal::new(15, 1)));
        // TON:abc is malformed → default retained
        assert_eq!(caps.get("TON"), Some(&Decimal::new(100_000, 0)));
        // Unmentioned chains keep defaults
        assert_eq!(caps.get("ETH"), Some(&Decimal::new(200, 0)));
    }
}
