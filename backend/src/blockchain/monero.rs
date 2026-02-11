use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};

/// A transfer record returned by the Monero wallet RPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoneroTransfer {
    pub txid: String,
    pub amount: u64,
    pub confirmations: u64,
    pub height: u64,
    pub timestamp: u64,
    pub address: String,
    #[serde(default)]
    pub subaddr_index: SubaddrIndex,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SubaddrIndex {
    pub major: u32,
    pub minor: u32,
}

/// Result of a successful outgoing transfer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoneroTransferResult {
    pub tx_hash: String,
    pub fee: u64,
    pub amount: u64,
}

/// Client for the Monero wallet-RPC (JSON-RPC 2.0).
pub struct MoneroRpc {
    client: Client,
    url: String,
    auth: Option<(String, String)>,
    req_id: AtomicU64,
}

/// Wrapper for a JSON-RPC 2.0 response.
#[derive(Deserialize)]
struct JsonRpcResponse<T> {
    #[allow(dead_code)]
    id: Value,
    result: Option<T>,
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

impl MoneroRpc {
    /// Create a new Monero RPC client.
    ///
    /// `user` and `pass` are used for digest authentication when set.
    pub fn new(url: impl Into<String>, user: Option<String>, pass: Option<String>) -> Self {
        Self {
            client: Client::new(),
            url: url.into(),
            auth: user.map(|u| (u, pass.unwrap_or_default())),
            req_id: AtomicU64::new(1),
        }
    }

    /// Create a new sub-address under the given account index.
    ///
    /// Returns `(address_index, address)`.
    pub async fn create_subaddress(
        &self,
        account_index: u32,
        label: &str,
    ) -> Result<(u32, String)> {
        #[derive(Deserialize)]
        struct Resp {
            address_index: u32,
            address: String,
        }
        let params = json!({
            "account_index": account_index,
            "label": label,
        });
        let resp: Resp = self.rpc_call("create_address", params).await?;
        Ok((resp.address_index, resp.address))
    }

    /// Retrieve incoming transfers for a set of sub-address indices.
    pub async fn get_transfers(
        &self,
        account_index: u32,
        subaddr_indices: &[u32],
    ) -> Result<Vec<MoneroTransfer>> {
        #[derive(Deserialize)]
        struct Resp {
            #[serde(rename = "in", default)]
            incoming: Vec<MoneroTransfer>,
        }
        let params = json!({
            "in": true,
            "out": false,
            "pending": false,
            "failed": false,
            "pool": false,
            "account_index": account_index,
            "subaddr_indices": subaddr_indices,
        });
        let resp: Resp = self.rpc_call("get_transfers", params).await?;
        Ok(resp.incoming)
    }

    /// Get the total and unlocked balance (in atomic units) for an account.
    pub async fn get_balance(&self, account_index: u32) -> Result<(u64, u64)> {
        #[derive(Deserialize)]
        struct Resp {
            balance: u64,
            unlocked_balance: u64,
        }
        let params = json!({ "account_index": account_index });
        let resp: Resp = self.rpc_call("get_balance", params).await?;
        Ok((resp.balance, resp.unlocked_balance))
    }

    /// Send XMR to `dest` (standard address).
    ///
    /// `amount_atomic` is in piconero (1 XMR = 1e12).
    /// `priority` — 0 default, 1 unimportant, 2 normal, 3 elevated, 4 priority.
    pub async fn transfer(
        &self,
        dest: &str,
        amount_atomic: u64,
        priority: u32,
    ) -> Result<MoneroTransferResult> {
        #[derive(Deserialize)]
        struct Resp {
            tx_hash: String,
            fee: u64,
            amount: u64,
        }
        let params = json!({
            "destinations": [{ "amount": amount_atomic, "address": dest }],
            "priority": priority,
            "ring_size": 16,
            "get_tx_hex": false,
        });
        let resp: Resp = self.rpc_call("transfer", params).await?;
        Ok(MoneroTransferResult {
            tx_hash: resp.tx_hash,
            fee: resp.fee,
            amount: resp.amount,
        })
    }

    /// Look up a single transfer by its transaction id.
    pub async fn get_transfer_by_txid(&self, txid: &str) -> Result<MoneroTransfer> {
        #[derive(Deserialize)]
        struct Resp {
            transfer: MoneroTransfer,
        }
        let params = json!({ "txid": txid });
        let resp: Resp = self.rpc_call("get_transfer_by_txid", params).await?;
        Ok(resp.transfer)
    }

    /// Current blockchain height as known by the wallet.
    pub async fn get_height(&self) -> Result<u64> {
        #[derive(Deserialize)]
        struct Resp {
            height: u64,
        }
        let resp: Resp = self.rpc_call("get_height", json!({})).await?;
        Ok(resp.height)
    }

    // -----------------------------------------------------------------------
    // Private helper
    // -----------------------------------------------------------------------

    /// Generic JSON-RPC 2.0 call to the Monero wallet daemon.
    async fn rpc_call<T: DeserializeOwned>(
        &self,
        method: &str,
        params: Value,
    ) -> Result<T> {
        let id = self.req_id.fetch_add(1, Ordering::Relaxed);

        let body = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        tracing::debug!(
            rpc_method = method,
            "Monero RPC request"
        );

        let mut request = self.client.post(&self.url).json(&body);

        if let Some((ref user, ref pass)) = self.auth {
            request = request.basic_auth(user, Some(pass));
        }

        let http_resp = request
            .send()
            .await
            .context("Monero RPC HTTP request failed")?;

        let status = http_resp.status();
        if !status.is_success() {
            let text = http_resp
                .text()
                .await
                .unwrap_or_else(|_| "no body".to_string());
            tracing::error!(
                rpc_method = method,
                http_status = %status,
                body = %text,
                "Monero RPC HTTP error"
            );
            return Err(anyhow!(
                "Monero RPC HTTP {}: {}",
                status,
                text
            ));
        }

        let rpc_resp: JsonRpcResponse<T> = http_resp
            .json()
            .await
            .context("Failed to deserialize Monero RPC response")?;

        if let Some(err) = rpc_resp.error {
            tracing::error!(
                rpc_method = method,
                error_code = err.code,
                error_message = %err.message,
                "Monero RPC error"
            );
            return Err(anyhow!(
                "Monero RPC error {}: {}",
                err.code,
                err.message
            ));
        }

        rpc_resp.result.ok_or_else(|| {
            anyhow!("Monero RPC response for `{method}` contained neither result nor error")
        })
    }
}
