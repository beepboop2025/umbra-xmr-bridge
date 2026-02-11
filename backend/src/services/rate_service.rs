use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use rust_decimal::prelude::FromPrimitive;
use serde::Deserialize;
use std::collections::HashMap;

use crate::error::{AppError, AppResult};
use crate::models::ExchangeRate;
use crate::services::pubsub;
use crate::AppState;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct RateData {
    pub direction: String,
    pub rate: Decimal,
    pub source: String,
    pub change_24h: Option<f64>,
    pub sparkline: Vec<f64>,
}

#[derive(Debug, Clone)]
pub struct RatePoint {
    pub rate: Decimal,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct ConversionResult {
    pub from_amount: Decimal,
    pub to_amount: Decimal,
    pub rate: Decimal,
    pub fee: Decimal,
    pub fee_percent: Decimal,
    pub min_received: Decimal,
}

// ---------------------------------------------------------------------------
// CoinGecko / Binance response shapes
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct CoinGeckoResponse {
    monero: Option<CoinGeckoUsd>,
    bitcoin: Option<CoinGeckoUsd>,
    ethereum: Option<CoinGeckoUsd>,
    #[serde(rename = "the-open-network")]
    ton: Option<CoinGeckoUsd>,
    solana: Option<CoinGeckoUsd>,
}

#[derive(Deserialize)]
struct CoinGeckoUsd {
    usd: f64,
}

#[derive(Deserialize)]
struct BinanceTicker {
    symbol: String,
    price: String,
}

// ---------------------------------------------------------------------------
// API URLs
// ---------------------------------------------------------------------------

const COINGECKO_URL: &str =
    "https://api.coingecko.com/api/v3/simple/price?ids=monero,bitcoin,ethereum,the-open-network,solana&vs_currencies=usd";

const BINANCE_URL: &str =
    r#"https://api.binance.com/api/v3/ticker/price?symbols=["XMRUSDT","BTCUSDT","ETHUSDT","SOLUSDT","TONUSDT"]"#;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Fetch the current exchange rate for `direction` (e.g. "XMR_TO_BTC").
///
/// Checks Redis cache first (30s TTL). On miss, fetches live prices from
/// CoinGecko (with Binance and CoinCap fallbacks), computes the cross-rate,
/// caches it, and persists to the exchange_rates table.
pub async fn get_rate(state: &AppState, direction: &str) -> AppResult<RateData> {
    let cache_key = format!("rate:{direction}");

    // -- Try Redis cache --
    let cached: Option<String> = {
        let mut conn = state.redis.clone();
        redis::cmd("GET")
            .arg(&cache_key)
            .query_async::<_, Option<String>>(&mut conn)
            .await
            .ok()
            .flatten()
    };

    if let Some(json_str) = cached {
        if let Ok(data) = serde_json::from_str::<CachedRate>(&json_str) {
            tracing::debug!(direction, "Rate cache hit");
            metrics::counter!("rate_cache_hits").increment(1);
            return Ok(RateData {
                direction: direction.to_string(),
                rate: data.rate,
                source: data.source,
                change_24h: data.change_24h,
                sparkline: data.sparkline,
            });
        }
    }

    metrics::counter!("rate_cache_misses").increment(1);

    // -- Fetch live prices --
    let prices = fetch_prices(state).await?;
    let (from_sym, to_sym) = parse_direction(direction)?;

    let from_usd = prices.get(&from_sym).copied().ok_or_else(|| {
        AppError::Internal(format!("No USD price for {from_sym}"))
    })?;
    let to_usd = prices.get(&to_sym).copied().ok_or_else(|| {
        AppError::Internal(format!("No USD price for {to_sym}"))
    })?;

    if to_usd == 0.0 {
        return Err(AppError::Internal("Denominator price is zero".into()));
    }

    let cross_rate = from_usd / to_usd;
    let rate = Decimal::from_f64(cross_rate)
        .unwrap_or_default();

    let source = "coingecko".to_string();

    // 24h change: fetch from DB
    let change_24h = compute_24h_change(&state.db, direction, rate).await;

    // Sparkline from recent history
    let sparkline = get_sparkline(&state.db, direction).await;

    let data = RateData {
        direction: direction.to_string(),
        rate,
        source: source.clone(),
        change_24h,
        sparkline: sparkline.clone(),
    };

    // -- Cache in Redis (30s TTL) --
    let cached_val = CachedRate {
        rate,
        source: source.clone(),
        change_24h,
        sparkline: sparkline.clone(),
    };
    if let Ok(json_str) = serde_json::to_string(&cached_val) {
        let mut conn = state.redis.clone();
        let _: Result<String, _> = redis::cmd("SET")
            .arg(&cache_key)
            .arg(&json_str)
            .arg("EX")
            .arg(30_u64)
            .query_async(&mut conn)
            .await;
    }

    // -- Persist to exchange_rates --
    let _ = sqlx::query(
        "INSERT INTO exchange_rates (id, direction, rate, source, created_at) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(uuid::Uuid::new_v4())
    .bind(direction)
    .bind(rate)
    .bind(&source)
    .bind(Utc::now())
    .execute(&state.db)
    .await;

    // -- Publish to websocket subscribers --
    let rate_json = serde_json::json!({
        "direction": direction,
        "rate": rate.to_string(),
        "source": source,
        "timestamp": Utc::now().to_rfc3339(),
    });
    let mut conn = state.redis.clone();
    let _ = pubsub::publish_rate_update(&mut conn, rate_json).await;

    Ok(data)
}

/// Calculate conversion result given amount, direction, rate, and fees.
pub fn calculate_conversion(
    amount: Decimal,
    _direction: &str,
    rate: Decimal,
    fee_percent: Decimal,
    slippage: Decimal,
) -> ConversionResult {
    let hundred = Decimal::new(100, 0);
    let fee = amount * fee_percent / hundred;
    let net_amount = amount - fee;
    let to_amount = net_amount * rate;
    let min_received = to_amount * (Decimal::ONE - slippage / hundred);

    ConversionResult {
        from_amount: amount,
        to_amount,
        rate,
        fee,
        fee_percent,
        min_received,
    }
}

/// Fetch rate history from the exchange_rates table.
pub async fn get_rate_history(
    state: &AppState,
    direction: &str,
    period: &str,
) -> AppResult<Vec<RatePoint>> {
    let interval = match period {
        "1h" => "1 hour",
        "4h" => "4 hours",
        "24h" => "24 hours",
        "7d" => "7 days",
        "30d" => "30 days",
        _ => "1 hour",
    };

    let query = format!(
        "SELECT id, direction, rate, source, created_at FROM exchange_rates \
         WHERE direction = $1 AND created_at > NOW() - INTERVAL '{}' \
         ORDER BY created_at ASC",
        interval
    );

    let rows = sqlx::query_as::<_, ExchangeRate>(&query)
        .bind(direction)
        .fetch_all(&state.db)
        .await?;

    let points = rows
        .into_iter()
        .map(|r| RatePoint {
            rate: r.rate,
            timestamp: r.created_at,
        })
        .collect();

    Ok(points)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, serde::Deserialize)]
struct CachedRate {
    rate: Decimal,
    source: String,
    change_24h: Option<f64>,
    sparkline: Vec<f64>,
}

/// Parse "XMR_TO_BTC" into ("XMR", "BTC").
fn parse_direction(direction: &str) -> AppResult<(String, String)> {
    let parts: Vec<&str> = direction.split("_TO_").collect();
    if parts.len() != 2 {
        return Err(AppError::BadRequest(format!(
            "Invalid direction format: {direction}"
        )));
    }
    Ok((parts[0].to_string(), parts[1].to_string()))
}

/// Fetch USD prices from CoinGecko, with Binance fallback, then CoinCap fallback.
async fn fetch_prices(state: &AppState) -> AppResult<HashMap<String, f64>> {
    // Try CoinGecko first
    if let Ok(prices) = fetch_coingecko(state).await {
        return Ok(prices);
    }
    tracing::warn!("CoinGecko failed, trying Binance");

    // Fallback: Binance
    if let Ok(prices) = fetch_binance(state).await {
        return Ok(prices);
    }
    tracing::warn!("Binance failed, trying CoinCap");

    // Fallback: CoinCap
    if let Ok(prices) = fetch_coincap(state).await {
        return Ok(prices);
    }

    Err(AppError::Internal(
        "All price sources failed".into(),
    ))
}

async fn fetch_coingecko(state: &AppState) -> AppResult<HashMap<String, f64>> {
    let timer = std::time::Instant::now();
    let resp: CoinGeckoResponse = state.http_client.get(COINGECKO_URL).send().await?.json().await?;
    let elapsed = timer.elapsed().as_secs_f64();
    metrics::histogram!("rate_fetch_duration_seconds", "source" => "coingecko").record(elapsed);

    let mut map = HashMap::new();

    if let Some(v) = resp.monero {
        map.insert("XMR".into(), v.usd);
    }
    if let Some(v) = resp.bitcoin {
        map.insert("BTC".into(), v.usd);
    }
    if let Some(v) = resp.ethereum {
        map.insert("ETH".into(), v.usd);
    }
    if let Some(v) = resp.ton {
        map.insert("TON".into(), v.usd);
    }
    if let Some(v) = resp.solana {
        map.insert("SOL".into(), v.usd);
    }

    // Stablecoins are pegged to $1
    map.insert("USDT".into(), 1.0);
    map.insert("USDC".into(), 1.0);

    if map.is_empty() {
        return Err(AppError::Internal("CoinGecko returned empty prices".into()));
    }

    Ok(map)
}

async fn fetch_binance(state: &AppState) -> AppResult<HashMap<String, f64>> {
    let timer = std::time::Instant::now();
    let resp: Vec<BinanceTicker> = state.http_client.get(BINANCE_URL).send().await?.json().await?;
    let elapsed = timer.elapsed().as_secs_f64();
    metrics::histogram!("rate_fetch_duration_seconds", "source" => "binance").record(elapsed);

    let mut map = HashMap::new();
    for t in &resp {
        let price: f64 = t.price.parse().unwrap_or(0.0);
        match t.symbol.as_str() {
            "XMRUSDT" => { map.insert("XMR".into(), price); }
            "BTCUSDT" => { map.insert("BTC".into(), price); }
            "ETHUSDT" => { map.insert("ETH".into(), price); }
            "SOLUSDT" => { map.insert("SOL".into(), price); }
            "TONUSDT" => { map.insert("TON".into(), price); }
            _ => {}
        }
    }

    map.insert("USDT".into(), 1.0);
    map.insert("USDC".into(), 1.0);

    if map.is_empty() {
        return Err(AppError::Internal("Binance returned empty prices".into()));
    }

    Ok(map)
}

/// CoinCap v2 as a last-resort fallback.
async fn fetch_coincap(state: &AppState) -> AppResult<HashMap<String, f64>> {
    #[derive(Deserialize)]
    struct CoinCapResp {
        data: Vec<CoinCapAsset>,
    }
    #[derive(Deserialize)]
    struct CoinCapAsset {
        symbol: String,
        #[serde(rename = "priceUsd")]
        price_usd: Option<String>,
    }

    let timer = std::time::Instant::now();
    let url = "https://api.coincap.io/v2/assets?ids=monero,bitcoin,ethereum,solana,the-open-network";
    let resp: CoinCapResp = state.http_client.get(url).send().await?.json().await?;
    let elapsed = timer.elapsed().as_secs_f64();
    metrics::histogram!("rate_fetch_duration_seconds", "source" => "coincap").record(elapsed);

    let mut map = HashMap::new();
    for a in &resp.data {
        let price: f64 = a.price_usd.as_deref().unwrap_or("0").parse().unwrap_or(0.0);
        match a.symbol.as_str() {
            "XMR" => { map.insert("XMR".into(), price); }
            "BTC" => { map.insert("BTC".into(), price); }
            "ETH" => { map.insert("ETH".into(), price); }
            "SOL" => { map.insert("SOL".into(), price); }
            "TON" => { map.insert("TON".into(), price); }
            _ => {}
        }
    }

    map.insert("USDT".into(), 1.0);
    map.insert("USDC".into(), 1.0);

    if map.is_empty() {
        return Err(AppError::Internal("CoinCap returned empty prices".into()));
    }

    Ok(map)
}

/// Compute 24h percentage change from the oldest rate within 24h vs current.
async fn compute_24h_change(
    db: &crate::db::Pool,
    direction: &str,
    current_rate: Decimal,
) -> Option<f64> {
    #[derive(sqlx::FromRow)]
    struct OldRate {
        rate: Decimal,
    }

    let row = sqlx::query_as::<_, OldRate>(
        "SELECT rate FROM exchange_rates \
         WHERE direction = $1 AND created_at > NOW() - INTERVAL '24 hours' \
         ORDER BY created_at ASC LIMIT 1",
    )
    .bind(direction)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()?;

    if row.rate.is_zero() {
        return None;
    }

    let old_f: f64 = row.rate.to_string().parse().ok()?;
    let new_f: f64 = current_rate.to_string().parse().ok()?;
    let change = ((new_f - old_f) / old_f) * 100.0;
    Some((change * 100.0).round() / 100.0) // 2 decimal places
}

/// Build a sparkline (last ~24 data points) from rate history.
async fn get_sparkline(db: &crate::db::Pool, direction: &str) -> Vec<f64> {
    #[derive(sqlx::FromRow)]
    struct SparkRow {
        rate: Decimal,
    }

    let rows = sqlx::query_as::<_, SparkRow>(
        "SELECT rate FROM exchange_rates \
         WHERE direction = $1 AND created_at > NOW() - INTERVAL '24 hours' \
         ORDER BY created_at ASC",
    )
    .bind(direction)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    rows.into_iter()
        .map(|r| r.rate.to_string().parse::<f64>().unwrap_or(0.0))
        .collect()
}
