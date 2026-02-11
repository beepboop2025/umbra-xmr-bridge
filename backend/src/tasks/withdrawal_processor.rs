use anyhow::{anyhow, Result};
use chrono::Utc;

use crate::models::order::{BridgeOrder, OrderStatus};
use crate::AppState;

/// Process a withdrawal for an order that has reached the `Bridging` status.
///
/// This is **not** a background loop; it is invoked per-order, typically
/// spawned from `confirmation_checker` when an order becomes fully confirmed.
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

    if order.status != OrderStatus::Bridging {
        return Err(anyhow!(
            "Order {order_id} is not in Bridging state (current: {:?})",
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

    // TODO: Submit the unsigned withdrawal transaction to the MPC coordinator.
    //       1. Build the raw transaction for the destination chain
    //          (amount = to_amount, recipient = dest_address).
    //       2. Call mpc::coordinator::request_threshold_signature(tx_bytes).
    //       3. Wait for t-of-n partial signatures to arrive.
    //       4. Combine partial signatures into a valid transaction.
    //
    // For now this is a placeholder that succeeds immediately.

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

    // TODO: Broadcast the signed transaction on the destination chain.
    //       Match on order.dest_chain:
    //         "XMR" -> monero_rpc.submit_transfer(signed_tx)
    //         "BTC" -> bitcoin_rpc.sendrawtransaction(signed_tx)
    //         "ETH"/"ARB"/"BASE" -> eth_sendRawTransaction(signed_tx)
    //         "TON" -> ton_client.send_boc(signed_tx)
    //         "SOL" -> solana_client.sendTransaction(signed_tx)
    //       Return the resulting tx hash.
    //
    // Placeholder: return a dummy hash.
    let placeholder_hash = format!("0x{}", hex::encode(&order.order_id.as_bytes()[..16.min(order.order_id.len())]));
    Ok(placeholder_hash)
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

    let result = sqlx::query(
        r#"
        INSERT INTO audit_log (action, entity_type, entity_id, details, actor, prev_hash, content_hash, created_at)
        VALUES ($1, 'bridge_order', $2, $3, 'system', '', '', $4)
        "#,
    )
    .bind(action)
    .bind(&order.order_id)
    .bind(&details)
    .bind(Utc::now())
    .execute(&state.db)
    .await;

    if let Err(e) = result {
        tracing::warn!(error = %e, "withdrawal_processor: failed to write audit log");
    }
}
