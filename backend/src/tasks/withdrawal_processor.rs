use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use rust_decimal::prelude::ToPrimitive;

use crate::models::order::{BridgeOrder, OrderStatus};
use crate::AppState;

/// Background loop: pick up orders that have reached `Bridging` (deposit fully
/// confirmed) and drive them through signing + broadcast. Each order is claimed
/// atomically (`bridging` -> `signing`) so overlapping iterations can never
/// double-spend one order.
pub async fn run(state: AppState) {
    let poll = std::time::Duration::from_secs(10);
    loop {
        tokio::time::sleep(poll).await;

        let ids = match sqlx::query_scalar::<_, String>(
            "SELECT order_id FROM bridge_orders WHERE status = 'bridging' \
             ORDER BY updated_at ASC LIMIT 20",
        )
        .fetch_all(&state.db)
        .await
        {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(error = %e, "withdrawal_processor: poll failed");
                continue;
            }
        };

        for order_id in ids {
            // Atomic claim — only one worker transitions this order.
            let claimed = sqlx::query(
                "UPDATE bridge_orders SET status = 'signing', step = $1, updated_at = NOW() \
                 WHERE order_id = $2 AND status = 'bridging'",
            )
            .bind(OrderStatus::Signing.step())
            .bind(&order_id)
            .execute(&state.db)
            .await;

            match claimed {
                Ok(r) if r.rows_affected() == 1 => {
                    let st = state.clone();
                    tokio::spawn(async move {
                        if let Err(e) = process_withdrawal(st, order_id.clone()).await {
                            tracing::error!(order_id = %order_id, error = %e, "withdrawal_processor: failed");
                        }
                    });
                }
                Ok(_) => {} // claimed elsewhere
                Err(e) => tracing::error!(order_id = %order_id, error = %e, "withdrawal_processor: claim failed"),
            }
        }
    }
}

