//! End-to-end integration test for a full swap lifecycle.
//!
//! Exercises the complete order lifecycle from creation through completion:
//!   1. Order created (awaiting_deposit)
//!   2. Deposit detected (deposit_detected)
//!   3. Confirmations reached (confirming → bridging)
//!   4. Signed (signing)
//!   5. Broadcast (sending)
//!   6. Completed

use chrono::Utc;
use rust_decimal::Decimal;
use serde_json::json;
use sqlx::PgPool;

mod helpers;
use helpers::*;

#[sqlx::test]
async fn full_xmr_to_ton_lifecycle(pool: PgPool) {
    // Step 1: Create order
    let order_id = create_test_order(
        &pool,
        "XMR", "TON",
        Decimal::new(5_000_000_000_000, 12), // 5 XMR
        Decimal::new(500_000_000_000, 9),     // 500 TON
        Some(json!({"subaddr_index": 7})),
    ).await;

    verify_status(&pool, &order_id, "awaiting_deposit").await;

    // Step 2: Deposit detected
    let deposit_hash = "xmr-deposit-hash-abc";
    sqlx::query(
        r#"
        UPDATE bridge_orders
           SET status = 'deposit_detected',
               step = 2,
               deposit_tx_hash = $1,
               updated_at = $2
         WHERE order_id = $3
        "#,
    )
    .bind(deposit_hash)
    .bind(Utc::now())
    .bind(&order_id)
    .execute(&pool)
    .await
    .unwrap();

    verify_status(&pool, &order_id, "deposit_detected").await;

    // Step 3: Confirming — increment confirmations
    set_order_status(&pool, &order_id, "confirming", 3).await;

    for conf in 1..=10 {
        sqlx::query(
            "UPDATE bridge_orders SET confirmations_current = $1 WHERE order_id = $2",
        )
        .bind(conf)
        .bind(&order_id)
        .execute(&pool)
        .await
        .unwrap();
    }

    let confs: i32 = sqlx::query_scalar(
        "SELECT confirmations_current FROM bridge_orders WHERE order_id = $1",
    )
    .bind(&order_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(confs, 10);

    // Step 4: Bridging (confirmations met)
    set_order_status(&pool, &order_id, "bridging", 4).await;
    verify_status(&pool, &order_id, "bridging").await;

    // Step 5: Signing
    set_order_status(&pool, &order_id, "signing", 5).await;
    verify_status(&pool, &order_id, "signing").await;

    // Step 6: Sending
    set_order_status(&pool, &order_id, "sending", 6).await;
    verify_status(&pool, &order_id, "sending").await;

    // Step 7: Completed
    let withdrawal_hash = "ton-withdrawal-hash-xyz";
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
    .bind(withdrawal_hash)
    .bind(Utc::now())
    .bind(&order_id)
    .execute(&pool)
    .await
    .unwrap();

    verify_status(&pool, &order_id, "completed").await;

    // Verify both hashes are stored
    let row = sqlx::query_as::<_, (Option<String>, Option<String>)>(
        "SELECT deposit_tx_hash, withdrawal_tx_hash FROM bridge_orders WHERE order_id = $1",
    )
    .bind(&order_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row.0.as_deref(), Some(deposit_hash));
    assert_eq!(row.1.as_deref(), Some(withdrawal_hash));
}

#[sqlx::test]
async fn expired_order_does_not_complete(pool: PgPool) {
    let order_id = create_test_order(
        &pool,
        "BTC", "ETH",
        Decimal::new(100_000, 8),
        Decimal::new(50_000_000_000_000_000, 18),
        None,
    ).await;

    // Manually expire the order
    sqlx::query(
        r#"
        UPDATE bridge_orders
           SET status = 'expired',
               step = -2,
               expires_at = $1,
               updated_at = $2
         WHERE order_id = $3
        "#,
    )
    .bind(Utc::now() - chrono::Duration::hours(1))
    .bind(Utc::now())
    .bind(&order_id)
    .execute(&pool)
    .await
    .unwrap();

    verify_status(&pool, &order_id, "expired").await;

    // Attempting to transition to deposit_detected should not match
    // (the WHERE clause checks status = 'awaiting_deposit').
    let result = sqlx::query(
        r#"
        UPDATE bridge_orders
           SET status = 'deposit_detected', step = 2
         WHERE order_id = $1 AND status = 'awaiting_deposit'
        "#,
    )
    .bind(&order_id)
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(result.rows_affected(), 0);
    verify_status(&pool, &order_id, "expired").await; // still expired
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn verify_status(pool: &PgPool, order_id: &str, expected: &str) {
    let status: String = sqlx::query_scalar(
        "SELECT status::text FROM bridge_orders WHERE order_id = $1",
    )
    .bind(order_id)
    .fetch_one(pool)
    .await
    .unwrap();

    assert_eq!(status, expected, "Order {order_id} expected status `{expected}`, got `{status}`");
}
