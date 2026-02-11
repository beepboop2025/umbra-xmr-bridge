use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MpcKeyCeremony {
    pub id: Uuid,
    pub chain: String,
    pub threshold: i16,
    pub total_signers: i16,
    pub group_public_key: Option<String>,
    pub status: String,
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MpcSignatureRequest {
    pub id: Uuid,
    pub order_id: Uuid,
    pub chain: String,
    pub tx_data_hash: String,
    pub shares_received: i16,
    pub shares_required: i16,
    pub status: String,
    pub final_signature: Option<String>,
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}