/// Process a withdrawal for an order that has reached `Bridging`/`Signing`.
///
/// Invoked per-order by `run` once a deposit is fully confirmed.
///
/// Lifecycle: Bridging -> Signing -> Sending -> Completed
///            (on error, any intermediate state -> Failed)
pub async fn process_withdrawal(state: AppState, order_id: String) -> Result<()> {
    tracing::info!(order_id = %order_id, "withdrawal_processor: starting");

    // ------------------------------------------------------------------
    // 1. Fetch the order and validate its current status
    // ------------------------------------------------------------------
    let order: BridgeOrder = sqlx::query_as::<_, BridgeOrder>(
        "SELECT * FROM bridge_orders WHERE order_id = $1",
    )
    .bind(&order_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| anyhow!("Order {order_id} not found"))?;

    // The order should be in Signing state (set by confirmation_checker when claiming).
    // Also accept Bridging for backwards compatibility.
    if order.status != OrderStatus::Signing && order.status != OrderStatus::Bridging {
        return Err(anyhow!(
            "Order {order_id} is not in Signing/Bridging state (current: {:?})",
            order.status
        ));
    }

    // ------------------------------------------------------------------
    // 2. Transition to Signing — submit to MPC coordinator
    // ------------------------------------------------------------------
    if let Err(e) = transition_to_signing(&state, &order).await {
        fail_order(&state, &order, &format!("signing failed: {e}")).await;
        return Err(e);
    }

    // ------------------------------------------------------------------
    // 3. Transition to Sending — broadcast signed transaction
    // ------------------------------------------------------------------
    let withdrawal_tx_hash = match broadcast_transaction(&state, &order).await {
        Ok(tx) => tx,
        Err(e) => {
            fail_order(&state, &order, &format!("broadcast failed: {e}")).await;
            return Err(e);
        }
    };

    // ------------------------------------------------------------------
    // 4. Transition to Completed
    // ------------------------------------------------------------------
    sqlx::query(
        r#"
        UPDATE bridge_orders
           SET status = 'completed',
               step = $1,
               withdrawal_tx_hash = $2,
               updated_at = $3
         WHERE id = $4
        "#,
    )
    .bind(OrderStatus::Completed.step())
    .bind(&withdrawal_tx_hash)
    .bind(Utc::now())
    .bind(order.id)
    .execute(&state.db)
    .await?;

    tracing::info!(
        order_id = %order_id,
        tx_hash = %withdrawal_tx_hash,
        "withdrawal_processor: completed"
    );
    metrics::counter!("bridge.withdrawals_completed").increment(1);

    // Publish completion event
    publish_event(&state, &order_id, "completed", Some(&withdrawal_tx_hash)).await;

    // Log audit entry
    log_audit(&state, &order, "withdrawal_completed", None).await;

    Ok(())
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async fn transition_to_signing(state: &AppState, order: &BridgeOrder) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE bridge_orders
           SET status = 'signing',
               step = $1,
               updated_at = $2
         WHERE id = $3
        "#,
    )
    .bind(OrderStatus::Signing.step())
    .bind(Utc::now())
    .bind(order.id)
    .execute(&state.db)
    .await?;

    tracing::info!(order_id = %order.order_id, "withdrawal_processor: signing");
    publish_event(state, &order.order_id, "signing", None).await;

    // Build a deterministic request id from the order to prevent replay.
    let request_id = format!("sign-{}", order.order_id);

    // Construct the unsigned transaction payload for the destination chain.
    // This is the data that will be threshold-signed by the MPC signers.
    let tx_payload = serde_json::json!({
        "order_id": order.order_id,
        "dest_chain": order.dest_chain,
        "dest_address": order.dest_address,
        "amount": order.to_amount.to_string(),
        "currency": order.to_currency,
    });
    let tx_bytes = serde_json::to_vec(&tx_payload)
        .context("failed to serialize withdrawal tx payload")?;

    tracing::info!(
        order_id = %order.order_id,
        dest_chain = %order.dest_chain,
        dest_address = %order.dest_address,
        amount = %order.to_amount,
        "Submitting to MPC coordinator for threshold signing"
    );

    // 1. Request a signing session from the MPC coordinator.
    {
        let mut coordinator = state.mpc_coordinator.lock().await;
        coordinator
            .request_signing(request_id.clone(), &tx_bytes)
            .await
            .context("MPC coordinator: failed to open signing session")?;
    }

    // 2. Wait for t-of-n shares to arrive.
    //    In production, signers submit shares asynchronously via a separate
    //    endpoint. Here we poll the session until it reaches `Complete` or
    //    a timeout (5 minutes) is hit.
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(300);
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

        let coordinator = state.mpc_coordinator.lock().await;
        if let Some(session) = coordinator.get_session(&request_id) {
            match session.status {
                crate::mpc::coordinator::SessionStatus::Complete => {
                    tracing::info!(
                        order_id = %order.order_id,
                        shares = session.shares.len(),
                        "MPC signing complete"
                    );
                    break;
                }
                crate::mpc::coordinator::SessionStatus::Failed => {
                    return Err(anyhow!("MPC signing session failed for order {}", order.order_id));
                }
                crate::mpc::coordinator::SessionStatus::Pending => {
                    // Still waiting for shares.
                }
            }
        }

        if tokio::time::Instant::now() >= deadline {
            // Timeout: mark session as failed.
            let mut coordinator = state.mpc_coordinator.lock().await;
            coordinator.fail_session(&request_id);
            return Err(anyhow!(
                "MPC signing timed out after 5 minutes for order {}",
                order.order_id
            ));
        }
    }

    // Store signed_tx reference in order metadata for the broadcast step.
    sqlx::query(
        r#"
        UPDATE bridge_orders
           SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{mpc_request_id}', to_jsonb($1::text)),
               updated_at = $2
         WHERE id = $3
        "#,
    )
    .bind(&request_id)
    .bind(Utc::now())
    .bind(order.id)
    .execute(&state.db)
    .await?;

    Ok(())
}

