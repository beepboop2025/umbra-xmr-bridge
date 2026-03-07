//! Routing layer over multiple EVM-compatible chain clients.
//!
//! The deposit monitor and withdrawal processor reference `state.evm_rpc`
//! with a chain-name parameter (e.g. "ETH", "ARB", "BASE"). This router
//! maps those names to the correct [`EvmClient`] instance and provides
//! convenience methods that combine multiple RPC calls.

use anyhow::{anyhow, Result};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::blockchain::evm::EvmClient;

// ---------------------------------------------------------------------------
// Response types used by the deposit monitor
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Erc20TransferLog {
    pub tx_hash: String,
    pub from: String,
    pub to: String,
    pub value: Decimal,
    pub block_number: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InternalTx {
    pub hash: String,
    pub from: String,
    pub to: String,
    pub value: String,
}

// ---------------------------------------------------------------------------
// Token addresses (mainnet)
// ---------------------------------------------------------------------------

/// Well-known ERC-20 contract addresses on Ethereum mainnet.
fn token_contract(chain: &str) -> Option<&'static str> {
    match chain {
        "USDC" => Some("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
        "USDT" => Some("0xdAC17F958D2ee523a2206206994597C13D831ec7"),
        _ => None,
    }
}

// ERC-20 Transfer event topic: keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC: &str =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/// Routes chain-name requests to the appropriate [`EvmClient`].
pub struct EvmRpcRouter {
    clients: HashMap<String, EvmClient>,
}

impl EvmRpcRouter {
    pub fn new(clients: HashMap<String, EvmClient>) -> Self {
        Self { clients }
    }

    fn client_for(&self, chain: &str) -> Result<&EvmClient> {
        // USDC/USDT live on Ethereum mainnet by default.
        let key = match chain {
            "USDC" | "USDT" => "ETH",
            other => other,
        };
        self.clients
            .get(key)
            .ok_or_else(|| anyhow!("No EVM client configured for chain `{chain}`"))
    }

    /// Get the native balance of `address` as a [`Decimal`] (in ether units).
    pub async fn get_balance(&self, chain: &str, address: &str) -> Result<Decimal> {
        let client = self.client_for(chain)?;
        let raw = client.get_balance(address).await?;
        let wei = raw.to_u128()?;
        // 1 ETH = 1e18 wei — use from_i128_with_scale to avoid i64 overflow
        Ok(Decimal::from_i128_with_scale(wei as i128, 18))
    }

    /// Fetch ERC-20 Transfer events to `to_address` on `chain`.
    ///
    /// If `from_block` is `None`, scans from the latest 1000 blocks.
    pub async fn get_erc20_transfer_logs(
        &self,
        chain: &str,
        to_address: &str,
        from_block: Option<u64>,
    ) -> Result<Vec<Erc20TransferLog>> {
        let client = self.client_for(chain)?;

        let contract = token_contract(chain)
            .ok_or_else(|| anyhow!("{chain} is not a known ERC-20 token"))?;

        let latest = client.get_block_number().await?;
        let start = from_block.unwrap_or_else(|| latest.saturating_sub(1000));

        let start_hex = format!("0x{:x}", start);
        let latest_hex = format!("0x{:x}", latest);

        // ABI-encode the `to` address as a topic filter (left-pad to 32 bytes).
        let addr_clean = to_address.strip_prefix("0x").unwrap_or(to_address);
        let topic_to = format!("0x{:0>64}", addr_clean);

        let filter = serde_json::json!({
            "fromBlock": start_hex,
            "toBlock": latest_hex,
            "address": contract,
            "topics": [TRANSFER_TOPIC, null, topic_to],
        });

        // Use a raw RPC call via the HTTP client.
        let resp: serde_json::Value = client
            .raw_rpc_call("eth_getLogs", vec![filter])
            .await?;

        let logs_array = resp.as_array().cloned().unwrap_or_default();

        let decimals: u32 = match chain {
            "USDC" => 6,
            "USDT" => 6,
            _ => 18,
        };

        let mut results = Vec::new();
        for log in &logs_array {
            let tx_hash = log
                .get("transactionHash")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();

            let from = log
                .get("topics")
                .and_then(|t| t.get(1))
                .and_then(|v| v.as_str())
                .map(|s| format!("0x{}", &s[s.len().saturating_sub(40)..]))
                .unwrap_or_default();

            let to = log
                .get("topics")
                .and_then(|t| t.get(2))
                .and_then(|v| v.as_str())
                .map(|s| format!("0x{}", &s[s.len().saturating_sub(40)..]))
                .unwrap_or_default();

            let data_hex = log
                .get("data")
                .and_then(|d| d.as_str())
                .unwrap_or("0x0");

            let stripped = data_hex.strip_prefix("0x").unwrap_or(data_hex);
            let raw_value = u128::from_str_radix(stripped, 16).unwrap_or(0);
            let value = Decimal::from_i128_with_scale(raw_value as i128, decimals);

            let block_hex = log
                .get("blockNumber")
                .and_then(|b| b.as_str())
                .unwrap_or("0x0");
            let block_stripped = block_hex.strip_prefix("0x").unwrap_or(block_hex);
            let block_number = u64::from_str_radix(block_stripped, 16).unwrap_or(0);

            results.push(Erc20TransferLog {
                tx_hash,
                from,
                to,
                value,
                block_number,
            });
        }

        Ok(results)
    }

    /// Get the most recent internal (value-carrying) transactions to `address`.
    pub async fn get_internal_txs(
        &self,
        chain: &str,
        address: &str,
        limit: usize,
    ) -> Result<Vec<InternalTx>> {
        let client = self.client_for(chain)?;

        // Use eth_getBlockByNumber on the latest block and scan its txs.
        // For a production implementation you'd use an indexer or trace API.
        // This simplified version checks the latest block for matching txs.
        let latest = client.get_block_number().await?;

        let mut results = Vec::new();
        // Scan up to 5 recent blocks looking for txs to this address.
        for offset in 0..5u64 {
            if results.len() >= limit {
                break;
            }
            let block_num = latest.saturating_sub(offset);
            let block_hex = format!("0x{:x}", block_num);

            let block: serde_json::Value = client
                .raw_rpc_call(
                    "eth_getBlockByNumber",
                    vec![serde_json::json!(block_hex), serde_json::json!(true)],
                )
                .await?;

            let txs = block
                .get("transactions")
                .and_then(|t| t.as_array())
                .cloned()
                .unwrap_or_default();

            let addr_lower = address.to_lowercase();
            for tx in &txs {
                if results.len() >= limit {
                    break;
                }
                let to = tx
                    .get("to")
                    .and_then(|t| t.as_str())
                    .unwrap_or_default();

                if to.to_lowercase() == addr_lower {
                    results.push(InternalTx {
                        hash: tx
                            .get("hash")
                            .and_then(|h| h.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        from: tx
                            .get("from")
                            .and_then(|f| f.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        to: to.to_string(),
                        value: tx
                            .get("value")
                            .and_then(|v| v.as_str())
                            .unwrap_or("0x0")
                            .to_string(),
                    });
                }
            }
        }

        Ok(results)
    }

    /// Get the number of confirmations for a transaction on the specified chain.
    ///
    /// Returns `Ok(0)` if the tx hasn't been mined yet.
    pub async fn get_confirmations(&self, chain: &str, tx_hash: &str) -> Result<u64> {
        let client = self.client_for(chain)?;

        let receipt = client.get_transaction_receipt(tx_hash).await?;
        let receipt = match receipt {
            Some(r) => r,
            None => return Ok(0), // Not yet mined
        };

        let receipt_block_hex = receipt.block_number;
        let stripped = receipt_block_hex.strip_prefix("0x").unwrap_or(&receipt_block_hex);
        let receipt_block = u64::from_str_radix(stripped, 16).unwrap_or(0);

        if receipt_block == 0 {
            return Ok(0);
        }

        let latest = client.get_block_number().await?;
        Ok(latest.saturating_sub(receipt_block) + 1)
    }

    /// Broadcast a signed raw transaction on the specified chain.
    pub async fn send_raw_transaction(
        &self,
        chain: &str,
        signed_tx: &str,
    ) -> Result<String> {
        let client = self.client_for(chain)?;
        client.send_raw_transaction(signed_tx).await
    }
}
