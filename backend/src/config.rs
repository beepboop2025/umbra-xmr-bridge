use std::env;
use std::net::SocketAddr;

#[derive(Debug, Clone)]
pub struct Config {
    // Server
    pub host: String,
    pub port: u16,

    // Database
    pub database_url: String,
    pub db_max_connections: u32,

    // Redis
    pub redis_url: String,

    // Auth
    pub secret_key: String,
    pub jwt_expiry_hours: u64,

    // Telegram
    pub telegram_bot_token: String,

    // Blockchain RPCs
    pub monero_rpc_url: String,
    pub monero_rpc_user: Option<String>,
    pub monero_rpc_pass: Option<String>,
    pub ton_api_url: String,
    pub ton_api_key: Option<String>,
    pub eth_rpc_url: String,
    pub arbitrum_rpc_url: String,
    pub base_rpc_url: String,
    pub solana_rpc_url: String,
    pub bitcoin_rpc_url: String,
    pub bitcoin_rpc_user: Option<String>,
    pub bitcoin_rpc_pass: Option<String>,

    // Deposit addresses (hot wallets for chains that don't generate per-order addresses)
    pub evm_deposit_address: Option<String>,
    pub ton_deposit_address: Option<String>,
    pub sol_deposit_address: Option<String>,

    // Rate sources
    pub coingecko_api_key: Option<String>,

    // Bridge config
    pub bridge_fee_percent: f64,
    pub fast_lane_fee_percent: f64,
    pub order_expiry_minutes: u64,
    pub mpc_threshold: u32,
    pub mpc_total_signers: u32,

    // Rate limiting
    pub rate_limit_rates_per_min: u32,
    pub rate_limit_orders_per_min: u32,
    pub rate_limit_ws_per_ip: u32,

    // Proof layer
    pub attestation_secret_key: Option<String>,
    pub attestation_pq_seed: Option<String>,
    pub pq_signatures_enabled: bool,
    pub transparency_seal_interval_secs: u64,
    pub canary_statement: String,

    // Sentinel (circuit breaker)
    pub sentinel_enabled: bool,
    pub sentinel_check_interval_secs: u64,
    pub sentinel_max_orders_per_5m: i64,
    pub sentinel_max_failures_per_15m: i64,
    pub sentinel_rate_divergence_percent: f64,
    pub sentinel_outflow_caps: String,

    // CORS
    pub cors_origins: Vec<String>,
}

