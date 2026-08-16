//! Integration tests for risk engine interaction.
//!
//! Tests the risk-related queries and patterns that the risk engine
//! relies on, ensuring the database schema supports all required aggregations.

use chrono::Utc;
use rust_decimal::Decimal;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

mod helpers;
use helpers::*;

/// Verify that exposure queries correctly aggregate pending and in-flight orders.
#[sqlx::test]
async fn exposure_aggregation_by_chain(pool: PgPool) {
    // Create orders across different chains and statuses.
    let _a = create_test_order(&pool, "XMR", "TON", dec(5, 0), dec(500, 0), None).await;
    let b = create_test_order(&pool, "BTC", "ETH", dec(1, 0), dec(15, 0), None).await;
    let c = create_test_order(&pool, "ETH", "XMR", dec(10, 0), dec(3, 0), None).await;

    // Move order b to 'confirming' (in-flight)
    set_order_status(&pool, &b, "confirming", 3).await;
    // Move order c to 'signing' (in-flight)
    set_order_status(&pool, &c, "signing", 5).await;

    // Query pending deposits (awaiting_deposit)
    let pending: Vec<(String, Decimal)> = sqlx::query_as(
        r#"
        SELECT source_chain, COALESCE(SUM(from_amount), 0) AS total
          FROM bridge_orders
         WHERE status IN ('awaiting_deposit', 'deposit_detected')
         GROUP BY source_chain
         ORDER BY source_chain
        "#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    // Only order_a should be in awaiting_deposit (source=XMR)
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].0, "XMR");
    assert_eq!(pending[0].1, dec(5, 0));

    // Query in-flight (confirming, bridging, signing, sending)
    let inflight: Vec<(String, Decimal)> = sqlx::query_as(
        r#"
        SELECT dest_chain, COALESCE(SUM(to_amount), 0) AS total
          FROM bridge_orders
         WHERE status IN ('confirming', 'bridging', 'signing', 'sending')
         GROUP BY dest_chain
         ORDER BY dest_chain
        "#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(inflight.len(), 2);
    // ETH (from order b)
    assert!(inflight.iter().any(|r| r.0 == "ETH" && r.1 == dec(15, 0)));
    // XMR (from order c)
    assert!(inflight.iter().any(|r| r.0 == "XMR" && r.1 == dec(3, 0)));
}

/// Verify daily volume calculation for the risk scorer.
#[sqlx::test]
async fn daily_volume_aggregation(pool: PgPool) {
    // Create 3 orders today
    let _a = create_test_order(&pool, "XMR", "TON", dec(1, 0), dec(100, 0), None).await;
    let _b = create_test_order(&pool, "BTC", "TON", dec(2, 0), dec(200, 0), None).await;
    let _c = create_test_order(&pool, "ETH", "TON", dec(3, 0), dec(300, 0), None).await;

    let day_ago = Utc::now() - chrono::Duration::hours(24);
    let daily_vol: Decimal = sqlx::query_scalar(
        r#"
        SELECT COALESCE(SUM(from_amount), 0)
          FROM bridge_orders
         WHERE created_at >= $1
           AND status NOT IN ('failed', 'expired')
        "#,
    )
    .bind(day_ago)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(daily_vol, dec(6, 0)); // 1 + 2 + 3
}

/// Verify velocity counting per user.
#[sqlx::test]
async fn user_velocity_count(pool: PgPool) {
    let user_id: i64 = 12345;
    let day_ago = Utc::now() - chrono::Duration::hours(24);

    // Create 5 orders for this user
    for _ in 0..5 {
        let id = Uuid::new_v4();
        let order_id = format!("vel_{}", &Uuid::new_v4().simple().to_string()[..12]);
        sqlx::query(
            r#"
            INSERT INTO bridge_orders (
                id, order_id, direction, source_chain, dest_chain,
                from_amount, from_currency, to_amount, to_currency,
                dest_address, rate_at_creation, fee, fee_percent,
                slippage, status, step, metadata, telegram_user_id,
                expires_at, created_at, updated_at
            ) VALUES (
                $1, $2, 'forward', 'XMR', 'TON',
                1.0, 'XMR', 100, 'TON',
                'dest-addr', 1.0, 0.005, 0.3,
                1.0, 'awaiting_deposit', 1, '{}', $3,
                $4, $5, $5
            )
            "#,
        )
        .bind(id)
        .bind(&order_id)
        .bind(user_id)
        .bind(Utc::now() + chrono::Duration::hours(1))
        .bind(Utc::now())
        .execute(&pool)
        .await
        .unwrap();
    }

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bridge_orders WHERE telegram_user_id = $1 AND created_at >= $2",
    )
    .bind(user_id)
    .bind(day_ago)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count, 5);
}

/// Verify destination address history lookup.
#[sqlx::test]
async fn address_history_lookup(pool: PgPool) {
    let dest = "EQNewAddress123";

    // No completed orders to this address
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bridge_orders WHERE dest_address = $1 AND status = 'completed'",
    )
    .bind(dest)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count, 0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn dec(val: i64, scale: u32) -> Decimal {
    Decimal::new(val, scale)
}
