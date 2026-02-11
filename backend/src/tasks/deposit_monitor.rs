use std::time::Duration;

use chrono::Utc;
use tokio::time;

use crate::models::order::{BridgeOrder, OrderStatus};
use crate::AppState;

/// Background task that polls for orders awaiting a deposit and checks the
/// source chain for incoming funds.
///
/// Runs every **30 seconds**.
pub async fn run(state: AppState) {
    let mut interval = time::interval(Duration::from_secs(30));

    loop {
        interval.tick().await;

        if let Err(e) = poll_deposits(&state).await {
            tracing::error!(error = %e, "deposit_monitor: poll cycle failed");
        }
    }
}

async fn poll_deposits(state: &AppState) -> anyhow::Result<()> {
    let orders: Vec<BridgeOrder> = sqlx::query_as::<_, BridgeOrder>(
        r#"
        SELECT *
          FROM bridge_orders
         WHERE status = 'awaiting_deposit'
         ORDER BY created_at ASC
         LIMIT 100
        "#,
    )
    .fetch_all(&state.db)
    .await?;

    if orders.is_empty() {
        return Ok(());
    }

    tracing::debug!(count = orders.len(), "deposit_monitor: checking orders");

    for order in &orders {
        match check_deposit(state, order).await {
            Ok(Some(tx_hash)) => {
                tracing::info!(
                    order_id = %order.order_id,
                    tx_hash = %tx_hash,
                    "deposit_monitor: deposit detected"
                );

                sqlx::query(
                    r#"
                    UPDATE bridge_orders
                       SET status = 'deposit_detected',
                           step = $1,
                           deposit_tx_hash = $2,
                           updated_at = $3
                     WHERE id = $4
                       AND status = 'awaiting_deposit'
                    "#,
                )
                .bind(OrderStatus::DepositDetected.step())
                .bind(&tx_hash)
                .bind(Utc::now())
                .bind(order.id)
                .execute(&state.db)
                .await?;

                metrics::counter!("bridge.deposits_detected").increment(1);
            }
            Ok(None) => {
                // No deposit yet -- nothing to do.
            }
            Err(e) => {
                tracing::warn!(
                    order_id = %order.order_id,
                    chain = %order.source_chain,
                    error = %e,
                    "deposit_monitor: failed to check deposit"
                );
            }
        }
    }

    Ok(())
}

/// Check the source chain for an incoming deposit to `order.deposit_address`.
///
/// Returns `Ok(Some(tx_hash))` when a deposit is found, `Ok(None)` otherwise.
async fn check_deposit(
    _state: &AppState,
    order: &BridgeOrder,
) -> anyhow::Result<Option<String>> {
    let _deposit_address = match &order.deposit_address {
        Some(addr) => addr.as_str(),
        None => {
            tracing::warn!(order_id = %order.order_id, "no deposit_address set");
            return Ok(None);
        }
    };

    match order.source_chain.to_uppercase().as_str() {
        "XMR" => {
            // TODO: Call monero_rpc `get_transfers` for deposit_address.
            //       Parse response for incoming transfer matching from_amount.
            //       Return tx_hash if found.
            tracing::debug!(order_id = %order.order_id, "XMR deposit check (stub)");
            Ok(None)
        }
        "BTC" => {
            // TODO: Call bitcoin_rpc `listtransactions` / `listunspent`
            //       for the deposit address.
            tracing::debug!(order_id = %order.order_id, "BTC deposit check (stub)");
            Ok(None)
        }
        "ETH" | "ARB" | "BASE" | "USDC" | "USDT" => {
            // TODO: Call EVM JSON-RPC `eth_getBalance` or check ERC-20
            //       `Transfer` events to deposit_address via `eth_getLogs`.
            //       Use the appropriate RPC URL from config based on chain.
            tracing::debug!(
                order_id = %order.order_id,
                chain = %order.source_chain,
                "EVM deposit check (stub)"
            );
            Ok(None)
        }
        "TON" => {
            // TODO: Call TON Center `getTransactions` for deposit_address.
            //       Look for incoming value transfer >= from_amount.
            tracing::debug!(order_id = %order.order_id, "TON deposit check (stub)");
            Ok(None)
        }
        "SOL" => {
            // TODO: Call Solana `getBalance` or `getSignaturesForAddress`
            //       on the deposit address.
            tracing::debug!(order_id = %order.order_id, "SOL deposit check (stub)");
            Ok(None)
        }
        other => {
            tracing::warn!(chain = %other, "deposit_monitor: unsupported chain");
            Ok(None)
        }
    }
}
