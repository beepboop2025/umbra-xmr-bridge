//! Public proof-layer endpoints.
//!
//! Everything here is intentionally unauthenticated: the whole point is that
//! outsiders can hold the bridge accountable. Nothing in these responses is
//! sensitive — receipts carry a *hash* of the destination address, and the
//! transparency log exposes only audit-entry hashes.

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::services::attestation_service::{self, canonical_json};
use crate::services::{sentinel, transparency};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/proof/key", get(proof_key))
        .route("/v1/proof/receipt/:order_id", get(order_receipts))
        .route("/v1/proof/checkpoint/latest", get(latest_checkpoint))
        .route("/v1/proof/checkpoints", get(list_checkpoints))
        .route("/v1/proof/inclusion/:audit_id", get(inclusion))
        .route("/v1/proof/consistency", get(consistency))
        .route("/v1/proof/audit/verify", get(verify_chain))
        .route("/v1/proof/canary", get(canary))
        .route("/v1/proof/status", get(status))
}

// ---------------------------------------------------------------------------
// Key discovery
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct KeyResponse {
    algorithm: &'static str,
    public_key: String,
    key_id: String,
    pq_algorithm: Option<&'static str>,
    pq_public_key: Option<String>,
    pq_key_id: Option<String>,
    pq_context: Option<&'static str>,
    receipt_version: &'static str,
    canonicalization: &'static str,
    usage: &'static str,
}

async fn proof_key(State(state): State<AppState>) -> Json<KeyResponse> {
    metrics::counter!("http_requests_total", "endpoint" => "proof_key").increment(1);
    let att = &state.attestation;
    Json(KeyResponse {
        algorithm: "ed25519",
        public_key: att.public_key_hex(),
        key_id: att.key_id().to_string(),
        pq_algorithm: att.pq_enabled().then_some("ml-dsa-65 (FIPS 204)"),
        pq_public_key: att.pq_public_key_hex().map(str::to_string),
        pq_key_id: att.pq_key_id().map(str::to_string),
        pq_context: att.pq_enabled().then_some("umbra-proof-v1"),
        receipt_version: attestation_service::RECEIPT_VERSION,
        canonicalization: "JSON, UTF-8, keys sorted lexicographically, no whitespace",
        usage: "Verify receipt.payload and checkpoint tree heads. Pin these keys out-of-band. \
                Both signatures cover the same canonical bytes; ML-DSA protects the archive \
                against a future quantum adversary.",
    })
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct ReceiptEnvelope {
    payload: serde_json::Value,
    payload_canonical: String,
    payload_hash: String,
    signature: String,
    public_key: String,
    key_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    signature_pq: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pq_public_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pq_key_id: Option<String>,
}

#[derive(Serialize)]
struct ReceiptsResponse {
    order_id: String,
    count: usize,
    receipts: Vec<ReceiptEnvelope>,
    verify_hint: &'static str,
}

async fn order_receipts(
    State(state): State<AppState>,
    Path(order_id): Path<String>,
) -> AppResult<Json<ReceiptsResponse>> {
    metrics::counter!("http_requests_total", "endpoint" => "proof_receipts").increment(1);

    let rows = attestation_service::receipts_for_order(&state.db, &order_id).await?;
    let receipts = rows
        .into_iter()
        .map(|a| ReceiptEnvelope {
            payload_canonical: canonical_json(&a.payload),
            payload: a.payload,
            payload_hash: a.payload_hash,
            signature: a.signature,
            public_key: a.public_key,
            key_id: a.key_id,
            signature_pq: a.signature_pq,
            pq_public_key: a.pq_public_key,
            pq_key_id: a.pq_key_id,
        })
        .collect::<Vec<_>>();

    Ok(Json(ReceiptsResponse {
        order_id,
        count: receipts.len(),
        receipts,
        verify_hint:
            "ed25519_verify(public_key, payload_canonical, signature); \
             each payload.prev_receipt_hash must equal the previous receipt's payload_hash",
    }))
}

// ---------------------------------------------------------------------------
// Transparency log
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct CheckpointEnvelope {
    checkpoint: transparency::Checkpoint,
    tree_head_canonical: String,
}

async fn latest_checkpoint(
    State(state): State<AppState>,
) -> AppResult<Json<CheckpointEnvelope>> {
    metrics::counter!("http_requests_total", "endpoint" => "proof_checkpoint").increment(1);

    let cp = transparency::latest_checkpoint(&state.db)
        .await?
        .ok_or_else(|| crate::error::AppError::NotFound("No checkpoint sealed yet".into()))?;

    let head = transparency::tree_head_payload(
        cp.tree_size,
        &cp.root_hash,
        &cp.prev_root_hash,
        &cp.key_id,
        &cp.sealed_at,
    );
    Ok(Json(CheckpointEnvelope {
        tree_head_canonical: canonical_json(&head),
        checkpoint: cp,
    }))
}

#[derive(Deserialize)]
struct ListQuery {
    #[serde(default = "default_list_limit")]
    limit: i64,
}

fn default_list_limit() -> i64 {
    20
}

async fn list_checkpoints(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> AppResult<Json<Vec<transparency::Checkpoint>>> {
    metrics::counter!("http_requests_total", "endpoint" => "proof_checkpoints").increment(1);
    Ok(Json(transparency::list_checkpoints(&state.db, q.limit).await?))
}

async fn inclusion(
    State(state): State<AppState>,
    Path(audit_id): Path<i64>,
) -> AppResult<Json<transparency::InclusionProofResponse>> {
    metrics::counter!("http_requests_total", "endpoint" => "proof_inclusion").increment(1);
    Ok(Json(transparency::inclusion_proof(&state.db, audit_id).await?))
}

#[derive(Deserialize)]
struct ConsistencyQuery {
    old_size: i64,
    new_size: i64,
}

async fn consistency(
    State(state): State<AppState>,
    Query(q): Query<ConsistencyQuery>,
) -> AppResult<Json<transparency::ConsistencyProofResponse>> {
    metrics::counter!("http_requests_total", "endpoint" => "proof_consistency").increment(1);
    Ok(Json(
        transparency::consistency_proof(&state.db, q.old_size, q.new_size).await?,
    ))
}

async fn verify_chain(
    State(state): State<AppState>,
) -> AppResult<Json<transparency::ChainAuditReport>> {
    metrics::counter!("http_requests_total", "endpoint" => "proof_audit_verify").increment(1);
    Ok(Json(transparency::verify_audit_chain(&state.db).await?))
}

// ---------------------------------------------------------------------------
// Canary + sentinel status
// ---------------------------------------------------------------------------

async fn canary(State(state): State<AppState>) -> AppResult<Json<transparency::Canary>> {
    metrics::counter!("http_requests_total", "endpoint" => "proof_canary").increment(1);
    Ok(Json(
        transparency::canary(&state.db, &state.attestation, &state.config.canary_statement)
            .await?,
    ))
}

#[derive(Serialize)]
struct StatusResponse {
    accepting_orders: bool,
    paused: Option<sentinel::PauseState>,
    recent_events: Vec<sentinel::SentinelEvent>,
}

async fn status(State(state): State<AppState>) -> AppResult<Json<StatusResponse>> {
    metrics::counter!("http_requests_total", "endpoint" => "proof_status").increment(1);

    let paused = sentinel::pause_state(&state.redis).await;
    let recent_events = sentinel::recent_events(&state.db, 10).await.unwrap_or_default();

    Ok(Json(StatusResponse {
        accepting_orders: paused.is_none(),
        paused,
        recent_events,
    }))
}
