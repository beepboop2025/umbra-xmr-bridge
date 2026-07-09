use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::services::rate_service;
use crate::AppState;

// ---------------------------------------------------------------------------
// Response / query schemas
// ---------------------------------------------------------------------------

/// The frontend passes `source`+`dest` (e.g. `?source=XMR&dest=BTC`); other
/// callers pass `direction` (`?direction=xmr_to_btc`). Accept both.
#[derive(Deserialize)]
pub struct RateQuery {
    pub direction: Option<String>,
    pub source: Option<String>,
    pub dest: Option<String>,
}

#[derive(Deserialize)]
pub struct RateHistoryQuery {
    pub direction: Option<String>,
    pub source: Option<String>,
    pub dest: Option<String>,
    /// Period string: "1h", "4h", "24h", "7d", "30d"
    #[serde(default = "default_period")]
    pub period: String,
}

fn default_period() -> String {
    "1h".into()
}

#[derive(Serialize)]
pub struct RateResponse {
    pub direction: String,
    pub rate: Decimal,
    pub change_24h: Option<f64>,
    pub source: String,
    pub timestamp: DateTime<Utc>,
    pub sparkline: Vec<f64>,
}

#[derive(Serialize)]
pub struct RateHistoryResponse {
    pub direction: String,
    pub period: String,
    pub points: Vec<RatePointResponse>,
}

#[derive(Serialize)]
pub struct RatePointResponse {
    pub rate: Decimal,
    pub timestamp: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct ConversionResult {
    pub from_amount: Decimal,
    pub to_amount: Decimal,
    pub rate: Decimal,
    pub fee: Decimal,
    pub fee_percent: Decimal,
    pub min_received: Decimal,
    pub direction: String,
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/rate", get(get_rate))
        .route("/v1/rate/history", get(get_rate_history))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn get_rate(
    State(state): State<AppState>,
    Query(q): Query<RateQuery>,
) -> AppResult<Json<RateResponse>> {
    metrics::counter!("http_requests_total", "endpoint" => "get_rate").increment(1);

    let direction = resolve_direction(q.direction.as_deref(), q.source.as_deref(), q.dest.as_deref())?;
    let data = rate_service::get_rate(&state, &direction).await?;

    Ok(Json(RateResponse {
        direction: data.direction,
        rate: data.rate,
        change_24h: data.change_24h,
        source: data.source,
        timestamp: Utc::now(),
        sparkline: data.sparkline,
    }))
}

async fn get_rate_history(
    State(state): State<AppState>,
    Query(q): Query<RateHistoryQuery>,
) -> AppResult<Json<RateHistoryResponse>> {
    metrics::counter!("http_requests_total", "endpoint" => "get_rate_history").increment(1);

    let direction = resolve_direction(q.direction.as_deref(), q.source.as_deref(), q.dest.as_deref())?;
    validate_period(&q.period)?;

    let points = rate_service::get_rate_history(&state, &direction, &q.period).await?;
    let point_responses: Vec<RatePointResponse> = points
        .into_iter()
        .map(|p| RatePointResponse {
            rate: p.rate,
            timestamp: p.timestamp,
        })
        .collect();

    Ok(Json(RateHistoryResponse {
        direction,
        period: q.period,
        points: point_responses,
    }))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Resolve a canonical direction from either an explicit `direction` or a
/// `source`+`dest` pair, then validate it.
fn resolve_direction(
    direction: Option<&str>,
    source: Option<&str>,
    dest: Option<&str>,
) -> AppResult<String> {
    let raw = match (direction, source, dest) {
        (Some(d), _, _) if !d.trim().is_empty() => d.to_string(),
        (_, Some(s), Some(t)) if !s.trim().is_empty() && !t.trim().is_empty() => {
            format!("{s}_to_{t}")
        }
        _ => {
            return Err(AppError::BadRequest(
                "Provide either 'direction' or both 'source' and 'dest'".into(),
            ))
        }
    };
    normalize_direction(&raw)
}

/// Ensure the direction string is one of the supported pairs.
fn normalize_direction(raw: &str) -> AppResult<String> {
    let d = raw.to_uppercase().replace('-', "_").replace('/', "_");
    let valid = [
        "XMR_TO_BTC",
        "XMR_TO_ETH",
        "XMR_TO_TON",
        "XMR_TO_SOL",
        "XMR_TO_USDT",
        "XMR_TO_USDC",
        "BTC_TO_XMR",
        "ETH_TO_XMR",
        "TON_TO_XMR",
        "SOL_TO_XMR",
    ];
    if valid.contains(&d.as_str()) {
        Ok(d)
    } else {
        Err(AppError::BadRequest(format!(
            "Invalid direction '{raw}'. Supported: {}",
            valid.join(", ")
        )))
    }
}

fn validate_period(period: &str) -> AppResult<()> {
    let valid = ["1h", "4h", "24h", "7d", "30d"];
    if valid.contains(&period) {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!(
            "Invalid period '{period}'. Supported: {}",
            valid.join(", ")
        )))
    }
}
