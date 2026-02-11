use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AuditLog {
    pub id: i64,
    pub action: String,
    pub entity_type: String,
    pub entity_id: Option<String>,
    pub details: serde_json::Value,
    pub actor: String,
    pub ip_address: Option<String>,
    pub prev_hash: String,
    pub content_hash: String,
    pub created_at: DateTime<Utc>,
}
