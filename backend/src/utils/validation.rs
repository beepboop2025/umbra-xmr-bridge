use regex::Regex;
use std::sync::OnceLock;

/// All chains the bridge currently supports.
pub const SUPPORTED_CHAINS: &[&str] = &[
    "XMR", "BTC", "ETH", "TON", "SOL", "ARB", "BASE", "USDC", "USDT",
];

/// Returns `true` if `chain` (case-insensitive) is a supported chain.
pub fn is_valid_chain(chain: &str) -> bool {
    let upper = chain.to_uppercase();
    SUPPORTED_CHAINS.iter().any(|&c| c == upper)
}

/// Validate a blockchain address for the given chain.
///
/// Dispatches to the chain-specific validator. Returns `false` for unknown
/// chains.
pub fn validate_address(chain: &str, address: &str) -> bool {
    match chain.to_uppercase().as_str() {
        "XMR" => validate_xmr_address(address),
        "BTC" => validate_btc_address(address),
        "ETH" | "ARB" | "BASE" | "USDC" | "USDT" => validate_eth_address(address),
        "TON" => validate_ton_address(address),
        "SOL" => validate_sol_address(address),
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Per-chain validators
// ---------------------------------------------------------------------------

/// Monero: standard address starts with `4`, sub-address starts with `8`,
/// followed by 94 base58 characters.
pub fn validate_xmr_address(addr: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^[48][1-9A-HJ-NP-Za-km-z]{94}$").unwrap());
    re.is_match(addr)
}

/// Bitcoin: supports bech32 (bc1...), P2PKH (1...), and P2SH (3...) formats.
pub fn validate_btc_address(addr: &str) -> bool {
    static RE_BECH32: OnceLock<Regex> = OnceLock::new();
    static RE_P2PKH: OnceLock<Regex> = OnceLock::new();
    static RE_P2SH: OnceLock<Regex> = OnceLock::new();

    let bech32 =
        RE_BECH32.get_or_init(|| Regex::new(r"^bc1[a-z0-9]{25,87}$").unwrap());
    let p2pkh =
        RE_P2PKH.get_or_init(|| Regex::new(r"^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$").unwrap());
    let p2sh =
        RE_P2SH.get_or_init(|| Regex::new(r"^3[a-km-zA-HJ-NP-Z1-9]{25,34}$").unwrap());

    bech32.is_match(addr) || p2pkh.is_match(addr) || p2sh.is_match(addr)
}

/// Ethereum (and EVM-compatible chains): 0x-prefixed 40-hex-character address.
pub fn validate_eth_address(addr: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^0x[a-fA-F0-9]{40}$").unwrap());
    re.is_match(addr)
}

/// TON: user-friendly format (`EQ` / `UQ` + 46 base64url chars) or raw
/// format (`0:` + 64 hex chars).
pub fn validate_ton_address(addr: &str) -> bool {
    static RE_FRIENDLY: OnceLock<Regex> = OnceLock::new();
    static RE_RAW: OnceLock<Regex> = OnceLock::new();

    let friendly = RE_FRIENDLY
        .get_or_init(|| Regex::new(r"^(EQ|UQ)[A-Za-z0-9_-]{46}$").unwrap());
    let raw =
        RE_RAW.get_or_init(|| Regex::new(r"^0:[a-fA-F0-9]{64}$").unwrap());

    friendly.is_match(addr) || raw.is_match(addr)
}

/// Solana: base58-encoded public key, 32-44 characters.
pub fn validate_sol_address(addr: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$").unwrap());
    re.is_match(addr)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -- Supported chains ---------------------------------------------------

    #[test]
    fn supported_chains() {
        assert!(is_valid_chain("XMR"));
        assert!(is_valid_chain("btc"));
        assert!(is_valid_chain("Eth"));
        assert!(is_valid_chain("SOL"));
        assert!(!is_valid_chain("DOGE"));
    }

    // -- XMR ----------------------------------------------------------------

    #[test]
    fn xmr_valid() {
        // 95-char address starting with 4
        let addr = "4".to_string() + &"A".repeat(94);
        assert!(validate_xmr_address(&addr));
    }

    #[test]
    fn xmr_invalid_short() {
        let addr = "4".to_string() + &"A".repeat(90);
        assert!(!validate_xmr_address(&addr));
    }

    // -- BTC ----------------------------------------------------------------

    #[test]
    fn btc_bech32() {
        assert!(validate_btc_address("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"));
    }

    #[test]
    fn btc_p2pkh() {
        assert!(validate_btc_address("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"));
    }

    #[test]
    fn btc_invalid() {
        assert!(!validate_btc_address("0xinvalid"));
    }

    // -- ETH ----------------------------------------------------------------

    #[test]
    fn eth_valid() {
        assert!(validate_eth_address("0xdAC17F958D2ee523a2206206994597C13D831ec7"));
    }

    #[test]
    fn eth_invalid_no_prefix() {
        assert!(!validate_eth_address("dAC17F958D2ee523a2206206994597C13D831ec7"));
    }

    // -- TON ----------------------------------------------------------------

    #[test]
    fn ton_friendly() {
        let addr = "EQ".to_string() + &"A".repeat(46);
        assert!(validate_ton_address(&addr));
    }

    #[test]
    fn ton_raw() {
        let addr = "0:".to_string() + &"a".repeat(64);
        assert!(validate_ton_address(&addr));
    }

    #[test]
    fn ton_invalid() {
        assert!(!validate_ton_address("invalid_address"));
    }

    // -- SOL ----------------------------------------------------------------

    #[test]
    fn sol_valid() {
        // A typical Solana pubkey (base58, 44 chars)
        assert!(validate_sol_address("11111111111111111111111111111111"));
    }

    #[test]
    fn sol_invalid_too_short() {
        assert!(!validate_sol_address("abc"));
    }

    // -- Dispatch -----------------------------------------------------------

    #[test]
    fn validate_address_dispatch() {
        assert!(validate_address("ETH", "0xdAC17F958D2ee523a2206206994597C13D831ec7"));
        assert!(validate_address("ARB", "0xdAC17F958D2ee523a2206206994597C13D831ec7"));
        assert!(validate_address("BASE", "0xdAC17F958D2ee523a2206206994597C13D831ec7"));
        assert!(validate_address("USDC", "0xdAC17F958D2ee523a2206206994597C13D831ec7"));
        assert!(!validate_address("DOGE", "whatever"));
    }
}
