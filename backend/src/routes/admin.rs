use axum::extract::{Path, State};
use axum::http::{header, HeaderMap};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::{AdminUser, OrderStatus};
use crate::services::{audit_service, order_service};
use crate::AppState;

// ---------------------------------------------------------------------------
// JWT claims
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,  // username
    pub role: String,
    pub exp: usize,
    pub iat: usize,
}

// ---------------------------------------------------------------------------
// Request / response schemas
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub expires_in: u64,
}

#[derive(Serialize)]
pub struct AdminStatsResponse {
    pub total_orders: i64,
    pub completed_orders: i64,
    pub failed_orders: i64,
    pub pending_orders: i64,
    pub refunded_orders: i64,
    pub total_volume_usd: Decimal,
    pub volume_24h_usd: Decimal,
}

#[derive(Serialize)]
pub struct RefundResponse {
    pub order_id: String,
    pub status: OrderStatus,
    pub message: String,
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/admin/login", post(admin_login))
        .route("/v1/admin/stats", get(admin_stats))
        .route("/v1/admin/order/:order_id/refund", post(admin_refund))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn admin_login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> AppResult<Json<LoginResponse>> {
    metrics::counter!("http_requests_total", "endpoint" => "admin_login").increment(1);

    // Fetch admin user
    let user: AdminUser = sqlx::query_as::<_, AdminUser>(
        "SELECT * FROM admin_users WHERE username = $1 AND is_active = true",
    )
    .bind(&req.username)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Unauthorized("Invalid credentials".into()))?;

    // Verify password with argon2 (using the utils module's verify helper)
    let password_valid = crate::utils::crypto::verify_password(&req.password, &user.password_hash)
        .map_err(|_| AppError::Internal("Password verification failed".into()))?;

    if !password_valid {
        return Err(AppError::Unauthorized("Invalid credentials".into()));
    }

    // Update last_login
    sqlx::query("UPDATE admin_users SET last_login = NOW() WHERE id = $1")
        .bind(user.id)
        .execute(&state.db)
        .await?;

    // Issue JWT
    let expiry_hours = state.config.jwt_expiry_hours;
    let now = Utc::now();
    let exp = (now + Duration::hours(expiry_hours as i64)).timestamp() as usize;
    let iat = now.timestamp() as usize;

    let claims = Claims {
        sub: user.username.clone(),
        role: user.role.clone(),
        exp,
        iat,
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(state.config.secret_key.as_bytes()),
    )?;

    audit_service::log(
        &state.db,
        "admin_login",
        "admin_user",
        Some(&user.id.to_string()),
        serde_json::json!({"username": user.username}),
        &user.username,
    )
    .await?;

    tracing::info!(username = %user.username, "Admin login successful");

    Ok(Json(LoginResponse {
        token,
        expires_in: expiry_hours * 3600,
    }))
}

async fn admin_stats(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<AdminStatsResponse>> {
    metrics::counter!("http_requests_total", "endpoint" => "admin_stats").increment(1);
    let _claims = extract_and_verify_jwt(&state, &headers)?;

    #[derive(sqlx::FromRow)]
    struct StatsRow {
        total_orders: Option<i64>,
        completed_orders: Option<i64>,
        failed_orders: Option<i64>,
        pending_orders: Option<i64>,
        refunded_orders: Option<i64>,
    }

    let stats = sqlx::query_as::<_, StatsRow>(
        r#"
        SELECT
            COUNT(*)                                                AS total_orders,
            COUNT(*) FILTER (WHERE status = 'completed')           AS completed_orders,
            COUNT(*) FILTER (WHERE status = 'failed')              AS failed_orders,
            COUNT(*) FILTER (WHERE status NOT IN ('completed','failed','expired','refunded')) AS pending_orders,
            COUNT(*) FILTER (WHERE status = 'refunded')            AS refunded_orders
        FROM bridge_orders
        "#,
    )
    .fetch_one(&state.db)
    .await?;

    #[derive(sqlx::FromRow)]
    struct VolumeRow {
        total_volume: Option<Decimal>,
        volume_24h: Option<Decimal>,
    }

    let volume = sqlx::query_as::<_, VolumeRow>(
        r#"
        SELECT
            COALESCE(SUM(from_amount), 0) AS total_volume,
            COALESCE(SUM(from_amount) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours'), 0) AS volume_24h
        FROM bridge_orders
        WHERE status = 'completed'
        "#,
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(AdminStatsResponse {
        total_orders: stats.total_orders.unwrap_or(0),
        completed_orders: stats.completed_orders.unwrap_or(0),
        failed_orders: stats.failed_orders.unwrap_or(0),
        pending_orders: stats.pending_orders.unwrap_or(0),
        refunded_orders: stats.refunded_orders.unwrap_or(0),
        total_volume_usd: volume.total_volume.unwrap_or_default(),
        volume_24h_usd: volume.volume_24h.unwrap_or_default(),
    }))
}

async fn admin_refund(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(order_id): Path<String>,
) -> AppResult<Json<RefundResponse>> {
    metrics::counter!("http_requests_total", "endpoint" => "admin_refund").increment(1);
    let claims = extract_and_verify_jwt(&state, &headers)?;

    // Only failed orders can be refunded
    let order = order_service::get_order(&state, &order_id).await?;
    if order.status != OrderStatus::Failed {
        return Err(AppError::Conflict(format!(
            "Order {} is in status {:?}, only failed orders can be refunded",
            order_id, order.status
        )));
    }

    let updated =
        order_service::update_status(&state, &order_id, OrderStatus::Refunding).await?;

    audit_service::log(
        &state.db,
        "admin_refund_initiated",
        "bridge_order",
        Some(&order_id),
        serde_json::json!({"admin": claims.sub, "prev_status": "failed"}),
        &claims.sub,
    )
    .await?;

    tracing::info!(order_id = %order_id, admin = %claims.sub, "Admin initiated refund");

    Ok(Json(RefundResponse {
        order_id: updated.order_id,
        status: updated.status,
        message: "Refund process initiated".into(),
    }))
}

// ---------------------------------------------------------------------------
// JWT extraction / verification
// ---------------------------------------------------------------------------

fn extract_and_verify_jwt(state: &AppState, headers: &HeaderMap) -> AppResult<Claims> {
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::Unauthorized("Missing Authorization header".into()))?;

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or_else(|| AppError::Unauthorized("Invalid Authorization format".into()))?;

    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(state.config.secret_key.as_bytes()),
        &Validation::default(),
    )?;

    Ok(token_data.claims)
}
