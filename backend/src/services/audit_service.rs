use sha2::{Digest, Sha256};

use crate::error::AppResult;

/// Append a tamper-evident entry to the audit log hash chain.
///
/// Each entry's `content_hash` is SHA-256 of:
///   action + entity_type + entity_id + details_json + actor + prev_hash
///
/// `prev_hash` is the `content_hash` of the most recent audit row, or a
/// sentinel zero-hash for the first entry.
pub async fn log(
    db: &crate::db::Pool,
    action: &str,
    entity_type: &str,
    entity_id: Option<&str>,
    details: serde_json::Value,
    actor: &str,
) -> AppResult<()> {
    // Fetch previous hash (most recent entry)
    #[derive(sqlx::FromRow)]
    struct HashRow {
        content_hash: String,
    }

    let prev_hash = sqlx::query_as::<_, HashRow>(
        "SELECT content_hash FROM audit_logs ORDER BY id DESC LIMIT 1",
    )
    .fetch_optional(db)
    .await?
    .map(|r| r.content_hash)
    .unwrap_or_else(|| "0".repeat(64)); // genesis sentinel

    // Build the content string and hash it
    let details_json = serde_json::to_string(&details).unwrap_or_default();
    let entity_id_str = entity_id.unwrap_or("");

    let content = format!(
        "{action}{entity_type}{entity_id_str}{details_json}{actor}{prev_hash}"
    );

    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let content_hash = hex::encode(hasher.finalize());

    sqlx::query(
        "INSERT INTO audit_logs (action, entity_type, entity_id, details, actor, prev_hash, content_hash, created_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())",
    )
    .bind(action)
    .bind(entity_type)
    .bind(entity_id)
    .bind(&details)
    .bind(actor)
    .bind(&prev_hash)
    .bind(&content_hash)
    .execute(db)
    .await?;

    tracing::info!(
        action = action,
        entity = entity_type,
        entity_id = entity_id_str,
        "Audit log entry created"
    );

    Ok(())
}