async fn broadcast_transaction(state: &AppState, order: &BridgeOrder) -> Result<String> {
    sqlx::query(
        r#"
        UPDATE bridge_orders
           SET status = 'sending',
               step = $1,
               updated_at = $2
         WHERE id = $3
        "#,
    )
    .bind(OrderStatus::Sending.step())
    .bind(Utc::now())
    .bind(order.id)
    .execute(&state.db)
    .await?;

    tracing::info!(order_id = %order.order_id, "withdrawal_processor: broadcasting");
    publish_event(state, &order.order_id, "sending", None).await;

    let dest_chain = order.dest_chain.to_uppercase();
    let dest_address = &order.dest_address;
    let amount = order.to_amount;

    tracing::info!(
        order_id = %order.order_id,
        dest_chain = %dest_chain,
        dest_address = %dest_address,
        amount = %amount,
        "Broadcasting withdrawal transaction"
    );

    let tx_hash = match dest_chain.as_str() {
        "XMR" => {
            // Monero: transfer via wallet-RPC.
            // Convert Decimal amount to piconero (1 XMR = 1e12 piconero).
            let piconero = (amount * rust_decimal::Decimal::new(1_000_000_000_000, 0))
                .to_u64()
                .ok_or_else(|| anyhow!("XMR amount overflow: {amount}"))?;

            let result = state
                .monero_rpc
                .transfer(dest_address, piconero, 2) // priority=2 (normal)
                .await
                .context("Monero transfer RPC failed")?;

            tracing::info!(
                order_id = %order.order_id,
                tx_hash = %result.tx_hash,
                fee = result.fee,
                "XMR withdrawal broadcast"
            );
            result.tx_hash
        }

        "BTC" => {
            // Bitcoin: send to address via Bitcoin Core wallet.
            let btc_amount = amount
                .to_f64()
                .ok_or_else(|| anyhow!("BTC amount conversion failed: {amount}"))?;

            let txid = state
                .bitcoin_rpc
                .send_to_address(dest_address, btc_amount)
                .await
                .context("Bitcoin sendtoaddress RPC failed")?;

            tracing::info!(
                order_id = %order.order_id,
                tx_hash = %txid,
                "BTC withdrawal broadcast"
            );
            txid
        }

        "ETH" | "ARB" | "BASE" => {
            // EVM chains: broadcast pre-signed raw transaction.
            // The signed tx hex is stored in order metadata by the signing step.
            let signed_tx = order
                .metadata
                .get("signed_tx_hex")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("Missing signed_tx_hex in order metadata for EVM broadcast"))?;

            let tx_hash = state
                .evm_rpc
                .send_raw_transaction(&dest_chain, signed_tx)
                .await
                .context(format!("{dest_chain} sendRawTransaction failed"))?;

            tracing::info!(
                order_id = %order.order_id,
                tx_hash = %tx_hash,
                chain = %dest_chain,
                "EVM withdrawal broadcast"
            );
            tx_hash
        }

        "TON" => {
            // TON: broadcast a signed bag-of-cells (BOC).
            let boc = order
                .metadata
                .get("signed_boc")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("Missing signed_boc in order metadata for TON broadcast"))?;

            let result = state
                .ton_client
                .send_boc(boc)
                .await
                .context("TON sendBoc failed")?;

            tracing::info!(
                order_id = %order.order_id,
                tx_hash = %result.hash,
                "TON withdrawal broadcast"
            );
            result.hash
        }

        "SOL" => {
            // Solana: send a base64-encoded signed transaction.
            let signed_tx = order
                .metadata
                .get("signed_tx_base64")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("Missing signed_tx_base64 in order metadata for SOL broadcast"))?;

            let signature = state
                .solana_rpc
                .send_transaction(signed_tx)
                .await
                .context("Solana sendTransaction failed")?;

            tracing::info!(
                order_id = %order.order_id,
                tx_hash = %signature,
                "SOL withdrawal broadcast"
            );
            signature
        }

        other => {
            return Err(anyhow!(
                "Unsupported destination chain for withdrawal: {other}"
            ));
        }
    };

    metrics::counter!("bridge.withdrawal_broadcasts", "chain" => dest_chain.clone()).increment(1);

    Ok(tx_hash)
}

async fn fail_order(state: &AppState, order: &BridgeOrder, reason: &str) {
    tracing::error!(
        order_id = %order.order_id,
        reason = %reason,
        "withdrawal_processor: order failed"
    );

    let result = sqlx::query(
        r#"
        UPDATE bridge_orders
           SET status = 'failed',
               step = $1,
               error_message = $2,
               updated_at = $3
         WHERE id = $4
        "#,
    )
    .bind(OrderStatus::Failed.step())
    .bind(reason)
    .bind(Utc::now())
    .bind(order.id)
    .execute(&state.db)
    .await;

    if let Err(e) = result {
        tracing::error!(error = %e, "withdrawal_processor: failed to update order to failed");
    }

    metrics::counter!("bridge.withdrawals_failed").increment(1);
    publish_event(state, &order.order_id, "failed", None).await;
    log_audit(state, order, "withdrawal_failed", Some(reason)).await;
}

async fn publish_event(
    state: &AppState,
    order_id: &str,
    status: &str,
    tx_hash: Option<&str>,
) {
    let payload = serde_json::json!({
        "order_id": order_id,
        "status": status,
        "withdrawal_tx_hash": tx_hash,
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
        tracing::warn!(error = %e, "withdrawal_processor: failed to publish event");
    }
}

async fn log_audit(
    state: &AppState,
    order: &BridgeOrder,
    action: &str,
    error: Option<&str>,
) {
    let details = serde_json::json!({
        "order_id": order.order_id,
        "source_chain": order.source_chain,
        "dest_chain": order.dest_chain,
        "to_amount": order.to_amount.to_string(),
        "dest_address": order.dest_address,
        "error": error,
    });

    if let Err(e) = crate::services::audit_service::log(
        &state.db,
        action,
        "bridge_order",
        Some(&order.order_id),
        details,
        "system",
    )
    .await
    {
        tracing::warn!(error = %e, "withdrawal_processor: failed to write audit log");
    }
}
