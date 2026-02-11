use futures::stream::Stream;
use futures::StreamExt;
use redis::aio::ConnectionManager;

use crate::error::AppResult;

// ---------------------------------------------------------------------------
// Publishing (uses the shared ConnectionManager)
// ---------------------------------------------------------------------------

/// Publish an order status update to channel `order:{order_id}`.
pub async fn publish_order_update(
    conn: &mut ConnectionManager,
    order_id: &str,
    data: serde_json::Value,
) -> AppResult<()> {
    let channel = format!("order:{order_id}");
    let payload = serde_json::to_string(&data)?;

    redis::cmd("PUBLISH")
        .arg(&channel)
        .arg(&payload)
        .query_async::<_, i64>(conn)
        .await?;

    tracing::debug!(channel = %channel, "Published order update");
    Ok(())
}

/// Publish a rate update to the `rates` channel.
pub async fn publish_rate_update(
    conn: &mut ConnectionManager,
    data: serde_json::Value,
) -> AppResult<()> {
    let payload = serde_json::to_string(&data)?;

    redis::cmd("PUBLISH")
        .arg("rates")
        .arg(&payload)
        .query_async::<_, i64>(conn)
        .await?;

    tracing::debug!("Published rate update");
    Ok(())
}

// ---------------------------------------------------------------------------
// Subscribing (creates a NEW redis connection -- can't reuse ConnectionManager
// for pubsub because it enters a special subscription mode)
// ---------------------------------------------------------------------------

/// Subscribe to a single order's channel and return a stream of JSON strings.
pub async fn subscribe_order(
    redis_url: &str,
    order_id: &str,
) -> AppResult<impl Stream<Item = String>> {
    let channel = format!("order:{order_id}");
    subscribe_channel(redis_url, &channel).await
}

/// Subscribe to the global `rates` channel and return a stream of JSON strings.
pub async fn subscribe_rates(
    redis_url: &str,
) -> AppResult<impl Stream<Item = String>> {
    subscribe_channel(redis_url, "rates").await
}

/// Internal: open a fresh Redis connection, SUBSCRIBE to `channel`, and wrap
/// the incoming messages as an async `Stream<Item = String>`.
///
/// In redis 0.25 the pubsub API uses `Client::get_async_pubsub()` which
/// returns a dedicated `PubSub` handle (not a multiplexed connection).
async fn subscribe_channel(
    redis_url: &str,
    channel: &str,
) -> AppResult<impl Stream<Item = String>> {
    let client = redis::Client::open(redis_url)
        .map_err(|e| crate::error::AppError::Internal(format!("Redis client error: {e}")))?;

    let mut pubsub = client
        .get_async_pubsub()
        .await
        .map_err(|e| crate::error::AppError::Internal(format!("Redis pubsub error: {e}")))?;

    pubsub
        .subscribe(channel)
        .await
        .map_err(|e| crate::error::AppError::Internal(format!("Redis subscribe error: {e}")))?;

    let stream = pubsub.into_on_message().filter_map(|msg| async move {
        msg.get_payload::<String>().ok()
    });

    Ok(stream)
}
