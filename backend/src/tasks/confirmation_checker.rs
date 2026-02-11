use std::time::Duration;

use chrono::Utc;
use tokio::time;

use crate::models::order::{confirmations_for_chain, BridgeOrder, OrderStatus};
use crate::AppState;

/// Background task that tracks confirmation progress for deposits that have
/// been detected but are not yet fully confirmed.
///
/// Runs every **60 seconds**.
pub async fn run(state: AppState) {
    let mut interval = time::interval(Duration::from_secs(60));

    loop {
        interval.tick().await;

        if let Err(e) = poll_confirmations(&state).await {
            tracing::error!(error = %e, "confirmation_checker: poll cycle failed");
        }
    }
}

async fn poll_confirmations(state: &AppState) -> anyhow::Result<()> {
    let orders: Vec<BridgeOrder> = sqlx::query_as::<_, BridgeOrder>(
        r#"
        SELECT *
          FROM bridge_orders
         WHERE status IN ('deposit_detected', 'confirming')
         ORDER BY created_at ASC
         LIMIT 200
        "#,
    )
    .fetch_all(&state.db)
    .await?;

    if orders.is_empty() {
        return Ok(());
    }

    tracing::debug!(count = orders.len(), "confirmation_checker: checking orders");

    for order in &orders {
        match fetch_confirmations(state, order).await {
            Ok(current) => {
                let required = confirmations_for_chain(&order.source_chain);

                // Determine new status
                let new_status = if current >= required {
                    OrderStatus::Bridging
                } else if order.status == OrderStatus::DepositDetected {
                    // First confirmation seen -- move to confirming
                    OrderStatus::Confirming
                } else {
                    // Still confirming -- just update the count
                    OrderStatus::Confirming
                };

                let status_changed = new_status != order.status || current != order.confirmations_current;

                if status_changed {
                    sqlx::query(
                        r#"
                        UPDATE bridge_orders
                           SET status = $1,
                               step = $2,
                               confirmations_current = $3,
                               confirmations_required = $4,
                               updated_at = $5
                         WHERE id = $6
                        "#,
                    )
                    .bind(&new_status)
                    .bind(new_status.step())
                    .bind(current)
                    .bind(required)
                    .bind(Utc::now())
                    .bind(order.id)
                    .execute(&state.db)
                    .await?;

                    tracing::info!(
                        order_id = %order.order_id,
                        confirmations = %current,
                        required = %required,
                        status = ?new_status,
                        "confirmation_checker: updated"
                    );

                    // Publish status update via Redis pubsub
                    publish_status_update(state, &order.order_id, &new_status, current, required)
                        .await;

                    if new_status == OrderStatus::Bridging {
                        metrics::counter!("bridge.orders_confirmed").increment(1);
                        // Trigger withdrawal processing
                        let state2 = state.clone();
                        let oid = order.order_id.clone();
                        tokio::spawn(async move {
                            if let Err(e) =
                                crate::tasks::withdrawal_processor::process_withdrawal(state2, oid)
                                    .await
                            {
                                tracing::error!(error = %e, "withdrawal processing failed");
                            }
                        });
                    }
                }
            }
            Err(e) => {
                tracing::warn!(
                    order_id = %order.order_id,
                    chain = %order.source_chain,
                    error = %e,
                    "confirmation_checker: failed to fetch confirmations"
                );
            }
        }
    }

    Ok(())
}

/// Fetch the current number of confirmations for a deposit transaction.
async fn fetch_confirmations(
    _state: &AppState,
    order: &BridgeOrder,
) -> anyhow::Result<i32> {
    let _tx_hash = order
        .deposit_tx_hash
        .as_deref()
        .unwrap_or_default();

    match order.source_chain.to_uppercase().as_str() {
        "XMR" => {
            // TODO: Call monero_rpc `get_transfer_by_txid` and read
            //       the `confirmations` field from the response.
            Ok(order.confirmations_current)
        }
        "BTC" => {
            // TODO: Call bitcoin_rpc `gettransaction` with the tx_hash
            //       and read the `confirmations` field.
            Ok(order.confirmations_current)
        }
        "ETH" | "ARB" | "BASE" | "USDC" | "USDT" => {
            // TODO: Call `eth_getTransactionReceipt`, get block number,
            //       compare with `eth_blockNumber` to derive confirmations.
            Ok(order.confirmations_current)
        }
        "TON" => {
            // TODO: Call TON API to check transaction finality.
            Ok(order.confirmations_current)
        }
        "SOL" => {
            // TODO: Call Solana `getSignatureStatuses` for the tx_hash,
            //       check `confirmations` field.
            Ok(order.confirmations_current)
        }
        other => {
            tracing::warn!(chain = %other, "confirmation_checker: unsupported chain");
            Ok(0)
        }
    }
}

/// Publish a status update to Redis pub/sub so WebSocket clients are notified.
async fn publish_status_update(
    state: &AppState,
    order_id: &str,
    status: &OrderStatus,
    current: i32,
    required: i32,
) {
    let payload = serde_json::json!({
        "order_id": order_id,
        "status": status,
        "confirmations_current": current,
        "confirmations_required": required,
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
        tracing::warn!(error = %e, "confirmation_checker: failed to publish status update");
    }
}
