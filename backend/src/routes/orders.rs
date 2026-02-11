use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::{BridgeOrder, OrderStatus};
use crate::services::order_service;
use crate::utils::validation;
use crate::AppState;

// ---------------------------------------------------------------------------
// Request / response schemas
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct OrderCreateRequest {
    pub source_chain: String,
    pub dest_chain: String,
    pub amount: Decimal,
    pub dest_address: String,
    #[serde(default = "default_slippage")]
    pub slippage: Decimal,
    pub telegram_user_id: Option<i64>,
}

fn default_slippage() -> Decimal {
    Decimal::new(5, 1) // 0.5%
}

#[derive(Debug, Deserialize)]
pub struct OrderListQuery {
    pub telegram_user_id: Option<i64>,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

fn default_limit() -> i64 {
    50
}

#[derive(Serialize)]
pub struct OrderResponse {
    pub order_id: String,
    pub direction: String,
    pub source_chain: String,
    pub dest_chain: String,
    pub from_amount: Decimal,
    pub from_currency: String,
    pub to_amount: Decimal,
    pub to_currency: String,
    pub dest_address: String,
    pub deposit_address: Option<String>,
    pub rate: Decimal,
    pub fee: Decimal,
    pub fee_percent: Decimal,
    pub min_received: Option<Decimal>,
    pub slippage: Decimal,
    pub status: OrderStatus,
    pub step: i16,
    pub deposit_tx_hash: Option<String>,
    pub withdrawal_tx_hash: Option<String>,
    pub confirmations_current: i32,
    pub confirmations_required: i32,
    pub error_message: Option<String>,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct OrderSummary {
    pub order_id: String,
    pub direction: String,
    pub from_amount: Decimal,
    pub to_amount: Decimal,
    pub status: OrderStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct PaginatedResponse<T: Serialize> {
    pub data: Vec<T>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/order", post(create_order))
        .route("/v1/order/:order_id", get(get_order))
        .route("/v1/orders", get(list_orders))
        .route("/v1/order/:order_id/cancel", post(cancel_order))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn create_order(
    State(state): State<AppState>,
    Json(req): Json<OrderCreateRequest>,
) -> AppResult<Json<OrderResponse>> {
    metrics::counter!("http_requests_total", "endpoint" => "create_order").increment(1);

    // -- Input validation --
    validate_create_request(&req)?;

    let params = order_service::CreateOrderParams {
        source_chain: req.source_chain.to_uppercase(),
        dest_chain: req.dest_chain.to_uppercase(),
        amount: req.amount,
        dest_address: req.dest_address.clone(),
        slippage: req.slippage,
        telegram_user_id: req.telegram_user_id,
    };

    let order = order_service::create_order(&state, params).await?;
    metrics::counter!("orders_created_total").increment(1);

    Ok(Json(order_to_response(&order)))
}

async fn get_order(
    State(state): State<AppState>,
    Path(order_id): Path<String>,
) -> AppResult<Json<OrderResponse>> {
    metrics::counter!("http_requests_total", "endpoint" => "get_order").increment(1);

    let order = order_service::get_order(&state, &order_id).await?;
    Ok(Json(order_to_response(&order)))
}

async fn list_orders(
    State(state): State<AppState>,
    Query(q): Query<OrderListQuery>,
) -> AppResult<Json<PaginatedResponse<OrderSummary>>> {
    metrics::counter!("http_requests_total", "endpoint" => "list_orders").increment(1);

    let limit = q.limit.clamp(1, 100);
    let offset = q.offset.max(0);

    let (orders, total) =
        order_service::list_orders(&state, q.telegram_user_id, limit, offset).await?;

    let summaries: Vec<OrderSummary> = orders
        .into_iter()
        .map(|o| OrderSummary {
            order_id: o.order_id,
            direction: o.direction,
            from_amount: o.from_amount,
            to_amount: o.to_amount,
            status: o.status,
            created_at: o.created_at,
        })
        .collect();

    Ok(Json(PaginatedResponse {
        data: summaries,
        total,
        limit,
        offset,
    }))
}

async fn cancel_order(
    State(state): State<AppState>,
    Path(order_id): Path<String>,
) -> AppResult<Json<OrderResponse>> {
    metrics::counter!("http_requests_total", "endpoint" => "cancel_order").increment(1);

    let order = order_service::cancel_order(&state, &order_id).await?;
    Ok(Json(order_to_response(&order)))
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

fn validate_create_request(req: &OrderCreateRequest) -> AppResult<()> {
    if req.amount <= Decimal::ZERO {
        return Err(AppError::BadRequest("amount must be > 0".into()));
    }

    let src = req.source_chain.to_uppercase();
    let dst = req.dest_chain.to_uppercase();

    if !validation::is_valid_chain(&src) {
        return Err(AppError::BadRequest(format!(
            "Unsupported source chain: {}",
            req.source_chain
        )));
    }
    if !validation::is_valid_chain(&dst) {
        return Err(AppError::BadRequest(format!(
            "Unsupported dest chain: {}",
            req.dest_chain
        )));
    }
    if src == dst {
        return Err(AppError::BadRequest(
            "source_chain and dest_chain must differ".into(),
        ));
    }

    // Validate dest address format using the shared regex-based validators
    if !validation::validate_address(&dst, &req.dest_address) {
        return Err(AppError::BadRequest(format!(
            "Invalid {} address format",
            dst
        )));
    }

    // Slippage bounds: 0.1% .. 5%
    let min_slip = Decimal::new(1, 1); // 0.1
    let max_slip = Decimal::new(5, 0); // 5.0
    if req.slippage < min_slip || req.slippage > max_slip {
        return Err(AppError::BadRequest(
            "slippage must be between 0.1 and 5.0 percent".into(),
        ));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Model -> response mapping
// ---------------------------------------------------------------------------

fn order_to_response(o: &BridgeOrder) -> OrderResponse {
    OrderResponse {
        order_id: o.order_id.clone(),
        direction: o.direction.clone(),
        source_chain: o.source_chain.clone(),
        dest_chain: o.dest_chain.clone(),
        from_amount: o.from_amount,
        from_currency: o.from_currency.clone(),
        to_amount: o.to_amount,
        to_currency: o.to_currency.clone(),
        dest_address: o.dest_address.clone(),
        deposit_address: o.deposit_address.clone(),
        rate: o.rate_at_creation,
        fee: o.fee,
        fee_percent: o.fee_percent,
        min_received: o.min_received,
        slippage: o.slippage,
        status: o.status.clone(),
        step: o.step,
        deposit_tx_hash: o.deposit_tx_hash.clone(),
        withdrawal_tx_hash: o.withdrawal_tx_hash.clone(),
        confirmations_current: o.confirmations_current,
        confirmations_required: o.confirmations_required,
        error_message: o.error_message.clone(),
        expires_at: o.expires_at,
        created_at: o.created_at,
        updated_at: o.updated_at,
    }
}
