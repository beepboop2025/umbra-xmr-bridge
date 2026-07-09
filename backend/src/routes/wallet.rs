//! Saved destination addresses for the dashboard (`/api/wallet/*`).
//!
//! A no-KYC bridge has no user accounts, so addresses are scoped to an
//! anonymous per-browser id: the frontend generates a random token in
//! localStorage and sends it as `X-Client-Id`. No PII, no login. An absent or
//! malformed header yields an empty list rather than leaking another browser's
//! saved addresses.

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::routing::{delete, get};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/wallet/addresses", get(list).post(create))
        .route("/v1/wallet/addresses/:id", delete(remove))
}

const CLIENT_HEADER: &str = "x-client-id";

/// Validate and extract the anonymous client id. Restricted to a sane
/// alphanumeric/hyphen token so it can't be abused as an injection vector or
/// unbounded key.
fn client_id(headers: &HeaderMap) -> Option<String> {
    headers
        .get(CLIENT_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| {
            (8..=128).contains(&s.len())
                && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
}

#[derive(sqlx::FromRow, Serialize)]
struct SavedAddress {
    id: String, // uuid rendered as text
    chain: String,
    address: String,
    label: String,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct ListResponse {
    addresses: Vec<SavedAddress>,
}

async fn list(State(state): State<AppState>, headers: HeaderMap) -> AppResult<Json<ListResponse>> {
    let Some(cid) = client_id(&headers) else {
        return Ok(Json(ListResponse { addresses: vec![] }));
    };
    let rows = sqlx::query_as::<_, SavedAddress>(
        "SELECT id::text AS id, chain, address, label, created_at FROM saved_addresses \
         WHERE client_id = $1 ORDER BY created_at DESC",
    )
    .bind(&cid)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(ListResponse { addresses: rows }))
}

#[derive(Deserialize)]
struct CreateReq {
    chain: String,
    address: String,
    #[serde(default)]
    label: String,
}

async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateReq>,
) -> AppResult<Json<SavedAddress>> {
    let cid =
        client_id(&headers).ok_or_else(|| AppError::BadRequest("Missing or invalid X-Client-Id".into()))?;
    let chain = req.chain.trim();
    let address = req.address.trim();
    let label = req.label.trim();
    if chain.is_empty() || address.is_empty() {
        return Err(AppError::BadRequest("chain and address are required".into()));
    }
    if chain.len() > 16 || address.len() > 256 || label.len() > 64 {
        return Err(AppError::BadRequest("field too long".into()));
    }
    let row = sqlx::query_as::<_, SavedAddress>(
        "INSERT INTO saved_addresses (client_id, chain, address, label) \
         VALUES ($1, $2, $3, $4) \
         RETURNING id::text AS id, chain, address, label, created_at",
    )
    .bind(&cid)
    .bind(chain.to_uppercase())
    .bind(address)
    .bind(label)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(row))
}

async fn remove(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let cid =
        client_id(&headers).ok_or_else(|| AppError::BadRequest("Missing or invalid X-Client-Id".into()))?;
    let uid = uuid::Uuid::parse_str(&id).map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let res = sqlx::query("DELETE FROM saved_addresses WHERE id = $1 AND client_id = $2")
        .bind(uid)
        .bind(&cid)
        .execute(&state.db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("address not found".into()));
    }
    Ok(Json(serde_json::json!({ "deleted": true })))
}
