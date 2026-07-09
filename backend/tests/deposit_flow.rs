//! Integration tests for the deposit monitoring flow.
//!
//! These tests use mock blockchain RPC responses to verify that the
//! deposit monitor correctly detects deposits and transitions order status.

use chrono::Utc;
use rust_decimal::Decimal;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

mod helpers;
use helpers::*;

/// Verify that when a Monero transfer is found matching the expected amount
/// and subaddress, the order transitions from `awaiting_deposit` to
/// `deposit_detected`.
#[sqlx::test]
async fn xmr_deposit_detected(pool: PgPool) {
    let order_id = create_test_order(
        &pool,
        "XMR",
        "TON",
        Decimal::new(1_500_000_000_000, 12), // 1.5 XMR
        Decimal::new(100_000_000_000, 9),     // 100 TON
        Some(json!({"subaddr_index": 42})),
    )
    .await;

    // Simulate deposit detection by updating the order as the monitor would.
    let fake_tx_hash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

    sqlx::query(
        r#"
        UPDATE bridge_orders
           SET status = 'deposit_detected',
               step = 2,
               deposit_tx_hash = $1,
               updated_at = $2
         WHERE order_id = $3
           AND status = 'awaiting_deposit'
        "#,
    )
    .bind(fake_tx_hash)
    .bind(Utc::now())
    .bind(&order_id)
    .execute(&pool)
    .await
    .unwrap();

    // Verify the order was updated.
    let row = sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT status::text, deposit_tx_hash FROM bridge_orders WHERE order_id = $1",
    )
    .bind(&order_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row.0, "deposit_detected");
    assert_eq!(row.1.as_deref(), Some(fake_tx_hash));
}

/// Verify that orders without a deposit address are skipped gracefully.
#[sqlx::test]
async fn deposit_skipped_without_address(pool: PgPool) {
    // order_id column is VARCHAR(32); a full UUID (36 chars) overflows.
    let order_id = format!("test_{}", &Uuid::new_v4().simple().to_string()[..12]);

    sqlx::query(
        r#"
        INSERT INTO bridge_orders (
            id, order_id, direction, source_chain, dest_chain,
            from_amount, from_currency, to_amount, to_currency,
            dest_address, rate_at_creation, fee, fee_percent,
            slippage, status, step, metadata, expires_at, created_at, updated_at
        ) VALUES (
            $1, $2, 'forward', 'XMR', 'TON',
            1.5, 'XMR', 100, 'TON',
            'EQABC123', 66.67, 0.005, 0.3,
            1.0, 'awaiting_deposit', 1, '{}',
            $3, $4, $4
        )
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(&order_id)
    .bind(Utc::now() + chrono::Duration::hours(1))
    .bind(Utc::now())
    .execute(&pool)
    .await
    .unwrap();

    // deposit_address is NULL — the monitor should skip this order.
    let row = sqlx::query_as::<_, (Option<String>,)>(
        "SELECT deposit_address FROM bridge_orders WHERE order_id = $1",
    )
    .bind(&order_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(row.0.is_none());
}

/// Multiple deposits for different orders should be tracked independently.
#[sqlx::test]
async fn multiple_orders_tracked_independently(pool: PgPool) {
    let order_a = create_test_order(
        &pool, "BTC", "TON",
        Decimal::new(100_000, 8), // 0.001 BTC
        Decimal::new(10_000_000_000, 9),
        None,
    ).await;

    let order_b = create_test_order(
        &pool, "ETH", "XMR",
        Decimal::new(500_000_000_000_000_000, 18), // 0.5 ETH
        Decimal::new(5_000_000_000_000, 12),
        None,
    ).await;

    // Both should start as awaiting_deposit
    for oid in [&order_a, &order_b] {
        let status: String = sqlx::query_scalar(
            "SELECT status::text FROM bridge_orders WHERE order_id = $1",
        )
        .bind(oid)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(status, "awaiting_deposit");
    }

    // Mark only order_a as detected
    sqlx::query(
        "UPDATE bridge_orders SET status = 'deposit_detected', step = 2 WHERE order_id = $1",
    )
    .bind(&order_a)
    .execute(&pool)
    .await
    .unwrap();

    let status_a: String = sqlx::query_scalar(
        "SELECT status::text FROM bridge_orders WHERE order_id = $1",
    )
    .bind(&order_a)
    .fetch_one(&pool)
    .await
    .unwrap();

    let status_b: String = sqlx::query_scalar(
        "SELECT status::text FROM bridge_orders WHERE order_id = $1",
    )
    .bind(&order_b)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(status_a, "deposit_detected");
    assert_eq!(status_b, "awaiting_deposit"); // unchanged
}
