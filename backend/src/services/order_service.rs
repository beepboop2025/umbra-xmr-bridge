use chrono::{Duration, Utc};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::{confirmations_for_chain, BridgeOrder, OrderStatus};
use crate::services::{audit_service, pubsub, rate_service};
use crate::AppState;

// ---------------------------------------------------------------------------
// Input params
// ---------------------------------------------------------------------------

pub struct CreateOrderParams {
    pub source_chain: String,
    pub dest_chain: String,
    pub amount: Decimal,
    pub dest_address: String,
    pub slippage: Decimal,
    pub telegram_user_id: Option<i64>,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Create a new bridge order.
///
/// 1. Fetches the current rate for the direction.
/// 2. Calculates conversion (applying fee + slippage).
/// 3. Generates a human-readable order_id (br_ + 12 hex chars).
/// 4. Inserts into the DB.
/// 5. Publishes creation event via Redis pubsub.
pub async fn create_order(state: &AppState, params: CreateOrderParams) -> AppResult<BridgeOrder> {
    let direction = format!("{}_TO_{}", params.source_chain, params.dest_chain);

    // Fetch live rate
    let rate_data = rate_service::get_rate(state, &direction).await?;

    // Calculate conversion
    let fee_percent = Decimal::try_from(state.config.bridge_fee_percent)
        .unwrap_or(Decimal::new(3, 1)); // 0.3%

    let conversion = rate_service::calculate_conversion(
        params.amount,
        &direction,
        rate_data.rate,
        fee_percent,
        params.slippage,
    );

    // Generate order_id: br_ + 12 hex chars
    let order_id = generate_order_id();

    let from_currency = params.source_chain.clone();
    let to_currency = params.dest_chain.clone();
    let confirmations_required = confirmations_for_chain(&params.source_chain);
    let expires_at = Utc::now() + Duration::minutes(state.config.order_expiry_minutes as i64);
    let now = Utc::now();
    let id = Uuid::new_v4();

    let order = sqlx::query_as::<_, BridgeOrder>(
        r#"
        INSERT INTO bridge_orders (
            id, order_id, direction, source_chain, dest_chain,
            from_amount, from_currency, to_amount, to_currency,
            dest_address, deposit_address, rate_at_creation,
            fee, fee_percent, min_received, slippage,
            status, step,
            confirmations_current, confirmations_required,
            telegram_user_id, metadata,
            expires_at, created_at, updated_at
        ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9,
            $10, NULL, $11,
            $12, $13, $14, $15,
            $16, $17,
            0, $18,
            $19, $20,
            $21, $22, $23
        )
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(&order_id)
    .bind(&direction)
    .bind(&params.source_chain)
    .bind(&params.dest_chain)
    .bind(conversion.from_amount)
    .bind(&from_currency)
    .bind(conversion.to_amount)
    .bind(&to_currency)
    .bind(&params.dest_address)
    .bind(rate_data.rate)
    .bind(conversion.fee)
    .bind(conversion.fee_percent)
    .bind(conversion.min_received)
    .bind(params.slippage)
    .bind(OrderStatus::Created)
    .bind(OrderStatus::Created.step())
    .bind(confirmations_required)
    .bind(params.telegram_user_id)
    .bind(serde_json::json!({}))
    .bind(expires_at)
    .bind(now)
    .bind(now)
    .fetch_one(&state.db)
    .await?;

    // Audit log
    audit_service::log(
        &state.db,
        "order_created",
        "bridge_order",
        Some(&order_id),
        serde_json::json!({
            "direction": direction,
            "amount": conversion.from_amount.to_string(),
            "rate": rate_data.rate.to_string(),
        }),
        "system",
    )
    .await?;

    // Publish to WebSocket subscribers
    let mut conn = state.redis.clone();
    let _ = pubsub::publish_order_update(
        &mut conn,
        &order_id,
        serde_json::json!({
            "order_id": order_id,
            "status": "created",
            "direction": direction,
            "from_amount": conversion.from_amount.to_string(),
            "to_amount": conversion.to_amount.to_string(),
        }),
    )
    .await;

    tracing::info!(order_id = %order_id, direction = %direction, "Order created");
    metrics::counter!("orders_created_total").increment(1);

    Ok(order)
}

/// Fetch a single order by its human-readable order_id (not the UUID).
pub async fn get_order(state: &AppState, order_id: &str) -> AppResult<BridgeOrder> {
    let order = sqlx::query_as::<_, BridgeOrder>(
        "SELECT * FROM bridge_orders WHERE order_id = $1",
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Order {order_id} not found")))?;

    Ok(order)
}

/// Paginated list of orders, optionally filtered by telegram_user_id.
/// Returns (orders, total_count).
pub async fn list_orders(
    state: &AppState,
    telegram_user_id: Option<i64>,
    limit: i64,
    offset: i64,
) -> AppResult<(Vec<BridgeOrder>, i64)> {
    let (orders, count) = match telegram_user_id {
        Some(tg_id) => {
            let orders = sqlx::query_as::<_, BridgeOrder>(
                "SELECT * FROM bridge_orders WHERE telegram_user_id = $1 \
                 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
            )
            .bind(tg_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(&state.db)
            .await?;

            #[derive(sqlx::FromRow)]
            struct CountRow {
                count: Option<i64>,
            }

            let row = sqlx::query_as::<_, CountRow>(
                "SELECT COUNT(*) as count FROM bridge_orders WHERE telegram_user_id = $1",
            )
            .bind(tg_id)
            .fetch_one(&state.db)
            .await?;

            (orders, row.count.unwrap_or(0))
        }
        None => {
            let orders = sqlx::query_as::<_, BridgeOrder>(
                "SELECT * FROM bridge_orders ORDER BY created_at DESC LIMIT $1 OFFSET $2",
            )
            .bind(limit)
            .bind(offset)
            .fetch_all(&state.db)
            .await?;

            #[derive(sqlx::FromRow)]
            struct CountRow {
                count: Option<i64>,
            }

            let row = sqlx::query_as::<_, CountRow>(
                "SELECT COUNT(*) as count FROM bridge_orders",
            )
            .fetch_one(&state.db)
            .await?;

            (orders, row.count.unwrap_or(0))
        }
    };

    Ok((orders, count))
}

/// Transition an order to a new status.
///
/// Enforces the state-machine (via `OrderStatus::can_transition_to`), writes
/// an audit log entry, and publishes the status change via Redis pubsub.
pub async fn update_status(
    state: &AppState,
    order_id: &str,
    new_status: OrderStatus,
) -> AppResult<BridgeOrder> {
    let current = get_order(state, order_id).await?;

    if !current.status.can_transition_to(&new_status) {
        return Err(AppError::Conflict(format!(
            "Cannot transition from {:?} to {:?}",
            current.status, new_status
        )));
    }

    let step = new_status.step();
    let now = Utc::now();

    let updated = sqlx::query_as::<_, BridgeOrder>(
        "UPDATE bridge_orders SET status = $1, step = $2, updated_at = $3 \
         WHERE order_id = $4 RETURNING *",
    )
    .bind(&new_status)
    .bind(step)
    .bind(now)
    .bind(order_id)
    .fetch_one(&state.db)
    .await?;

    // Audit log
    audit_service::log(
        &state.db,
        "status_changed",
        "bridge_order",
        Some(order_id),
        serde_json::json!({
            "from": format!("{:?}", current.status),
            "to": format!("{:?}", new_status),
        }),
        "system",
    )
    .await?;

    // Publish status update
    let mut conn = state.redis.clone();
    let _ = pubsub::publish_order_update(
        &mut conn,
        order_id,
        serde_json::json!({
            "order_id": order_id,
            "status": format!("{:?}", new_status).to_lowercase(),
            "step": step,
            "updated_at": now.to_rfc3339(),
        }),
    )
    .await;

    tracing::info!(
        order_id = %order_id,
        from = ?current.status,
        to = ?new_status,
        "Order status updated"
    );
    metrics::counter!("order_status_transitions_total",
        "from" => format!("{:?}", current.status),
        "to" => format!("{:?}", new_status)
    )
    .increment(1);

    Ok(updated)
}

/// Cancel an order. Only allowed when status is AwaitingDeposit.
/// Sets the order to Expired.
pub async fn cancel_order(state: &AppState, order_id: &str) -> AppResult<BridgeOrder> {
    let current = get_order(state, order_id).await?;

    if current.status != OrderStatus::AwaitingDeposit {
        return Err(AppError::Conflict(format!(
            "Order {} cannot be cancelled in status {:?}. Only awaiting_deposit orders can be cancelled.",
            order_id, current.status
        )));
    }

    let updated = update_status(state, order_id, OrderStatus::Expired).await?;

    tracing::info!(order_id = %order_id, "Order cancelled by user");
    metrics::counter!("orders_cancelled_total").increment(1);

    Ok(updated)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Generate a human-readable order ID: `br_` followed by 12 hex characters.
fn generate_order_id() -> String {
    let bytes: [u8; 6] = rand::random();
    format!("br_{}", hex::encode(bytes))
}
