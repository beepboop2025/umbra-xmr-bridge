use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---------------------------------------------------------------------------
// Public data types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TonAddressInfo {
    pub balance: String,
    pub state: String,
    #[serde(default)]
    pub last_tx_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TonTransaction {
    #[serde(default)]
    pub hash: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub destination: String,
    #[serde(default)]
    pub utime: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TonSendResult {
    pub hash: String,
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/// Toncenter HTTP API v2 client.
pub struct TonClient {
    client: Client,
    base_url: String,
    api_key: Option<String>,
}

impl TonClient {
    pub fn new(base_url: impl Into<String>, api_key: Option<String>) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.into(),
            api_key,
        }
    }

    /// Fetch full address information (balance, state, last tx).
    pub async fn get_address_info(&self, address: &str) -> Result<TonAddressInfo> {
        let resp = self
            .api_get("getAddressInformation", &[("address", address)])
            .await?;

        let result = resp
            .get("result")
            .ok_or_else(|| anyhow!("Missing `result` in getAddressInformation response"))?;

        // Balance may come as a number or string — normalise to String.
        let balance = match result.get("balance") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Number(n)) => n.to_string(),
            _ => "0".to_string(),
        };

        let state = result
            .get("state")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        let last_tx_hash = result
            .get("last_transaction_id")
            .and_then(|tx| tx.get("hash"))
            .and_then(|h| h.as_str())
            .map(|s| s.to_string());

        Ok(TonAddressInfo {
            balance,
            state,
            last_tx_hash,
        })
    }

    /// Fetch recent transactions for an address.
    pub async fn get_transactions(
        &self,
        address: &str,
        limit: u32,
    ) -> Result<Vec<TonTransaction>> {
        let limit_str = limit.to_string();
        let resp = self
            .api_get("getTransactions", &[("address", address), ("limit", &limit_str)])
            .await?;

        let result = resp
            .get("result")
            .ok_or_else(|| anyhow!("Missing `result` in getTransactions response"))?;

        let raw_txs = result
            .as_array()
            .ok_or_else(|| anyhow!("getTransactions result is not an array"))?;

        let mut txs = Vec::with_capacity(raw_txs.len());
        for raw in raw_txs {
            let hash = raw
                .get("transaction_id")
                .and_then(|t| t.get("hash"))
                .and_then(|h| h.as_str())
                .unwrap_or_default()
                .to_string();

            // in_msg carries the value / source / destination
            let in_msg = raw.get("in_msg");

            let value = in_msg
                .and_then(|m| m.get("value"))
                .map(|v| match v {
                    Value::String(s) => s.clone(),
                    Value::Number(n) => n.to_string(),
                    _ => "0".to_string(),
                })
                .unwrap_or_else(|| "0".to_string());

            let source = in_msg
                .and_then(|m| m.get("source"))
                .and_then(|s| s.as_str())
                .unwrap_or_default()
                .to_string();

            let destination = in_msg
                .and_then(|m| m.get("destination"))
                .and_then(|d| d.as_str())
                .unwrap_or_default()
                .to_string();

            let utime = raw
                .get("utime")
                .and_then(|u| u.as_u64())
                .unwrap_or(0);

            txs.push(TonTransaction {
                hash,
                value,
                source,
                destination,
                utime,
            });
        }

        Ok(txs)
    }

    /// Get balance in nanotons.
    pub async fn get_balance(&self, address: &str) -> Result<u64> {
        let info = self.get_address_info(address).await?;
        let balance: u64 = info
            .balance
            .parse()
            .context("Failed to parse TON balance as u64")?;
        Ok(balance)
    }

    /// Broadcast a signed BOC (bag-of-cells) to the network.
    pub async fn send_boc(&self, boc: &str) -> Result<TonSendResult> {
        let url = format!("{}/sendBoc", self.base_url);

        tracing::debug!("TON sendBoc request");

        let mut request = self
            .client
            .post(&url)
            .json(&serde_json::json!({ "boc": boc }));

        if let Some(ref key) = self.api_key {
            request = request.header("X-API-Key", key);
        }

        let http_resp = request
            .send()
            .await
            .context("TON sendBoc HTTP request failed")?;

        let status = http_resp.status();
        let body: Value = http_resp
            .json()
            .await
            .context("Failed to parse sendBoc response")?;

        if !status.is_success() {
            let err_msg = body
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("unknown error");
            tracing::error!(
                http_status = %status,
                error = %err_msg,
                "TON sendBoc error"
            );
            return Err(anyhow!("TON sendBoc error {}: {}", status, err_msg));
        }

        // Toncenter returns { ok: true, result: { hash: "..." } }
        let hash = body
            .get("result")
            .and_then(|r| r.get("hash"))
            .and_then(|h| h.as_str())
            .unwrap_or_default()
            .to_string();

        Ok(TonSendResult { hash })
    }

    // -----------------------------------------------------------------------
    // Private helper
    // -----------------------------------------------------------------------

    /// Perform a GET request against the Toncenter HTTP API v2.
    async fn api_get(
        &self,
        method: &str,
        params: &[(&str, &str)],
    ) -> Result<Value> {
        let url = format!("{}/{}", self.base_url, method);

        tracing::debug!(ton_method = method, "TON API request");

        let mut request = self.client.get(&url).query(params);

        if let Some(ref key) = self.api_key {
            request = request.header("X-API-Key", key);
        }

        let http_resp = request
            .send()
            .await
            .with_context(|| format!("TON API request to `{method}` failed"))?;

        let status = http_resp.status();
        let body: Value = http_resp
            .json()
            .await
            .with_context(|| format!("Failed to parse TON `{method}` response"))?;

        if !status.is_success() {
            let err_msg = body
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("unknown error");
            tracing::error!(
                ton_method = method,
                http_status = %status,
                error = %err_msg,
                "TON API error"
            );
            return Err(anyhow!("TON API error {}: {}", status, err_msg));
        }

        // Toncenter wraps everything in { ok, result }
        let ok = body.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        if !ok {
            let err_msg = body
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("unknown");
            return Err(anyhow!("TON API returned ok=false: {}", err_msg));
        }

        Ok(body)
    }
}
