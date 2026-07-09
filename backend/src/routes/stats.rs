//! Public aggregate stats for the dashboard (`/api/stats*` on the frontend).
//!
//! All figures are derived from `bridge_orders`. USD volume is computed by
//! summing native `from_amount` per currency and multiplying by cached USD
//! prices (see `rate_service::usd_prices`), so a rate-source outage degrades to
//! a zero contribution rather than a 500.

use std::collections::{BTreeMap, HashMap};

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::services::rate_service;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/stats", get(get_stats))
        .route("/v1/stats/volume", get(get_volume_history))
}

/// Number of chains the bridge supports (XMR, BTC, ETH, TON, SOL, + USDT/USDC).
const SUPPORTED_CHAINS: i64 = 6;

#[derive(Serialize)]
struct StatsResponse {
    total_volume_usd: f64,
    volume_24h_usd: f64,
    active_orders: i64,
    completed_orders: i64,
    total_orders: i64,
    avg_completion_time: f64, // seconds
    supported_chains: i64,
}

async fn get_stats(State(state): State<AppState>) -> AppResult<Json<StatsResponse>> {
    #[derive(sqlx::FromRow)]
    struct Counts {
        total: i64,
        completed: i64,
        active: i64,
    }
    // "active" = anything not in a terminal state.
    let counts = sqlx::query_as::<_, Counts>(
        "SELECT \
            COUNT(*) AS total, \
            COUNT(*) FILTER (WHERE status = 'completed') AS completed, \
            COUNT(*) FILTER (WHERE status NOT IN ('completed','failed','refunded','expired')) AS active \
         FROM bridge_orders",
    )
    .fetch_one(&state.db)
    .await?;

    #[derive(sqlx::FromRow)]
    struct Avg {
        secs: Option<f64>,
    }
    let avg = sqlx::query_as::<_, Avg>(
        "SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at)))::float8 AS secs \
         FROM bridge_orders WHERE status = 'completed'",
    )
    .fetch_one(&state.db)
    .await?;

    let prices = rate_service::usd_prices(&state).await;

    Ok(Json(StatsResponse {
        total_volume_usd: volume_usd(&state, &prices, None).await?,
        volume_24h_usd: volume_usd(&state, &prices, Some(24)).await?,
        active_orders: counts.active,
        completed_orders: counts.completed,
        total_orders: counts.total,
        avg_completion_time: avg.secs.unwrap_or(0.0),
        supported_chains: SUPPORTED_CHAINS,
    }))
}

/// Sum order volume in USD, optionally limited to the last `hours` hours.
async fn volume_usd(
    state: &AppState,
    prices: &HashMap<String, f64>,
    hours: Option<i32>,
) -> AppResult<f64> {
    #[derive(sqlx::FromRow)]
    struct Row {
        from_currency: String,
        total: Option<Decimal>,
    }
    let rows = match hours {
        Some(h) => {
            sqlx::query_as::<_, Row>(
                "SELECT from_currency, SUM(from_amount) AS total FROM bridge_orders \
                 WHERE created_at > NOW() - make_interval(hours => $1) GROUP BY from_currency",
            )
            .bind(h)
            .fetch_all(&state.db)
            .await?
        }
        None => {
            sqlx::query_as::<_, Row>(
                "SELECT from_currency, SUM(from_amount) AS total FROM bridge_orders GROUP BY from_currency",
            )
            .fetch_all(&state.db)
            .await?
        }
    };

    let mut usd = 0.0;
    for r in rows {
        let amt = r.total.and_then(|d| d.to_f64()).unwrap_or(0.0);
        let price = prices.get(&r.from_currency.to_uppercase()).copied().unwrap_or(0.0);
        usd += amt * price;
    }
    Ok(usd)
}

#[derive(Deserialize)]
struct VolumeQuery {
    #[serde(default = "default_period")]
    period: String,
}
fn default_period() -> String {
    "7d".into()
}

#[derive(Serialize)]
struct VolumePoint {
    date: String,
    volume: f64,
    count: i64,
}

#[derive(Serialize)]
struct VolumeHistoryResponse {
    points: Vec<VolumePoint>,
}

async fn get_volume_history(
    State(state): State<AppState>,
    Query(q): Query<VolumeQuery>,
) -> AppResult<Json<VolumeHistoryResponse>> {
    let days: i32 = match q.period.as_str() {
        "24h" => 1,
        "7d" => 7,
        "30d" => 30,
        "90d" => 90,
        _ => 7,
    };
    let prices = rate_service::usd_prices(&state).await;

    #[derive(sqlx::FromRow)]
    struct Row {
        day: chrono::NaiveDate,
        from_currency: String,
        total: Option<Decimal>,
        cnt: i64,
    }
    let rows = sqlx::query_as::<_, Row>(
        "SELECT date_trunc('day', created_at)::date AS day, from_currency, \
                SUM(from_amount) AS total, COUNT(*) AS cnt \
         FROM bridge_orders WHERE created_at > NOW() - make_interval(days => $1) \
         GROUP BY day, from_currency ORDER BY day ASC",
    )
    .bind(days)
    .fetch_all(&state.db)
    .await?;

    // Collapse per-(day, currency) rows into per-day USD totals.
    let mut by_day: BTreeMap<String, (f64, i64)> = BTreeMap::new();
    for r in rows {
        let amt = r.total.and_then(|d| d.to_f64()).unwrap_or(0.0);
        let price = prices.get(&r.from_currency.to_uppercase()).copied().unwrap_or(0.0);
        let entry = by_day.entry(r.day.to_string()).or_insert((0.0, 0));
        entry.0 += amt * price;
        entry.1 += r.cnt;
    }

    let points = by_day
        .into_iter()
        .map(|(date, (volume, count))| VolumePoint { date, volume, count })
        .collect();

    Ok(Json(VolumeHistoryResponse { points }))
}
