use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ExchangeRate {
    pub id: Uuid,
    pub direction: String,
    pub rate: rust_decimal::Decimal,
    pub source: String,
    pub created_at: DateTime<Utc>,
}
