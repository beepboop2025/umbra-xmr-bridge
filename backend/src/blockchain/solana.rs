use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};

// ---------------------------------------------------------------------------
// Public data types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolanaTransaction {
    pub signature: String,
    pub slot: u64,
    #[serde(default)]
    pub block_time: Option<i64>,
    /// `None` when the transaction succeeded; contains an error object otherwise.
    #[serde(default)]
    pub meta_err: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolanaTokenBalance {
    /// The raw token amount as a string (no decimal point).
    pub amount: String,
    pub decimals: u8,
    /// Human-readable amount with decimals applied.
    pub ui_amount: f64,
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/// Solana JSON-RPC client.
pub struct SolanaClient {
    client: Client,
    rpc_url: String,
    req_id: AtomicU64,
}

impl SolanaClient {
    pub fn new(rpc_url: impl Into<String>) -> Self {
        Self {
            client: Client::new(),
            rpc_url: rpc_url.into(),
            req_id: AtomicU64::new(1),
        }
    }

    /// Get the SOL balance for `pubkey` in lamports (1 SOL = 1e9 lamports).
    pub async fn get_balance(&self, pubkey: &str) -> Result<u64> {
        let result = self
            .rpc_call("getBalance", vec![json!(pubkey)])
            .await?;

        let lamports = result
            .get("value")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| anyhow!("getBalance: missing `value` field"))?;

        Ok(lamports)
    }

    /// Fetch a confirmed transaction by its signature.
    pub async fn get_transaction(
        &self,
        signature: &str,
    ) -> Result<Option<SolanaTransaction>> {
        let result = self
            .rpc_call(
                "getTransaction",
                vec![json!(signature), json!({"encoding": "json", "maxSupportedTransactionVersion": 0})],
            )
            .await?;

        if result.is_null() {
            return Ok(None);
        }

        let slot = result
            .get("slot")
            .and_then(|s| s.as_u64())
            .unwrap_or(0);

        let block_time = result.get("blockTime").and_then(|b| b.as_i64());

        let meta_err = result
            .get("meta")
            .and_then(|m| m.get("err"))
            .filter(|e| !e.is_null())
            .cloned();

        Ok(Some(SolanaTransaction {
            signature: signature.to_string(),
            slot,
            block_time,
            meta_err,
        }))
    }

    /// Current slot.
    pub async fn get_slot(&self) -> Result<u64> {
        let result = self.rpc_call("getSlot", vec![]).await?;
        result
            .as_u64()
            .ok_or_else(|| anyhow!("getSlot returned non-u64"))
    }

    /// Submit a fully-signed serialized transaction (base64-encoded).
    pub async fn send_transaction(&self, signed_tx: &str) -> Result<String> {
        let result = self
            .rpc_call(
                "sendTransaction",
                vec![
                    json!(signed_tx),
                    json!({"encoding": "base64", "skipPreflight": false}),
                ],
            )
            .await?;

        let sig = result
            .as_str()
            .ok_or_else(|| anyhow!("sendTransaction returned non-string"))?;
        Ok(sig.to_string())
    }

    /// Get the SPL token balance for a specific token account address.
    pub async fn get_token_balance(
        &self,
        token_account: &str,
    ) -> Result<SolanaTokenBalance> {
        let result = self
            .rpc_call("getTokenAccountBalance", vec![json!(token_account)])
            .await?;

        let value = result
            .get("value")
            .ok_or_else(|| anyhow!("getTokenAccountBalance missing `value`"))?;

        let amount = value
            .get("amount")
            .and_then(|a| a.as_str())
            .unwrap_or("0")
            .to_string();

        let decimals = value
            .get("decimals")
            .and_then(|d| d.as_u64())
            .unwrap_or(0) as u8;

        let ui_amount = value
            .get("uiAmount")
            .and_then(|u| u.as_f64())
            .unwrap_or(0.0);

        Ok(SolanaTokenBalance {
            amount,
            decimals,
            ui_amount,
        })
    }

    // -----------------------------------------------------------------------
    // Private helper
    // -----------------------------------------------------------------------

    async fn rpc_call(
        &self,
        method: &str,
        params: Vec<Value>,
    ) -> Result<Value> {
        let id = self.req_id.fetch_add(1, Ordering::Relaxed);

        let body = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        tracing::debug!(
            solana_method = method,
            "Solana RPC request"
        );

        let http_resp = self
            .client
            .post(&self.rpc_url)
            .json(&body)
            .send()
            .await
            .with_context(|| format!("Solana RPC `{method}` HTTP request failed"))?;

        let status = http_resp.status();
        if !status.is_success() {
            let text = http_resp.text().await.unwrap_or_default();
            tracing::error!(
                solana_method = method,
                http_status = %status,
                body = %text,
                "Solana RPC HTTP error"
            );
            return Err(anyhow!("Solana RPC HTTP {}: {}", status, text));
        }

        let resp: Value = http_resp
            .json()
            .await
            .context("Failed to deserialize Solana RPC response")?;

        if let Some(err) = resp.get("error") {
            let code = err.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
            let message = err
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown");
            tracing::error!(
                solana_method = method,
                error_code = code,
                error_message = message,
                "Solana RPC error"
            );
            return Err(anyhow!("Solana RPC error {}: {}", code, message));
        }

        resp.get("result")
            .cloned()
            .ok_or_else(|| anyhow!("Solana RPC `{method}` response missing `result`"))
    }
}
