//! Transparency log: Certificate-Transparency-style checkpoints over the
//! audit hash-chain.
//!
//! The audit log already chains entries with SHA-256, which makes *internal*
//! tampering detectable — but only by someone with database access. The
//! transparency log closes that gap for everyone else: a background task
//! periodically seals the audit log into a signed Merkle tree head
//! ("checkpoint"). From then on:
//!
//! * an **inclusion proof** shows a specific audit entry is committed to by a
//!   checkpoint (log₂ n hashes, verifiable offline);
//! * a **consistency proof** between any two checkpoints shows the newer one
//!   is a pure append-only extension of the older — history was not rewritten.
//!
//! Checkpoints are Ed25519-signed with the same key as swap receipts, so a
//! single published public key anchors the whole proof layer. Anyone mirroring
//! `/v1/proof/checkpoint/latest` on a schedule becomes an external witness the
//! operator cannot silently contradict.

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::services::attestation_service::{canonical_json, AttestationService};
use crate::utils::merkle;

pub const CHECKPOINT_VERSION: &str = "1";
const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Checkpoint {
    pub id: i64,
    pub tree_size: i64,
    pub root_hash: String,
    pub prev_root_hash: String,
    pub signature: String,
    pub public_key: String,
    pub key_id: String,
    pub sealed_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
pub struct InclusionProofResponse {
    pub audit_id: i64,
    pub leaf_index: u64,
    pub leaf_data: String,
    pub leaf_hash: String,
    pub tree_size: i64,
    pub root_hash: String,
    pub proof: Vec<String>,
    pub checkpoint: Checkpoint,
    pub verified: bool,
}

#[derive(Debug, Serialize)]
pub struct ConsistencyProofResponse {
    pub old_tree_size: i64,
    pub new_tree_size: i64,
    pub old_root_hash: String,
    pub new_root_hash: String,
    pub proof: Vec<String>,
    pub verified: bool,
}

/// The canonical, signed representation of a tree head. Verifiers rebuild
/// exactly this object (sorted keys, compact JSON) and check the signature.
pub fn tree_head_payload(
    tree_size: i64,
    root_hash: &str,
    prev_root_hash: &str,
    key_id: &str,
    sealed_at: &chrono::DateTime<chrono::Utc>,
) -> serde_json::Value {
    serde_json::json!({
        "version": CHECKPOINT_VERSION,
        "log_id": "umbra-audit-v1",
        "tree_size": tree_size,
        "root_hash": root_hash,
        "prev_root_hash": prev_root_hash,
        "key_id": key_id,
        "sealed_at": sealed_at.to_rfc3339_opts(chrono::SecondsFormat::Micros, true),
    })
}

/// Load the first `limit` audit leaves in log order. Leaf data is the
/// `content_hash` hex string (as bytes), so the Merkle tree commits to the
/// entire hash-chain including its linkage.
async fn load_leaves(db: &crate::db::Pool, limit: i64) -> AppResult<Vec<Vec<u8>>> {
    #[derive(sqlx::FromRow)]
    struct Row {
        content_hash: String,
    }
    let rows = sqlx::query_as::<_, Row>(
        "SELECT content_hash FROM audit_log ORDER BY id ASC LIMIT $1",
    )
    .bind(limit)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(|r| r.content_hash.into_bytes()).collect())
}

pub async fn latest_checkpoint(db: &crate::db::Pool) -> AppResult<Option<Checkpoint>> {
    let cp = sqlx::query_as::<_, Checkpoint>(
        "SELECT * FROM transparency_checkpoints ORDER BY tree_size DESC LIMIT 1",
    )
    .fetch_optional(db)
    .await?;
    Ok(cp)
}

pub async fn list_checkpoints(db: &crate::db::Pool, limit: i64) -> AppResult<Vec<Checkpoint>> {
    let rows = sqlx::query_as::<_, Checkpoint>(
        "SELECT * FROM transparency_checkpoints ORDER BY tree_size DESC LIMIT $1",
    )
    .bind(limit.clamp(1, 100))
    .fetch_all(db)
    .await?;
    Ok(rows)
}

async fn checkpoint_by_size(db: &crate::db::Pool, tree_size: i64) -> AppResult<Checkpoint> {
    sqlx::query_as::<_, Checkpoint>(
        "SELECT * FROM transparency_checkpoints WHERE tree_size = $1",
    )
    .bind(tree_size)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("No checkpoint with tree_size {tree_size}")))
}

