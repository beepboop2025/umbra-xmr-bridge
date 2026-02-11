use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq)]
#[sqlx(type_name = "order_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum OrderStatus {
    Created,
    AwaitingDeposit,
    DepositDetected,
    Confirming,
    Bridging,
    Signing,
    Sending,
    Completed,
    Failed,
    Refunding,
    Refunded,
    Expired,
}

impl OrderStatus {
    pub fn step(&self) -> i16 {
        match self {
            Self::Created => 0,
            Self::AwaitingDeposit => 1,
            Self::DepositDetected => 2,
            Self::Confirming => 3,
            Self::Bridging => 4,
            Self::Signing => 5,
            Self::Sending => 6,
            Self::Completed => 7,
            Self::Failed => -1,
            Self::Refunding => -2,
            Self::Refunded => -3,
            Self::Expired => -4,
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Refunded | Self::Expired)
    }

    /// Returns valid next states from this state.
    pub fn valid_transitions(&self) -> &[OrderStatus] {
        match self {
            Self::Created => &[Self::AwaitingDeposit, Self::Expired, Self::Failed],
            Self::AwaitingDeposit => &[Self::DepositDetected, Self::Expired, Self::Failed],
            Self::DepositDetected => &[Self::Confirming, Self::Failed],
            Self::Confirming => &[Self::Bridging, Self::Failed],
            Self::Bridging => &[Self::Signing, Self::Failed],
            Self::Signing => &[Self::Sending, Self::Failed],
            Self::Sending => &[Self::Completed, Self::Failed],
            Self::Completed => &[],
            Self::Failed => &[Self::Refunding],
            Self::Refunding => &[Self::Refunded, Self::Failed],
            Self::Refunded => &[],
            Self::Expired => &[],
        }
    }

    pub fn can_transition_to(&self, next: &OrderStatus) -> bool {
        self.valid_transitions().contains(next)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct BridgeOrder {
    pub id: Uuid,
    pub order_id: String,
    pub direction: String,
    pub source_chain: String,
    pub dest_chain: String,
    pub from_amount: rust_decimal::Decimal,
    pub from_currency: String,
    pub to_amount: rust_decimal::Decimal,
    pub to_currency: String,
    pub dest_address: String,
    pub deposit_address: Option<String>,
    pub rate_at_creation: rust_decimal::Decimal,
    pub fee: rust_decimal::Decimal,
    pub fee_percent: rust_decimal::Decimal,
    pub min_received: Option<rust_decimal::Decimal>,
    pub slippage: rust_decimal::Decimal,
    pub status: OrderStatus,
    pub step: i16,
    pub deposit_tx_hash: Option<String>,
    pub withdrawal_tx_hash: Option<String>,
    pub confirmations_current: i32,
    pub confirmations_required: i32,
    pub telegram_user_id: Option<i64>,
    pub ip_address: Option<String>,
    pub error_message: Option<String>,
    pub metadata: serde_json::Value,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Required confirmations per chain.
pub fn confirmations_for_chain(chain: &str) -> i32 {
    match chain.to_uppercase().as_str() {
        "XMR" => 10,
        "BTC" => 3,
        "ETH" => 12,
        "TON" => 1,
        "SOL" => 32,
        "ARB" => 1,
        "BASE" => 1,
        "USDC" | "USDT" => 12, // ERC-20 on Ethereum
        _ => 12,
    }
}
