use std::time::Duration;

use chrono::Utc;
use tokio::time;

use crate::models::order::OrderStatus;
use crate::AppState;

/// Background task that expires stale orders whose deposit window has elapsed.
///
/// Runs every **5 minutes**.
pub async fn run(state: AppState) {
    let mut interval = time::interval(Duration::from_secs(300));

    loop {
        interval.tick().await;

        if let Err(e) = expire_orders(&state).await {
            tracing::error!(error = %e, "expiry: cycle failed");
        }
    }
}

async fn expire_orders(state: &AppState) -> anyhow::Result<()> {
    let now = Utc::now();

    // Fetch IDs of orders to expire so we can publish notifications.
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"
        SELECT order_id
          FROM bridge_orders
         WHERE status = 'awaiting_deposit'
           AND expires_at < $1
        "#,
    )
    .bind(now)
    .fetch_all(&state.db)
    .await?;

    if rows.is_empty() {
        return Ok(());
    }

    let order_ids: Vec<&str> = rows.iter().map(|(id,)| id.as_str()).collect();

    // Batch-update all matched orders to expired.
    let result = sqlx::query(
        r#"
        UPDATE bridge_orders
           SET status = 'expired',
               step = $1,
               updated_at = $2
         WHERE status = 'awaiting_deposit'
           AND expires_at < $2
        "#,
    )
    .bind(OrderStatus::Expired.step())
    .bind(now)
    .execute(&state.db)
    .await?;

    let expired_count = result.rows_affected();
    tracing::info!(count = %expired_count, "expiry: expired stale orders");
    metrics::counter!("bridge.orders_expired").increment(expired_count);

    // Publish expiry notifications via Redis pub/sub for each order.
    for order_id in &order_ids {
        publish_expiry(state, order_id).await;
    }

    Ok(())
}

async fn publish_expiry(state: &AppState, order_id: &str) {
    let payload = serde_json::json!({
        "order_id": order_id,
        "status": "expired",
        "updated_at": chrono::Utc::now(),
    });

    let mut conn = state.redis.clone();
    let channel = format!("order:{order_id}");
    let msg = payload.to_string();

    if let Err(e) = redis::cmd("PUBLISH")
        .arg(&channel)
        .arg(&msg)
        .query_async::<_, String>(&mut conn)
        .await
    {
        tracing::warn!(
            error = %e,
            order_id = %order_id,
            "expiry: failed to publish expiry notification"
        );
    }
}
