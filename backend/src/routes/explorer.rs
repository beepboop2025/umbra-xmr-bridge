//! Public transaction explorer (`/api/explorer/*` on the frontend).
//!
//! Deliberately privacy-preserving: it exposes order ids, chains, amounts,
//! status and (optional) on-chain tx hashes, but never deposit/destination
//! addresses. A privacy bridge must not turn its own explorer into a metadata
//! leak.

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/explorer/recent", get(recent))
        .route("/v1/explorer/search", get(search))
}

#[derive(sqlx::FromRow)]
struct OrderRow {
    order_id: String,
    source_chain: String,
    dest_chain: String,
    from_amount: Decimal,
    to_amount: Decimal,
    status: String,
    created_at: DateTime<Utc>,
    deposit_tx_hash: Option<String>,
    withdrawal_tx_hash: Option<String>,
}

#[derive(Serialize)]
struct OrderSummary {
    order_id: String,
    source_chain: String,
    dest_chain: String,
    amount: f64,
    receive_amount: f64,
    status: String,
    created_at: DateTime<Utc>,
    source_tx: Option<String>,
    dest_tx: Option<String>,
}

impl From<OrderRow> for OrderSummary {
    fn from(r: OrderRow) -> Self {
        OrderSummary {
            order_id: r.order_id,
            source_chain: r.source_chain,
            dest_chain: r.dest_chain,
            amount: r.from_amount.to_f64().unwrap_or(0.0),
            receive_amount: r.to_amount.to_f64().unwrap_or(0.0),
            status: r.status,
            created_at: r.created_at,
            source_tx: r.deposit_tx_hash,
            dest_tx: r.withdrawal_tx_hash,
        }
    }
}

// `status::text` casts the order_status enum to a plain string so it decodes
// into `String` without needing the enum type in Rust.
const SELECT_COLS: &str = "order_id, source_chain, dest_chain, from_amount, to_amount, \
     status::text AS status, created_at, deposit_tx_hash, withdrawal_tx_hash";

#[derive(Deserialize)]
struct RecentQuery {
    #[serde(default = "default_limit")]
    limit: i64,
}
fn default_limit() -> i64 {
    20
}

#[derive(Serialize)]
struct RecentResponse {
    transactions: Vec<OrderSummary>,
}

async fn recent(
    State(state): State<AppState>,
    Query(q): Query<RecentQuery>,
) -> AppResult<Json<RecentResponse>> {
    let limit = q.limit.clamp(1, 100);
    let rows = sqlx::query_as::<_, OrderRow>(&format!(
        "SELECT {SELECT_COLS} FROM bridge_orders ORDER BY created_at DESC LIMIT $1"
    ))
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(RecentResponse {
        transactions: rows.into_iter().map(OrderSummary::from).collect(),
    }))
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
}

#[derive(Serialize)]
struct SearchResponse {
    results: Vec<OrderSummary>,
}

async fn search(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> AppResult<Json<SearchResponse>> {
    let term = query.q.trim();
    if term.is_empty() {
        return Err(AppError::BadRequest("Search query must not be empty".into()));
    }
    // Exact match on the order id or either on-chain tx hash.
    let rows = sqlx::query_as::<_, OrderRow>(&format!(
        "SELECT {SELECT_COLS} FROM bridge_orders \
         WHERE order_id = $1 OR deposit_tx_hash = $1 OR withdrawal_tx_hash = $1 \
         ORDER BY created_at DESC LIMIT 25"
    ))
    .bind(term)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(SearchResponse {
        results: rows.into_iter().map(OrderSummary::from).collect(),
    }))
}
