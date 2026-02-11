use anyhow::Result;
use redis::aio::ConnectionManager;

/// Build the Redis key used for sliding-window rate limiting.
///
/// Format: `rl:{ip}:{endpoint}`
pub fn rate_limit_key(ip: &str, endpoint: &str) -> String {
    format!("rl:{ip}:{endpoint}")
}

/// Sliding-window rate limiter backed by a Redis sorted set.
///
/// Each request is recorded as a member with the current timestamp as its
/// score.  Old entries outside the window are pruned, and the remaining
/// cardinality is compared against the limit.
///
/// Returns `Ok(true)` when the request is **allowed**, `Ok(false)` when it
/// should be rejected as rate-limited.
pub async fn check_rate_limit(
    redis: &mut ConnectionManager,
    key: &str,
    limit: u32,
    window_secs: u64,
) -> Result<bool> {
    let now = chrono::Utc::now().timestamp_millis() as f64;
    let window_start = now - (window_secs as f64 * 1000.0);

    // Unique member: timestamp + small random suffix to avoid collisions when
    // multiple requests arrive within the same millisecond.
    let member = format!("{now}:{}", rand::random::<u32>());

    // Execute atomically with a pipeline (MULTI/EXEC).
    let (_, _, count, _): (i64, i64, i64, i64) = redis::pipe()
        .atomic()
        // 1. Add the current request
        .cmd("ZADD")
        .arg(key)
        .arg(now)
        .arg(&member)
        // 2. Remove entries outside the sliding window
        .cmd("ZREMRANGEBYSCORE")
        .arg(key)
        .arg("-inf")
        .arg(window_start)
        // 3. Count remaining entries
        .cmd("ZCARD")
        .arg(key)
        // 4. Set TTL so the key auto-expires if unused
        .cmd("EXPIRE")
        .arg(key)
        .arg(window_secs as i64 + 1)
        .query_async(redis)
        .await?;

    Ok(count <= limit as i64)
}

/// Convenience wrapper around the core limiter that uses the
/// [`crate::AppState`] defaults.
#[derive(Clone)]
pub struct RateLimiter {
    pub redis: ConnectionManager,
    pub default_limit: u32,
    pub default_window_secs: u64,
}

impl RateLimiter {
    pub fn new(redis: ConnectionManager, default_limit: u32, default_window_secs: u64) -> Self {
        Self {
            redis,
            default_limit,
            default_window_secs,
        }
    }

    /// Check the rate limit using the configured defaults.
    pub async fn is_allowed(&self, ip: &str, endpoint: &str) -> Result<bool> {
        let key = rate_limit_key(ip, endpoint);
        let mut conn = self.redis.clone();
        check_rate_limit(&mut conn, &key, self.default_limit, self.default_window_secs).await
    }

    /// Check the rate limit with caller-supplied overrides.
    pub async fn is_allowed_with(
        &self,
        ip: &str,
        endpoint: &str,
        limit: u32,
        window_secs: u64,
    ) -> Result<bool> {
        let key = rate_limit_key(ip, endpoint);
        let mut conn = self.redis.clone();
        check_rate_limit(&mut conn, &key, limit, window_secs).await
    }
}
