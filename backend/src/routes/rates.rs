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

#[derive(Deserialize)]
pub struct RateQuery {
    pub direction: String,
}

#[derive(Deserialize)]
pub struct RateHistoryQuery {
    pub direction: String,
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

    let direction = normalize_direction(&q.direction)?;
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

    let direction = normalize_direction(&q.direction)?;
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