/// Seal a new checkpoint if the audit log has grown since the last one.
/// Returns the new checkpoint, or None if there was nothing new to seal.
pub async fn seal(
    db: &crate::db::Pool,
    service: &AttestationService,
) -> AppResult<Option<Checkpoint>> {
    #[derive(sqlx::FromRow)]
    struct CountRow {
        count: Option<i64>,
    }
    let count = sqlx::query_as::<_, CountRow>("SELECT COUNT(*) AS count FROM audit_log")
        .fetch_one(db)
        .await?
        .count
        .unwrap_or(0);

    let last = latest_checkpoint(db).await?;
    let (last_size, prev_root) = match &last {
        Some(cp) => (cp.tree_size, cp.root_hash.clone()),
        None => (0, GENESIS_HASH.to_string()),
    };

    if count <= last_size {
        return Ok(None);
    }

    let leaves = load_leaves(db, count).await?;
    // The audit log is append-only under a BIGSERIAL id, so the first `count`
    // rows in id order are stable even if new rows land while we compute.
    let tree_size = leaves.len() as i64;
    if tree_size <= last_size {
        return Ok(None);
    }

    let root = merkle::root(&leaves);
    let root_hash = merkle::hash_to_hex(&root);
    let sealed_at = chrono::Utc::now();

    let payload = tree_head_payload(tree_size, &root_hash, &prev_root, service.key_id(), &sealed_at);
    let (_hash, signature) = service.sign_json(&payload);

    let cp = sqlx::query_as::<_, Checkpoint>(
        r#"
        INSERT INTO transparency_checkpoints
            (tree_size, root_hash, prev_root_hash, signature, public_key, key_id, sealed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (tree_size) DO NOTHING
        RETURNING *
        "#,
    )
    .bind(tree_size)
    .bind(&root_hash)
    .bind(&prev_root)
    .bind(&signature)
    .bind(service.public_key_hex())
    .bind(service.key_id())
    .bind(sealed_at)
    .fetch_optional(db)
    .await?;

    if let Some(ref c) = cp {
        tracing::info!(tree_size = c.tree_size, root = %c.root_hash, "transparency: sealed checkpoint");
        metrics::counter!("transparency_checkpoints_sealed_total").increment(1);
        metrics::gauge!("transparency_tree_size").set(c.tree_size as f64);
    }
    Ok(cp)
}

/// Build an inclusion proof for a specific audit entry against the newest
/// checkpoint that covers it.
pub async fn inclusion_proof(
    db: &crate::db::Pool,
    audit_id: i64,
) -> AppResult<InclusionProofResponse> {
    #[derive(sqlx::FromRow)]
    struct AuditRow {
        content_hash: String,
    }
    let entry = sqlx::query_as::<_, AuditRow>(
        "SELECT content_hash FROM audit_log WHERE id = $1",
    )
    .bind(audit_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Audit entry {audit_id} not found")))?;

    // Position of this entry in log order.
    #[derive(sqlx::FromRow)]
    struct PosRow {
        pos: Option<i64>,
    }
    let leaf_index = sqlx::query_as::<_, PosRow>(
        "SELECT COUNT(*) AS pos FROM audit_log WHERE id < $1",
    )
    .bind(audit_id)
    .fetch_one(db)
    .await?
    .pos
    .unwrap_or(0);

    let checkpoint = latest_checkpoint(db)
        .await?
        .ok_or_else(|| AppError::NotFound("No checkpoint sealed yet".into()))?;

    if leaf_index >= checkpoint.tree_size {
        return Err(AppError::Conflict(format!(
            "Audit entry {audit_id} is newer than the latest checkpoint (tree_size {}); \
             it will be covered by the next seal",
            checkpoint.tree_size
        )));
    }

    let leaves = load_leaves(db, checkpoint.tree_size).await?;
    let proof = merkle::inclusion_proof(&leaves, leaf_index as usize)
        .ok_or_else(|| AppError::Internal("Failed to build inclusion proof".into()))?;

    let leaf = merkle::leaf_hash(entry.content_hash.as_bytes());
    let root = merkle::hex_to_hash(&checkpoint.root_hash)
        .ok_or_else(|| AppError::Internal("Corrupt checkpoint root hash".into()))?;
    let verified = merkle::verify_inclusion(
        &leaf,
        leaf_index as u64,
        checkpoint.tree_size as u64,
        &proof,
        &root,
    );

    Ok(InclusionProofResponse {
        audit_id,
        leaf_index: leaf_index as u64,
        leaf_data: entry.content_hash.clone(),
        leaf_hash: merkle::hash_to_hex(&leaf),
        tree_size: checkpoint.tree_size,
        root_hash: checkpoint.root_hash.clone(),
        proof: proof.iter().map(merkle::hash_to_hex).collect(),
        checkpoint,
        verified,
    })
}

/// Consistency proof between two sealed checkpoints, proving the log is
/// append-only between them.
pub async fn consistency_proof(
    db: &crate::db::Pool,
    old_size: i64,
    new_size: i64,
) -> AppResult<ConsistencyProofResponse> {
    if old_size <= 0 || new_size < old_size {
        return Err(AppError::BadRequest(
            "require 0 < old_size <= new_size".into(),
        ));
    }
    let old_cp = checkpoint_by_size(db, old_size).await?;
    let new_cp = checkpoint_by_size(db, new_size).await?;

    let leaves = load_leaves(db, new_size).await?;
    let proof = merkle::consistency_proof(&leaves, old_size as usize)
        .ok_or_else(|| AppError::Internal("Failed to build consistency proof".into()))?;

    let old_root = merkle::hex_to_hash(&old_cp.root_hash)
        .ok_or_else(|| AppError::Internal("Corrupt checkpoint root hash".into()))?;
    let new_root = merkle::hex_to_hash(&new_cp.root_hash)
        .ok_or_else(|| AppError::Internal("Corrupt checkpoint root hash".into()))?;

    let verified = merkle::verify_consistency(
        old_size as u64,
        new_size as u64,
        &old_root,
        &new_root,
        &proof,
    );

    Ok(ConsistencyProofResponse {
        old_tree_size: old_size,
        new_tree_size: new_size,
        old_root_hash: old_cp.root_hash,
        new_root_hash: new_cp.root_hash,
        proof: proof.iter().map(merkle::hash_to_hex).collect(),
        verified,
    })
}

/// Walk the full audit hash-chain server-side and report the first break, if
/// any. This is a convenience for operators; external parties should rely on
/// checkpoints + proofs instead.
#[derive(Debug, Serialize)]
pub struct ChainAuditReport {
    pub entries_checked: i64,
    pub intact: bool,
    pub first_broken_id: Option<i64>,
}

pub async fn verify_audit_chain(db: &crate::db::Pool) -> AppResult<ChainAuditReport> {
    use sha2::{Digest, Sha256};

    #[derive(sqlx::FromRow)]
    struct Row {
        id: i64,
        action: String,
        entity_type: String,
        entity_id: Option<String>,
        details: serde_json::Value,
        actor: String,
        prev_hash: String,
        content_hash: String,
    }

    let rows = sqlx::query_as::<_, Row>(
        "SELECT id, action, entity_type, entity_id, details, actor, prev_hash, content_hash \
         FROM audit_log ORDER BY id ASC",
    )
    .fetch_all(db)
    .await?;

    let mut expected_prev = GENESIS_HASH.to_string();
    for row in &rows {
        if row.prev_hash != expected_prev {
            return Ok(ChainAuditReport {
                entries_checked: rows.len() as i64,
                intact: false,
                first_broken_id: Some(row.id),
            });
        }
        let details_json = serde_json::to_string(&row.details).unwrap_or_default();
        let entity_id = row.entity_id.as_deref().unwrap_or("");
        let content = format!(
            "{}|{}|{}|{}|{}|{}",
            row.action, row.entity_type, entity_id, details_json, row.actor, row.prev_hash
        );
        let recomputed = hex::encode(Sha256::digest(content.as_bytes()));
        if recomputed != row.content_hash {
            return Ok(ChainAuditReport {
                entries_checked: rows.len() as i64,
                intact: false,
                first_broken_id: Some(row.id),
            });
        }
        expected_prev = row.content_hash.clone();
    }

    Ok(ChainAuditReport {
        entries_checked: rows.len() as i64,
        intact: true,
        first_broken_id: None,
    })
}

/// Signed canary: a freshness-bound statement that the operator has not been
/// compelled to act against its users. It embeds the latest checkpoint root
/// (so it cannot be replayed against a rewound log) and the current time (so
/// staleness is meaningful). A canary that stops updating is itself a signal.
#[derive(Debug, Serialize)]
pub struct Canary {
    pub statement: String,
    pub issued_at: String,
    pub latest_root_hash: String,
    pub latest_tree_size: i64,
    pub key_id: String,
    pub public_key: String,
    pub signature: String,
}

pub async fn canary(
    db: &crate::db::Pool,
    service: &AttestationService,
    statement: &str,
) -> AppResult<Canary> {
    let (root, size) = match latest_checkpoint(db).await? {
        Some(cp) => (cp.root_hash, cp.tree_size),
        None => (GENESIS_HASH.to_string(), 0),
    };
    let issued_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, true);

    let payload = serde_json::json!({
        "version": "1",
        "type": "canary",
        "statement": statement,
        "issued_at": issued_at,
        "latest_root_hash": root,
        "latest_tree_size": size,
        "key_id": service.key_id(),
    });
    let canonical = canonical_json(&payload);
    let signature = service.sign(canonical.as_bytes());

    Ok(Canary {
        statement: statement.to_string(),
        issued_at,
        latest_root_hash: root,
        latest_tree_size: size,
        key_id: service.key_id().to_string(),
        public_key: service.public_key_hex(),
        signature,
    })
}
