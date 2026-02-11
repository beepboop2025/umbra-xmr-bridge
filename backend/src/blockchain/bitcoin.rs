use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};

// ---------------------------------------------------------------------------
// Public data types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BtcTransaction {
    pub txid: String,
    pub confirmations: i64,
    /// Amount in BTC (can be negative for sends).
    pub amount: f64,
    #[serde(default)]
    pub fee: Option<f64>,
    #[serde(default)]
    pub blockhash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BtcUtxo {
    pub txid: String,
    pub vout: u32,
    pub address: String,
    pub amount: f64,
    pub confirmations: u32,
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/// Bitcoin Core JSON-RPC client (basic-auth).
pub struct BitcoinRpc {
    client: Client,
    rpc_url: String,
    auth: Option<(String, String)>,
    req_id: AtomicU64,
}

impl BitcoinRpc {
    pub fn new(
        rpc_url: impl Into<String>,
        user: Option<String>,
        pass: Option<String>,
    ) -> Self {
        Self {
            client: Client::new(),
            rpc_url: rpc_url.into(),
            auth: user.map(|u| (u, pass.unwrap_or_default())),
            req_id: AtomicU64::new(1),
        }
    }

    /// Generate a new receiving address under `label`.
    pub async fn get_new_address(&self, label: &str) -> Result<String> {
        self.rpc_call("getnewaddress", vec![json!(label)])
            .await
    }

    /// Wallet balance in BTC.
    pub async fn get_balance(&self) -> Result<f64> {
        self.rpc_call("getbalance", vec![]).await
    }

    /// Look up a wallet transaction by txid.
    pub async fn get_transaction(&self, txid: &str) -> Result<BtcTransaction> {
        self.rpc_call("gettransaction", vec![json!(txid)])
            .await
    }

    /// List unspent outputs with at least `min_conf` confirmations,
    /// optionally filtered to the given addresses.
    pub async fn list_unspent(
        &self,
        min_conf: u32,
        addresses: &[&str],
    ) -> Result<Vec<BtcUtxo>> {
        // listunspent minconf maxconf ["addresses"]
        let max_conf = 9999999u32;
        let addr_array: Vec<Value> = addresses.iter().map(|a| json!(a)).collect();
        self.rpc_call(
            "listunspent",
            vec![json!(min_conf), json!(max_conf), json!(addr_array)],
        )
        .await
    }

    /// Send BTC to `address`. Returns the txid.
    pub async fn send_to_address(
        &self,
        address: &str,
        amount_btc: f64,
    ) -> Result<String> {
        self.rpc_call("sendtoaddress", vec![json!(address), json!(amount_btc)])
            .await
    }

    /// Current best-block height.
    pub async fn get_block_count(&self) -> Result<u64> {
        self.rpc_call("getblockcount", vec![]).await
    }

    // -----------------------------------------------------------------------
    // Private helper
    // -----------------------------------------------------------------------

    async fn rpc_call<T: DeserializeOwned>(
        &self,
        method: &str,
        params: Vec<Value>,
    ) -> Result<T> {
        let id = self.req_id.fetch_add(1, Ordering::Relaxed);

        let body = json!({
            "jsonrpc": "1.0",
            "id": id,
            "method": method,
            "params": params,
        });

        tracing::debug!(
            btc_method = method,
            "Bitcoin RPC request"
        );

        let mut request = self.client.post(&self.rpc_url).json(&body);

        if let Some((ref user, ref pass)) = self.auth {
            request = request.basic_auth(user, Some(pass));
        }

        let http_resp = request
            .send()
            .await
            .with_context(|| format!("Bitcoin RPC `{method}` HTTP request failed"))?;

        let status = http_resp.status();
        if !status.is_success() {
            let text = http_resp.text().await.unwrap_or_default();
            tracing::error!(
                btc_method = method,
                http_status = %status,
                body = %text,
                "Bitcoin RPC HTTP error"
            );
            return Err(anyhow!("Bitcoin RPC HTTP {}: {}", status, text));
        }

        #[derive(Deserialize)]
        struct RpcResp<R> {
            #[allow(dead_code)]
            id: Value,
            result: Option<R>,
            error: Option<RpcError>,
        }

        #[derive(Deserialize)]
        struct RpcError {
            code: i64,
            message: String,
        }

        let resp: RpcResp<T> = http_resp
            .json()
            .await
            .context("Failed to deserialize Bitcoin RPC response")?;

        if let Some(err) = resp.error {
            tracing::error!(
                btc_method = method,
                error_code = err.code,
                error_message = %err.message,
                "Bitcoin RPC error"
            );
            return Err(anyhow!(
                "Bitcoin RPC error {}: {}",
                err.code,
                err.message
            ));
        }

        resp.result.ok_or_else(|| {
            anyhow!("Bitcoin RPC `{method}` returned neither result nor error")
        })
    }
}
