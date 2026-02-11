use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

// ---------------------------------------------------------------------------
// Public data types
// ---------------------------------------------------------------------------

/// Thin wrapper around a hex-encoded 256-bit integer string (e.g. "0x1a2b3c").
///
/// EVM JSON-RPC returns balances / values as hex strings. We keep them as-is
/// to avoid pulling in a big-integer crate in the blockchain layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct U256String(pub String);

impl U256String {
    /// Parse the inner hex string to a `u128`.
    /// Sufficient for most token balances; will error on values > u128::MAX.
    pub fn to_u128(&self) -> Result<u128> {
        let stripped = self.0.strip_prefix("0x").unwrap_or(&self.0);
        u128::from_str_radix(stripped, 16)
            .with_context(|| format!("Failed to parse U256String `{}` as u128", self.0))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvmTransaction {
    pub hash: String,
    pub from: String,
    #[serde(default)]
    pub to: Option<String>,
    pub value: String,
    #[serde(default)]
    pub block_number: Option<String>,
    pub gas: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvmReceipt {
    #[serde(rename = "transactionHash")]
    pub transaction_hash: String,
    pub status: String,
    #[serde(rename = "blockNumber")]
    pub block_number: String,
    #[serde(rename = "gasUsed")]
    pub gas_used: String,
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/// Generic JSON-RPC client for any EVM-compatible chain.
pub struct EvmClient {
    client: Client,
    rpc_url: String,
    #[allow(dead_code)]
    chain_id: u64,
    req_id: AtomicU64,
}

impl EvmClient {
    pub fn new(rpc_url: impl Into<String>, chain_id: u64) -> Self {
        Self {
            client: Client::new(),
            rpc_url: rpc_url.into(),
            chain_id,
            req_id: AtomicU64::new(1),
        }
    }

    /// Get the native (ETH/MATIC/etc.) balance of `address` at the latest block.
    pub async fn get_balance(&self, address: &str) -> Result<U256String> {
        let result = self
            .rpc_call("eth_getBalance", vec![json!(address), json!("latest")])
            .await?;
        let hex = result
            .as_str()
            .ok_or_else(|| anyhow!("eth_getBalance returned non-string"))?;
        Ok(U256String(hex.to_string()))
    }

    /// Fetch a transaction by hash. Returns `None` if the tx is not found.
    pub async fn get_transaction(
        &self,
        tx_hash: &str,
    ) -> Result<Option<EvmTransaction>> {
        let result = self
            .rpc_call("eth_getTransactionByHash", vec![json!(tx_hash)])
            .await?;

        if result.is_null() {
            return Ok(None);
        }

        let tx: EvmTransaction =
            serde_json::from_value(result).context("Failed to deserialize EvmTransaction")?;
        Ok(Some(tx))
    }

    /// Fetch a transaction receipt. Returns `None` if not yet mined.
    pub async fn get_transaction_receipt(
        &self,
        tx_hash: &str,
    ) -> Result<Option<EvmReceipt>> {
        let result = self
            .rpc_call("eth_getTransactionReceipt", vec![json!(tx_hash)])
            .await?;

        if result.is_null() {
            return Ok(None);
        }

        let receipt: EvmReceipt =
            serde_json::from_value(result).context("Failed to deserialize EvmReceipt")?;
        Ok(Some(receipt))
    }

    /// Latest block number.
    pub async fn get_block_number(&self) -> Result<u64> {
        let result = self
            .rpc_call("eth_blockNumber", vec![])
            .await?;
        let hex = result
            .as_str()
            .ok_or_else(|| anyhow!("eth_blockNumber returned non-string"))?;
        let stripped = hex.strip_prefix("0x").unwrap_or(hex);
        u64::from_str_radix(stripped, 16).context("Failed to parse block number")
    }

    /// Broadcast a pre-signed raw transaction.
    pub async fn send_raw_transaction(&self, signed_tx: &str) -> Result<String> {
        let result = self
            .rpc_call("eth_sendRawTransaction", vec![json!(signed_tx)])
            .await?;
        let tx_hash = result
            .as_str()
            .ok_or_else(|| anyhow!("eth_sendRawTransaction returned non-string"))?;
        Ok(tx_hash.to_string())
    }

    /// Read the ERC-20 `balanceOf` for `wallet` on the given `token_address`.
    ///
    /// Performs an `eth_call` with the selector `0x70a08231` (balanceOf(address)).
    pub async fn get_token_balance(
        &self,
        token_address: &str,
        wallet: &str,
    ) -> Result<U256String> {
        // balanceOf(address) selector = 0x70a08231
        // ABI-encode: left-pad the 20-byte address to 32 bytes
        let addr_clean = wallet.strip_prefix("0x").unwrap_or(wallet);
        let data = format!("0x70a08231{:0>64}", addr_clean);

        let call_obj = json!({
            "to": token_address,
            "data": data,
        });

        let result = self
            .rpc_call("eth_call", vec![call_obj, json!("latest")])
            .await?;

        let hex = result
            .as_str()
            .ok_or_else(|| anyhow!("eth_call returned non-string"))?;

        Ok(U256String(hex.to_string()))
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
            evm_method = method,
            chain_id = self.chain_id,
            "EVM RPC request"
        );

        let http_resp = self
            .client
            .post(&self.rpc_url)
            .json(&body)
            .send()
            .await
            .with_context(|| format!("EVM RPC `{method}` HTTP request failed"))?;

        let status = http_resp.status();
        if !status.is_success() {
            let text = http_resp.text().await.unwrap_or_default();
            tracing::error!(
                evm_method = method,
                http_status = %status,
                body = %text,
                "EVM RPC HTTP error"
            );
            return Err(anyhow!("EVM RPC HTTP {}: {}", status, text));
        }

        let resp: Value = http_resp
            .json()
            .await
            .context("Failed to deserialize EVM RPC response")?;

        if let Some(err) = resp.get("error") {
            let code = err.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
            let message = err
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown");
            tracing::error!(
                evm_method = method,
                error_code = code,
                error_message = message,
                "EVM RPC error"
            );
            return Err(anyhow!("EVM RPC error {}: {}", code, message));
        }

        // The "result" field carries the actual return value.
        resp.get("result")
            .cloned()
            .ok_or_else(|| anyhow!("EVM RPC `{method}` response missing `result` field"))
    }
}

// ---------------------------------------------------------------------------
// Chain presets
// ---------------------------------------------------------------------------

/// Returns a mapping of well-known chain names to `(chain_id, default_rpc_url)`.
pub fn chain_configs() -> HashMap<&'static str, (u64, &'static str)> {
    let mut m = HashMap::new();
    m.insert("ethereum", (1u64, "https://eth.llamarpc.com"));
    m.insert("arbitrum", (42161, "https://arb1.arbitrum.io/rpc"));
    m.insert("base", (8453, "https://mainnet.base.org"));
    m.insert("bsc", (56, "https://bsc-dataseed.binance.org"));
    m.insert("polygon", (137, "https://polygon-rpc.com"));
    m.insert("optimism", (10, "https://mainnet.optimism.io"));
    m.insert("avalanche", (43114, "https://api.avax.network/ext/bc/C/rpc"));
    m
}
