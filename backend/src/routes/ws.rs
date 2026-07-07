use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures::stream::StreamExt;
use futures::SinkExt;

use crate::services::pubsub;
use crate::AppState;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/ws/order/:order_id", get(ws_order))
        .route("/v1/ws/rates", get(ws_rates))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// Upgrade to WebSocket and subscribe to a single order's Redis pubsub channel.
async fn ws_order(
    State(state): State<AppState>,
    Path(order_id): Path<String>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let redis_url = state.config.redis_url.clone();
    ws.on_upgrade(move |socket| handle_order_ws(socket, redis_url, order_id))
}

/// Upgrade to WebSocket and subscribe to the global rates Redis pubsub channel.
async fn ws_rates(
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let redis_url = state.config.redis_url.clone();
    ws.on_upgrade(move |socket| handle_rates_ws(socket, redis_url))
}

// ---------------------------------------------------------------------------
// WebSocket loop for a specific order
// ---------------------------------------------------------------------------

async fn handle_order_ws(socket: WebSocket, redis_url: String, order_id: String) {
    metrics::counter!("ws_connections_total", "kind" => "order").increment(1);
    tracing::info!(order_id = %order_id, "WebSocket connected for order");

    let (mut sender, mut receiver) = socket.split();

    // Subscribe to Redis pubsub for this order
    let sub_stream = match pubsub::subscribe_order(&redis_url, &order_id).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, "Failed to subscribe to order channel");
            let _ = sender.send(Message::Close(None)).await;
            return;
        }
    };

    // Pin the stream on the heap so it can be polled across await points.
    let mut sub_stream = Box::pin(sub_stream);

    // Drive both the Redis subscription and the WebSocket client concurrently.
    // When either side finishes (client disconnect or subscription end) we exit.
    loop {
        tokio::select! {
            // Forward Redis pubsub messages to the WebSocket client
            redis_msg = sub_stream.next() => {
                match redis_msg {
                    Some(payload) => {
                        if sender.send(Message::Text(payload)).await.is_err() {
                            break; // client disconnected
                        }
                    }
                    None => break, // subscription ended
                }
            }
            // Read from client (handle close / pong frames)
            ws_msg = receiver.next() => {
                match ws_msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {} // ignore text/binary/ping/pong from client
                }
            }
        }
    }

    metrics::counter!("ws_disconnections_total", "kind" => "order").increment(1);
    tracing::info!(order_id = %order_id, "WebSocket disconnected for order");
}

// ---------------------------------------------------------------------------
// WebSocket loop for rate broadcasts
// ---------------------------------------------------------------------------

async fn handle_rates_ws(socket: WebSocket, redis_url: String) {
    metrics::counter!("ws_connections_total", "kind" => "rates").increment(1);
    tracing::info!("WebSocket connected for rates");

    let (mut sender, mut receiver) = socket.split();

    let sub_stream = match pubsub::subscribe_rates(&redis_url).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, "Failed to subscribe to rates channel");
            let _ = sender.send(Message::Close(None)).await;
            return;
        }
    };

    let mut sub_stream = Box::pin(sub_stream);

    loop {
        tokio::select! {
            redis_msg = sub_stream.next() => {
                match redis_msg {
                    Some(payload) => {
                        if sender.send(Message::Text(payload)).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
            ws_msg = receiver.next() => {
                match ws_msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }

    metrics::counter!("ws_disconnections_total", "kind" => "rates").increment(1);
    tracing::info!("WebSocket disconnected for rates");
}
