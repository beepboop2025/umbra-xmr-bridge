//! Shared test helpers for integration tests.

use chrono::Utc;
use rust_decimal::Decimal;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

/// Create a test bridge order in `awaiting_deposit` status.
///
/// Returns the `order_id` (not the database UUID).
pub async fn create_test_order(
    pool: &PgPool,
    source_chain: &str,
    dest_chain: &str,
    from_amount: Decimal,
    to_amount: Decimal,
    metadata: Option<Value>,
) -> String {
    let id = Uuid::new_v4();
    // order_id column is VARCHAR(32); production ids are `br_` + 12 hex (15
    // chars). A full UUID would be 41 chars and overflow, so keep the test id
    // short too.
    let order_id = format!("test_{}", &Uuid::new_v4().simple().to_string()[..12]);
    let deposit_address = format!("deposit-{}", &order_id[..8]);
    let dest_address = format!("dest-{}", &order_id[..8]);
    let meta = metadata.unwrap_or(serde_json::json!({}));

    sqlx::query(
        r#"
        INSERT INTO bridge_orders (
            id, order_id, direction, source_chain, dest_chain,
            from_amount, from_currency, to_amount, to_currency,
            dest_address, deposit_address, rate_at_creation,
            fee, fee_percent, slippage, status, step,
            confirmations_current, confirmations_required,
            metadata, expires_at, created_at, updated_at
        ) VALUES (
            $1, $2, 'forward', $3, $4,
            $5, $3, $6, $4,
            $7, $8, 1.0,
            0.005, 0.3, 1.0, 'awaiting_deposit', 1,
            0, 10,
            $9, $10, $11, $11
        )
        "#,
    )
    .bind(id)
    .bind(&order_id)
    .bind(source_chain)
    .bind(dest_chain)
    .bind(from_amount)
    .bind(to_amount)
    .bind(&dest_address)
    .bind(&deposit_address)
    .bind(&meta)
    .bind(Utc::now() + chrono::Duration::hours(1))
    .bind(Utc::now())
    .execute(pool)
    .await
    .expect("Failed to create test order");

    order_id
}

/// Transition an order to a specific status.
pub async fn set_order_status(pool: &PgPool, order_id: &str, status: &str, step: i16) {
    sqlx::query(
        "UPDATE bridge_orders SET status = $1::order_status, step = $2, updated_at = $3 WHERE order_id = $4",
    )
    .bind(status)
    .bind(step)
    .bind(Utc::now())
    .bind(order_id)
    .execute(pool)
    .await
    .expect("Failed to update order status");
}
