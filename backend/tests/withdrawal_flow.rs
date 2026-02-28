//! Integration tests for the withdrawal processing flow.
//!
//! Verifies order status transitions through the signing and broadcast phases.

use chrono::Utc;
use rust_decimal::Decimal;
use serde_json::json;
use sqlx::PgPool;

mod helpers;
use helpers::*;

/// Verify the complete withdrawal lifecycle: Bridging -> Signing -> Sending -> Completed.
#[sqlx::test]
async fn withdrawal_lifecycle_status_transitions(pool: PgPool) {
    let order_id = create_test_order(
        &pool,
        "XMR", "TON",
        Decimal::new(2_000_000_000_000, 12),
        Decimal::new(200_000_000_000, 9),
        None,
    ).await;

    // Advance order to 'bridging' (the starting state for withdrawal processing).
    set_order_status(&pool, &order_id, "bridging", 4).await;

    // Simulate signing transition.
    set_order_status(&pool, &order_id, "signing", 5).await;
    let status: String = sqlx::query_scalar(
        "SELECT status::text FROM bridge_orders WHERE order_id = $1",
    )
    .bind(&order_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(status, "signing");

    // Simulate broadcast transition.
    set_order_status(&pool, &order_id, "sending", 6).await;
    let status: String = sqlx::query_scalar(
        "SELECT status::text FROM bridge_orders WHERE order_id = $1",
    )
    .bind(&order_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(status, "sending");

    // Simulate completion with a withdrawal tx hash.
    let fake_tx_hash = "ton-tx-abc123";
    sqlx::query(
        r#"
        UPDATE bridge_orders
           SET status = 'completed',
               step = 7,
               withdrawal_tx_hash = $1,
               updated_at = $2
         WHERE order_id = $3
        "#,
    )
    .bind(fake_tx_hash)
    .bind(Utc::now())
    .bind(&order_id)
    .execute(&pool)
    .await
    .unwrap();

    let row = sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT status::text, withdrawal_tx_hash FROM bridge_orders WHERE order_id = $1",
    )
    .bind(&order_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row.0, "completed");
    assert_eq!(row.1.as_deref(), Some(fake_tx_hash));
}

/// Verify that a failed withdrawal records the error message.
#[sqlx::test]
async fn withdrawal_failure_records_error(pool: PgPool) {
    let order_id = create_test_order(
        &pool,
        "ETH", "XMR",
        Decimal::new(1_000_000_000_000_000_000, 18),
        Decimal::new(10_000_000_000_000, 12),
        None,
    ).await;

    set_order_status(&pool, &order_id, "bridging", 4).await;

    // Simulate failure.
    let error_msg = "broadcast failed: insufficient funds in hot wallet";
    sqlx::query(
        r#"
        UPDATE bridge_orders
           SET status = 'failed',
               step = -1,
               error_message = $1,
               updated_at = $2
         WHERE order_id = $3
        "#,
    )
    .bind(error_msg)
    .bind(Utc::now())
    .bind(&order_id)
    .execute(&pool)
    .await
    .unwrap();

    let row = sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT status::text, error_message FROM bridge_orders WHERE order_id = $1",
    )
    .bind(&order_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row.0, "failed");
    assert_eq!(row.1.as_deref(), Some(error_msg));
}

/// Verify that the MPC request ID gets stored in order metadata.
#[sqlx::test]
async fn mpc_request_id_stored_in_metadata(pool: PgPool) {
    let order_id = create_test_order(
        &pool,
        "BTC", "SOL",
        Decimal::new(500_000, 8),
        Decimal::new(50_000_000_000, 9),
        Some(json!({"subaddr_index": 5})),
    ).await;

    set_order_status(&pool, &order_id, "bridging", 4).await;

    let mpc_request_id = format!("sign-{}", order_id);
    sqlx::query(
        r#"
        UPDATE bridge_orders
           SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{mpc_request_id}', to_jsonb($1::text)),
               updated_at = $2
         WHERE order_id = $3
        "#,
    )
    .bind(&mpc_request_id)
    .bind(Utc::now())
    .bind(&order_id)
    .execute(&pool)
    .await
    .unwrap();

    let meta: serde_json::Value = sqlx::query_scalar(
        "SELECT metadata FROM bridge_orders WHERE order_id = $1",
    )
    .bind(&order_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(
        meta.get("mpc_request_id").and_then(|v| v.as_str()),
        Some(mpc_request_id.as_str())
    );
}
