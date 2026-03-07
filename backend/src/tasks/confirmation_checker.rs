use std::time::Duration;

use chrono::Utc;
use serde::Deserialize;
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
                    // Optimistic locking: only update if status matches what we read.
                    let rows_affected = sqlx::query(
                        r#"
                        UPDATE bridge_orders
                           SET status = $1,
                               step = $2,
                               confirmations_current = $3,
                               confirmations_required = $4,
                               updated_at = $5
                         WHERE id = $6 AND status = $7
                        "#,
                    )
                    .bind(&new_status)
                    .bind(new_status.step())
                    .bind(current)
                    .bind(required)
                    .bind(Utc::now())
                    .bind(order.id)
                    .bind(&order.status)
                    .execute(&state.db)
                    .await?
                    .rows_affected();

                    if rows_affected == 0 {
                        tracing::debug!(
                            order_id = %order.order_id,
                            "confirmation_checker: order status changed concurrently, skipping"
                        );
                        continue;
                    }

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
                        // Trigger withdrawal processing — use a DB lock to prevent
                        // double-spawning if the checker runs again before the
                        // withdrawal processor transitions the order out of Bridging.
                        let state2 = state.clone();
                        let oid = order.order_id.clone();
                        tokio::spawn(async move {
                            // Atomically claim the order for withdrawal processing
                            let claimed = sqlx::query(
                                "UPDATE bridge_orders SET status = 'signing', updated_at = NOW() \
                                 WHERE order_id = $1 AND status = 'bridging' RETURNING id",
                            )
                            .bind(&oid)
                            .fetch_optional(&state2.db)
                            .await;

                            match claimed {
                                Ok(Some(_)) => {
                                    if let Err(e) =
                                        crate::tasks::withdrawal_processor::process_withdrawal(state2, oid)
                                            .await
                                    {
                                        tracing::error!(error = %e, "withdrawal processing failed");
                                    }
                                }
                                Ok(None) => {
                                    tracing::debug!(order_id = %oid, "withdrawal already claimed by another process");
                                }
                                Err(e) => {
                                    tracing::error!(error = %e, "failed to claim order for withdrawal");
                                }
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
    state: &AppState,
    order: &BridgeOrder,
) -> anyhow::Result<i32> {
    let tx_hash = order
        .deposit_tx_hash
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("no deposit_tx_hash for order {}", order.order_id))?;

    if tx_hash.is_empty() {
        return Ok(0);
    }

    match order.source_chain.to_uppercase().as_str() {
        "XMR" => {
            // Monero: get_transfer_by_txid returns a `transfer` object with `confirmations`.
            let resp = state
                .monero_rpc
                .get_transfer_by_txid(tx_hash)
                .await?;
            Ok(resp.confirmations as i32)
        }
        "BTC" => {
            // Bitcoin: gettransaction returns JSON with `confirmations` field.
            let resp = state
                .bitcoin_rpc
                .get_transaction(tx_hash)
                .await?;
            Ok(resp.confirmations as i32)
        }
        "ETH" | "ARB" | "BASE" | "USDC" | "USDT" => {
            // EVM: getTransactionReceipt for block number, then compare with latest block.
            let upper = order.source_chain.to_uppercase();
            let chain = match upper.as_str() {
                "USDC" | "USDT" => "ETH", // stablecoins on mainnet
                c => c,
            };
            match state.evm_rpc.get_confirmations(chain, tx_hash).await {
                Ok(confs) => Ok(confs as i32),
                Err(e) => {
                    tracing::warn!(chain = %chain, tx = %tx_hash, error = %e, "EVM confirmation fetch failed");
                    Ok(order.confirmations_current) // retain current on transient failure
                }
            }
        }
        "TON" => {
            // TON: check transaction via API — finalized transactions have high lt values.
            // TON finalizes in ~5s, so if receipt exists the tx is final.
            match state.ton_client.get_transaction(tx_hash).await {
                Ok(tx) => {
                    // TON transactions are final once included in a block.
                    // Use 1 confirmation if found, required is typically 1.
                    Ok(if tx.is_some() { 1 } else { 0 })
                }
                Err(e) => {
                    tracing::warn!(tx = %tx_hash, error = %e, "TON confirmation fetch failed");
                    Ok(order.confirmations_current)
                }
            }
        }
        "SOL" => {
            // Solana: getSignatureStatuses returns confirmations or finalized status.
            match state.solana_rpc.get_signature_status(tx_hash).await {
                Ok(status) => Ok(status.confirmations.unwrap_or(0) as i32),
                Err(e) => {
                    tracing::warn!(tx = %tx_hash, error = %e, "Solana confirmation fetch failed");
                    Ok(order.confirmations_current)
                }
            }
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
