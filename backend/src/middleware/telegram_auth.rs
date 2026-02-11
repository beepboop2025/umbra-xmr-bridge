use anyhow::{anyhow, Result};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::BTreeMap;

type HmacSha256 = Hmac<Sha256>;

/// Parsed Telegram WebApp user payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramUser {
    pub id: i64,
    pub first_name: String,
    #[serde(default)]
    pub last_name: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub language_code: Option<String>,
}

/// Verify Telegram WebApp `initData` using HMAC-SHA-256.
///
/// Reference: <https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app>
///
/// Steps:
/// 1. Parse the query-string into key/value pairs.
/// 2. Extract and remove the `hash` parameter.
/// 3. Sort the remaining pairs alphabetically by key.
/// 4. Build a check string as `key=value\n` (newline-separated, no trailing
///    newline).
/// 5. Compute `secret_key = HMAC-SHA-256("WebAppData", bot_token)`.
/// 6. Compute `data_hash  = HMAC-SHA-256(secret_key, check_string)`.
/// 7. Compare `data_hash` (hex) with the extracted `hash`.
/// 8. Deserialize the `user` JSON object into [`TelegramUser`].
pub fn verify_telegram_init_data(init_data: &str, bot_token: &str) -> Result<TelegramUser> {
    // 1. Parse query string
    let pairs: Vec<(String, String)> = url::form_urlencoded::parse(init_data.as_bytes())
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();

    if pairs.is_empty() {
        return Err(anyhow!("Empty init_data"));
    }

    // 2. Extract hash
    let hash = pairs
        .iter()
        .find(|(k, _)| k == "hash")
        .map(|(_, v)| v.clone())
        .ok_or_else(|| anyhow!("Missing hash in init_data"))?;

    // 3. Collect remaining pairs and sort alphabetically by key
    let sorted: BTreeMap<&str, &str> = pairs
        .iter()
        .filter(|(k, _)| k != "hash")
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();

    // 4. Build check string ("key=value\n...")
    let check_string: String = sorted
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("\n");

    // 5. secret_key = HMAC-SHA-256("WebAppData", bot_token)
    let mut secret_mac =
        HmacSha256::new_from_slice(b"WebAppData").expect("HMAC can take any key size");
    secret_mac.update(bot_token.as_bytes());
    let secret_key = secret_mac.finalize().into_bytes();

    // 6. data_hash = HMAC-SHA-256(secret_key, check_string)
    let mut data_mac =
        HmacSha256::new_from_slice(&secret_key).expect("HMAC can take any key size");
    data_mac.update(check_string.as_bytes());
    let computed = hex::encode(data_mac.finalize().into_bytes());

    // 7. Constant-time-ish comparison (both are lowercase hex)
    if computed != hash {
        return Err(anyhow!("Invalid init_data hash"));
    }

    // 8. Deserialize the `user` JSON payload
    let user_json = sorted
        .get("user")
        .ok_or_else(|| anyhow!("Missing user field in init_data"))?;

    let user: TelegramUser =
        serde_json::from_str(user_json).map_err(|e| anyhow!("Invalid user JSON: {e}"))?;

    Ok(user)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_data() {
        let result = verify_telegram_init_data("", "fake_token");
        assert!(result.is_err());
    }

    #[test]
    fn rejects_missing_hash() {
        let result = verify_telegram_init_data("user=%7B%22id%22%3A1%7D", "fake_token");
        assert!(result.is_err());
    }

    #[test]
    fn rejects_bad_hash() {
        let data = "user=%7B%22id%22%3A1%2C%22first_name%22%3A%22Test%22%7D&hash=deadbeef";
        let result = verify_telegram_init_data(data, "fake_token");
        assert!(result.is_err());
    }
}
