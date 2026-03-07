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
    state: &AppState,
    order: &BridgeOrder,
) -> anyhow::Result<Option<String>> {
    let deposit_address = match &order.deposit_address {
        Some(addr) => addr.as_str(),
        None => {
            tracing::warn!(order_id = %order.order_id, "no deposit_address set");
            return Ok(None);
        }
    };

    let expected_amount = order.from_amount;

    match order.source_chain.to_uppercase().as_str() {
        "XMR" => {
            // Query Monero wallet-RPC for incoming transfers to the deposit subaddress.
            // The deposit_address maps to a specific subaddress index stored in order metadata.
            let subaddr_index: u32 = order
                .metadata
                .get("subaddr_index")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;

            let transfers = state.monero_rpc.get_transfers(0, &[subaddr_index]).await?;
            for tx in &transfers {
                // Monero amounts are in piconero (1 XMR = 1e12 piconero)
                let xmr_amount = rust_decimal::Decimal::from_i128_with_scale(tx.amount as i128, 12);
                if xmr_amount >= expected_amount && tx.address == deposit_address {
                    tracing::info!(
                        order_id = %order.order_id,
                        tx_hash = %tx.txid,
                        amount = %xmr_amount,
                        confirmations = tx.confirmations,
                        "XMR deposit found"
                    );
                    return Ok(Some(tx.txid.clone()));
                }
            }
            Ok(None)
        }
        "BTC" => {
            // Query Bitcoin Core RPC for unspent outputs at the deposit address.
            let utxos = state.bitcoin_rpc.list_unspent(0, 9999, &[deposit_address]).await?;
            for utxo in &utxos {
                let btc_amount = rust_decimal::Decimal::from_str_exact(&utxo.amount.to_string())
                    .unwrap_or_default();
                if btc_amount >= expected_amount {
                    tracing::info!(
                        order_id = %order.order_id,
                        tx_hash = %utxo.txid,
                        amount = %btc_amount,
                        "BTC deposit found"
                    );
                    return Ok(Some(utxo.txid.clone()));
                }
            }
            Ok(None)
        }
        "ETH" | "ARB" | "BASE" | "USDC" | "USDT" => {
            // For native ETH: check balance via eth_getBalance.
            // For ERC-20 (USDC/USDT): check Transfer event logs via eth_getLogs.
            let chain = order.source_chain.to_uppercase();
            let is_erc20 = chain == "USDC" || chain == "USDT";

            if is_erc20 {
                // Check ERC-20 Transfer events to deposit_address
                let logs = state.evm_rpc.get_erc20_transfer_logs(
                    &chain, deposit_address, None
                ).await?;
                for log in &logs {
                    if log.value >= expected_amount {
                        tracing::info!(
                            order_id = %order.order_id,
                            tx_hash = %log.tx_hash,
                            "ERC-20 deposit found on {}", chain
                        );
                        return Ok(Some(log.tx_hash.clone()));
                    }
                }
            } else {
                // Check native ETH/ARB/BASE balance
                let balance = state.evm_rpc.get_balance(&chain, deposit_address).await?;
                if balance >= expected_amount {
                    // Get the latest transaction to this address for the tx_hash
                    let txs = state.evm_rpc.get_internal_txs(&chain, deposit_address, 1).await?;
                    if let Some(tx) = txs.first() {
                        tracing::info!(
                            order_id = %order.order_id,
                            tx_hash = %tx.hash,
                            "EVM native deposit found on {}", chain
                        );
                        return Ok(Some(tx.hash.clone()));
                    }
                }
            }
            Ok(None)
        }
        "TON" => {
            // Query TON Center for transactions to the deposit address.
            let txs = state.ton_client.get_transactions(deposit_address, 10).await?;
            for tx in &txs {
                // TON values are in nanoton (1 TON = 1e9)
                let value: u64 = tx.value.parse().unwrap_or_else(|_| {
                    tracing::warn!(order_id = %order.order_id, raw_value = %tx.value, "Failed to parse TON value");
                    0
                });
                if value == 0 {
                    continue;
                }
                let ton_amount = rust_decimal::Decimal::from_i128_with_scale(value as i128, 9);
                if ton_amount >= expected_amount && tx.destination == deposit_address {
                    tracing::info!(
                        order_id = %order.order_id,
                        tx_hash = %tx.hash,
                        amount = %ton_amount,
                        "TON deposit found"
                    );
                    return Ok(Some(tx.hash.clone()));
                }
            }
            Ok(None)
        }
        "SOL" => {
            // Check Solana balance for the deposit address via getBalance RPC.
            let balance = state.solana_rpc.get_balance(deposit_address).await?;
            // Solana amounts are in lamports (1 SOL = 1e9 lamports)
            let sol_amount = rust_decimal::Decimal::from_i128_with_scale(balance as i128, 9);
            if sol_amount >= expected_amount {
                // Get recent signatures to find the deposit tx hash
                let sigs = state.solana_rpc.get_signatures_for_address(deposit_address, 1).await?;
                if let Some(sig) = sigs.first() {
                    tracing::info!(
                        order_id = %order.order_id,
                        tx_hash = %sig.signature,
                        amount = %sol_amount,
                        "SOL deposit found"
                    );
                    return Ok(Some(sig.signature.clone()));
                }
            }
            Ok(None)
        }
        other => {
            tracing::warn!(chain = %other, "deposit_monitor: unsupported chain");
            Ok(None)
        }
    }
}
