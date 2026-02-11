use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;

use crate::error::AppResult;
use crate::AppState;

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    db: &'static str,
    redis: &'static str,
    version: &'static str,
}

/// Build the health check router.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health_check))
        .route("/ready", get(readiness_check))
}

/// Liveness probe: always returns 200 with component status.
async fn health_check(
    State(state): State<AppState>,
) -> Json<HealthResponse> {
    let db_ok = check_db(&state).await;
    let redis_ok = check_redis(&state).await;

    let overall = if db_ok && redis_ok { "healthy" } else { "degraded" };

    Json(HealthResponse {
        status: overall,
        db: if db_ok { "connected" } else { "disconnected" },
        redis: if redis_ok { "connected" } else { "disconnected" },
        version: VERSION,
    })
}

/// Readiness probe: returns 200 only when ALL backing services are reachable.
/// k8s will stop routing traffic to a pod that fails this check.
async fn readiness_check(
    State(state): State<AppState>,
) -> AppResult<Json<HealthResponse>> {
    let db_ok = check_db(&state).await;
    let redis_ok = check_redis(&state).await;

    if !db_ok || !redis_ok {
        return Err(crate::error::AppError::Internal(
            "Backing service unavailable".into(),
        ));
    }

    Ok(Json(HealthResponse {
        status: "ready",
        db: "connected",
        redis: "connected",
        version: VERSION,
    }))
}

/// Run `SELECT 1` against the Postgres pool.
async fn check_db(state: &AppState) -> bool {
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.db)
        .await
        .is_ok()
}

/// Run `PING` against the Redis connection manager.
async fn check_redis(state: &AppState) -> bool {
    let mut conn = state.redis.clone();
    redis::cmd("PING")
        .query_async::<_, String>(&mut conn)
        .await
        .is_ok()
}