impl Config {
    pub fn from_env() -> Self {
        dotenvy::dotenv().ok();

        Self {
            host: env("HOST", "0.0.0.0"),
            port: env("PORT", "8000").parse().expect("PORT must be a number"),

            database_url: require_env("DATABASE_URL"),
            db_max_connections: env("DB_MAX_CONNECTIONS", "20").parse().unwrap_or(20),

            redis_url: env("REDIS_URL", "redis://127.0.0.1:6379"),

            secret_key: require_env("SECRET_KEY"),
            jwt_expiry_hours: env("JWT_EXPIRY_HOURS", "24").parse().unwrap_or(24),

            telegram_bot_token: env("TELEGRAM_BOT_TOKEN", ""),

            monero_rpc_url: env("MONERO_RPC_URL", "http://127.0.0.1:18082/json_rpc"),
            monero_rpc_user: env_opt("MONERO_RPC_USER"),
            monero_rpc_pass: env_opt("MONERO_RPC_PASS"),
            ton_api_url: env("TON_API_URL", "https://toncenter.com/api/v2"),
            ton_api_key: env_opt("TON_API_KEY"),
            eth_rpc_url: env("ETH_RPC_URL", "https://eth.llamarpc.com"),
            arbitrum_rpc_url: env("ARBITRUM_RPC_URL", "https://arb1.arbitrum.io/rpc"),
            base_rpc_url: env("BASE_RPC_URL", "https://mainnet.base.org"),
            solana_rpc_url: env("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com"),
            bitcoin_rpc_url: env("BITCOIN_RPC_URL", "http://127.0.0.1:8332"),
            bitcoin_rpc_user: env_opt("BITCOIN_RPC_USER"),
            bitcoin_rpc_pass: env_opt("BITCOIN_RPC_PASS"),

            evm_deposit_address: env_opt("EVM_DEPOSIT_ADDRESS"),
            ton_deposit_address: env_opt("TON_DEPOSIT_ADDRESS"),
            sol_deposit_address: env_opt("SOL_DEPOSIT_ADDRESS"),

            coingecko_api_key: env_opt("COINGECKO_API_KEY"),

            bridge_fee_percent: env("BRIDGE_FEE_PERCENT", "0.3").parse().unwrap_or(0.3),
            fast_lane_fee_percent: env("FAST_LANE_FEE_PERCENT", "0.1").parse().unwrap_or(0.1),
            order_expiry_minutes: env("ORDER_EXPIRY_MINUTES", "30").parse().unwrap_or(30),
            mpc_threshold: env("MPC_THRESHOLD", "2").parse().unwrap_or(2),
            mpc_total_signers: env("MPC_TOTAL_SIGNERS", "3").parse().unwrap_or(3),

            rate_limit_rates_per_min: env("RATE_LIMIT_RATES", "60").parse().unwrap_or(60),
            rate_limit_orders_per_min: env("RATE_LIMIT_ORDERS", "10").parse().unwrap_or(10),
            rate_limit_ws_per_ip: env("RATE_LIMIT_WS", "5").parse().unwrap_or(5),

            attestation_secret_key: env_opt("ATTESTATION_SECRET_KEY"),
            attestation_pq_seed: env_opt("ATTESTATION_PQ_SEED"),
            pq_signatures_enabled: env("PQ_SIGNATURES_ENABLED", "true").parse().unwrap_or(true),
            transparency_seal_interval_secs: env("TRANSPARENCY_SEAL_INTERVAL_SECS", "300")
                .parse()
                .unwrap_or(300),
            canary_statement: env(
                "CANARY_STATEMENT",
                "As of the issuance time below, Umbra has not received any legal demand \
                 to disclose user data, insert backdoors, or alter destination addresses, \
                 and retains full control of its signing keys.",
            ),

            sentinel_enabled: env("SENTINEL_ENABLED", "true").parse().unwrap_or(true),
            sentinel_check_interval_secs: env("SENTINEL_CHECK_INTERVAL_SECS", "30")
                .parse()
                .unwrap_or(30),
            sentinel_max_orders_per_5m: env("SENTINEL_MAX_ORDERS_PER_5M", "60")
                .parse()
                .unwrap_or(60),
            sentinel_max_failures_per_15m: env("SENTINEL_MAX_FAILURES_PER_15M", "10")
                .parse()
                .unwrap_or(10),
            sentinel_rate_divergence_percent: env("SENTINEL_RATE_DIVERGENCE_PERCENT", "5.0")
                .parse()
                .unwrap_or(5.0),
            sentinel_outflow_caps: env("SENTINEL_OUTFLOW_CAPS", ""),

            cors_origins: env("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001")
                .split(',')
                .map(|s| s.trim().to_string())
                .collect(),
        }
    }

    /// Validate configuration invariants at startup. Panics on invalid config.
    pub fn validate(&self) {
        assert!(
            self.secret_key.len() >= 32,
            "SECRET_KEY must be at least 32 characters (got {})",
            self.secret_key.len()
        );
        assert!(
            self.mpc_threshold > 0 && self.mpc_threshold <= self.mpc_total_signers,
            "MPC_THRESHOLD ({}) must be > 0 and <= MPC_TOTAL_SIGNERS ({})",
            self.mpc_threshold,
            self.mpc_total_signers
        );
        assert!(
            self.bridge_fee_percent >= 0.0 && self.bridge_fee_percent <= 10.0,
            "BRIDGE_FEE_PERCENT ({}) must be between 0 and 10",
            self.bridge_fee_percent
        );
        assert!(
            self.order_expiry_minutes >= 5 && self.order_expiry_minutes <= 1440,
            "ORDER_EXPIRY_MINUTES ({}) must be between 5 and 1440",
            self.order_expiry_minutes
        );
        assert!(
            self.db_max_connections >= 1 && self.db_max_connections <= 100,
            "DB_MAX_CONNECTIONS ({}) must be between 1 and 100",
            self.db_max_connections
        );
    }

    pub fn addr(&self) -> SocketAddr {
        format!("{}:{}", self.host, self.port).parse().expect("Invalid address")
    }
}

fn env(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_opt(key: &str) -> Option<String> {
    env::var(key).ok().filter(|s| !s.is_empty())
}

fn require_env(key: &str) -> String {
    env::var(key).unwrap_or_else(|_| panic!("{key} environment variable is required"))
}
