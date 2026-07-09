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

    if from_usd == 0.0 || to_usd == 0.0 {
        return Err(AppError::Internal(format!(
            "Invalid USD prices: {from_sym}=${from_usd}, {to_sym}=${to_usd}"
        )));
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

/// USD prices for all supported coins, cached in Redis (60s) so aggregate
/// callers (e.g. the stats endpoint) don't hit external APIs per request.
/// Best-effort: returns an empty map if every source fails; callers treat a
/// missing coin as a zero contribution rather than erroring.
pub async fn usd_prices(state: &AppState) -> HashMap<String, f64> {
    const KEY: &str = "prices:usd";

    {
        let mut conn = state.redis.clone();
        if let Ok(Some(s)) = redis::cmd("GET")
            .arg(KEY)
            .query_async::<_, Option<String>>(&mut conn)
            .await
        {
            if let Ok(m) = serde_json::from_str::<HashMap<String, f64>>(&s) {
                return m;
            }
        }
    }

    match fetch_prices(state).await {
        Ok(m) => {
            if let Ok(s) = serde_json::to_string(&m) {
                let mut conn = state.redis.clone();
                let _: Result<String, _> = redis::cmd("SET")
                    .arg(KEY)
                    .arg(&s)
                    .arg("EX")
                    .arg(60_u64)
                    .query_async(&mut conn)
                    .await;
            }
            m
        }
        Err(e) => {
            tracing::warn!(error = %e, "usd_prices: all sources failed");
            HashMap::new()
        }
    }
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
    // Convert period to hours for parameterized interval query
    let hours: i32 = match period {
        "1h" => 1,
        "4h" => 4,
        "24h" => 24,
        "7d" => 168,
        "30d" => 720,
        _ => 1,
    };

    let rows = sqlx::query_as::<_, ExchangeRate>(
        "SELECT id, direction, rate, source, created_at FROM exchange_rates \
         WHERE direction = $1 AND created_at > NOW() - make_interval(hours => $2) \
         ORDER BY created_at ASC",
    )
    .bind(direction)
    .bind(hours)
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

/// Coins every supported pair needs a USD price for. Every direction routes
/// through XMR, so XMR is mandatory; the majors round out the cross-rates. A
/// source that can't supply all of these (Binance delisted XMR in 2024) is
/// rejected so the next source is tried instead of a half-empty map slipping
/// through as "success".
const CORE_COINS: [&str; 4] = ["XMR", "BTC", "ETH", "SOL"];

/// A price map is only usable if it carries every core coin at a non-zero price.
/// This is what turns a rate-limited HTTP 200 — whose body deserializes to
/// all-`None`, leaving only the hardcoded stablecoins — into a hard error that
/// triggers failover, rather than a map that later 500s with "No USD price".
fn require_core(map: &HashMap<String, f64>, source: &str) -> AppResult<()> {
    for coin in CORE_COINS {
        match map.get(coin) {
            Some(p) if *p > 0.0 => {}
            _ => return Err(AppError::Internal(format!("{source}: missing price for {coin}"))),
        }
    }
    Ok(())
}

/// Fetch USD prices, trying sources in order of coverage/reliability:
/// CoinGecko (all coins incl. TON), then Kraken (XMR/BTC/ETH/SOL/TON), then
/// Binance (no XMR — last resort). Each source must pass `require_core` or we
/// move on. CoinCap was retired (its API shut down), so it is no longer tried.
async fn fetch_prices(state: &AppState) -> AppResult<HashMap<String, f64>> {
    match fetch_coingecko(state).await {
        Ok(prices) => return Ok(prices),
        Err(e) => tracing::warn!(error = %e, "rate: CoinGecko failed, trying Kraken"),
    }
    match fetch_kraken(state).await {
        Ok(prices) => return Ok(prices),
        Err(e) => tracing::warn!(error = %e, "rate: Kraken failed, trying Binance"),
    }
    match fetch_binance(state).await {
        Ok(prices) => return Ok(prices),
        Err(e) => tracing::warn!(error = %e, "rate: Binance failed"),
    }
    Err(AppError::Internal("All price sources failed".into()))
}

async fn fetch_coingecko(state: &AppState) -> AppResult<HashMap<String, f64>> {
    let timer = std::time::Instant::now();
    // error_for_status: a 429/5xx must fail here, not deserialize to an all-None
    // body that passes for "success".
    let resp: CoinGeckoResponse = state
        .http_client
        .get(COINGECKO_URL)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
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

    require_core(&map, "coingecko")?;
    Ok(map)
}

async fn fetch_binance(state: &AppState) -> AppResult<HashMap<String, f64>> {
    let timer = std::time::Instant::now();
    let resp: Vec<BinanceTicker> = state
        .http_client
        .get(BINANCE_URL)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
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

    // Binance no longer lists XMR, so this fails the core check for every pair
    // we serve. Kept only as a theoretical last resort.
    require_core(&map, "binance")?;
    Ok(map)
}

/// Kraken public ticker — the reliable XMR source now that Binance dropped it
/// and CoinCap shut down. Kraken uses idiosyncratic pair names (XXMRZUSD,
/// XXBTZUSD, ...), so we match assets by substring rather than exact key.
async fn fetch_kraken(state: &AppState) -> AppResult<HashMap<String, f64>> {
    #[derive(Deserialize)]
    struct KrakenResp {
        result: HashMap<String, KrakenPair>,
    }
    #[derive(Deserialize)]
    struct KrakenPair {
        /// `c` = [last trade price, lot volume]; index 0 is the price.
        c: Vec<String>,
    }

    let timer = std::time::Instant::now();
    let url = "https://api.kraken.com/0/public/Ticker?pair=XMRUSD,XBTUSD,ETHUSD,SOLUSD,TONUSD";
    let resp: KrakenResp = state
        .http_client
        .get(url)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let elapsed = timer.elapsed().as_secs_f64();
    metrics::histogram!("rate_fetch_duration_seconds", "source" => "kraken").record(elapsed);

    let mut map = HashMap::new();
    for (pair, data) in &resp.result {
        let price: f64 = data.c.first().and_then(|s| s.parse().ok()).unwrap_or(0.0);
        if price <= 0.0 {
            continue;
        }
        let p = pair.to_uppercase();
        // Order matters: check the most specific tokens first.
        if p.contains("XMR") {
            map.insert("XMR".into(), price);
        } else if p.contains("XBT") || p.contains("BTC") {
            map.insert("BTC".into(), price);
        } else if p.contains("ETH") {
            map.insert("ETH".into(), price);
        } else if p.contains("SOL") {
            map.insert("SOL".into(), price);
        } else if p.contains("TON") {
            map.insert("TON".into(), price);
        }
    }

    map.insert("USDT".into(), 1.0);
    map.insert("USDC".into(), 1.0);

    require_core(&map, "kraken")?;
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
    .unwrap_or_else(|e| {
        tracing::warn!(error = %e, direction, "Failed to fetch sparkline data");
        Vec::new()
    });

    rows.into_iter()
        .map(|r| r.rate.to_string().parse::<f64>().unwrap_or(0.0))
        .collect()
}
