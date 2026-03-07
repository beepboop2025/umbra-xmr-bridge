mod config;
mod db;
mod error;
mod redis;
mod models;
mod routes;
mod services;
mod blockchain;
mod mpc;
mod middleware;
mod tasks;
mod utils;

use std::collections::HashMap;
use std::sync::Arc;
use axum::Router;
use tokio::sync::Mutex;
use tower_http::cors::{CorsLayer, Any};
use tower_http::trace::TraceLayer;
use tower_http::compression::CompressionLayer;
use tower_http::timeout::TimeoutLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::blockchain::bitcoin::BitcoinRpc;
use crate::blockchain::evm::EvmClient;
use crate::blockchain::monero::MoneroRpc;
use crate::blockchain::solana::SolanaClient;
use crate::blockchain::ton::TonClient;
use crate::config::Config;
use crate::mpc::coordinator::MpcCoordinator;
use crate::services::evm_router::EvmRpcRouter;

/// Shared application state accessible in all handlers.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub db: db::Pool,
    pub redis: redis::RedisPool,
    pub http_client: reqwest::Client,

    // Blockchain RPC clients
    pub monero_rpc: Arc<MoneroRpc>,
    pub bitcoin_rpc: Arc<BitcoinRpc>,
    pub evm_rpc: Arc<EvmRpcRouter>,
    pub ton_client: Arc<TonClient>,
    pub solana_rpc: Arc<SolanaClient>,

    // MPC threshold signing
    pub mpc_coordinator: Arc<Mutex<MpcCoordinator>>,
}

#[tokio::main]
async fn main() {
    // Tracing
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "umbra=debug,tower_http=debug".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env();
    config.validate();
    tracing::info!("Starting Umbra API on {}", config.addr());

    // Connect to backing services
    let db_pool = db::connect(&config).await;
    tracing::info!("Connected to PostgreSQL");

    // Run migrations
    sqlx::migrate!("./migrations")
        .run(&db_pool)
        .await
        .expect("Failed to run database migrations");
    tracing::info!("Database migrations complete");

    let redis_pool = redis::connect(&config).await;
    tracing::info!("Connected to Redis");

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .pool_max_idle_per_host(10)
        .build()
        .expect("Failed to create HTTP client");

    // Blockchain RPC clients
    let monero_rpc = Arc::new(MoneroRpc::new(
        &config.monero_rpc_url,
        config.monero_rpc_user.clone(),
        config.monero_rpc_pass.clone(),
    ));

    let bitcoin_rpc = Arc::new(BitcoinRpc::new(
        &config.bitcoin_rpc_url,
        config.bitcoin_rpc_user.clone(),
        config.bitcoin_rpc_pass.clone(),
    ));

    let ton_client = Arc::new(TonClient::new(
        &config.ton_api_url,
        config.ton_api_key.clone(),
    ));

    let solana_rpc = Arc::new(SolanaClient::new(&config.solana_rpc_url));

    // EVM clients — one per supported chain
    let mut evm_clients = HashMap::new();
    evm_clients.insert("ETH".to_string(), EvmClient::new(&config.eth_rpc_url, 1));
    evm_clients.insert("ARB".to_string(), EvmClient::new(&config.arbitrum_rpc_url, 42161));
    evm_clients.insert("BASE".to_string(), EvmClient::new(&config.base_rpc_url, 8453));
    let evm_rpc = Arc::new(EvmRpcRouter::new(evm_clients));

    // MPC coordinator for threshold signing
    let mpc_coordinator = Arc::new(Mutex::new(MpcCoordinator::new(
        config.mpc_threshold,
        config.mpc_total_signers,
    )));

    tracing::info!("Blockchain RPC clients initialized");

    let state = AppState {
        config: Arc::new(config.clone()),
        db: db_pool,
        redis: redis_pool.clone(),
        http_client,
        monero_rpc,
        bitcoin_rpc,
        evm_rpc,
        ton_client,
        solana_rpc,
        mpc_coordinator,
    };

    // Spawn background tasks
    tasks::spawn_all(state.clone());

    // CORS
    let cors = CorsLayer::new()
        .allow_origin(config.cors_origins.iter().filter_map(|o| o.parse().ok()).collect::<Vec<_>>())
        .allow_methods(Any)
        .allow_headers(Any);

    // Prometheus metrics
    let metrics_handle = setup_metrics();

    // Build router
    let app = Router::new()
        .merge(routes::health::router())
        .merge(routes::rates::router())
        .merge(routes::orders::router())
        .merge(routes::admin::router())
        .merge(routes::ws::router())
        .route("/metrics", axum::routing::get(move || async move { metrics_handle.render() }))
        .layer(middleware::security::SecurityHeadersLayer)
        .layer(CompressionLayer::new())
        .layer(TimeoutLayer::new(std::time::Duration::from_secs(30)))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(config.addr())
        .await
        .expect("Failed to bind");

    tracing::info!("Listening on {}", config.addr());
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("Server error");
}

fn setup_metrics() -> metrics_exporter_prometheus::PrometheusHandle {
    let builder = metrics_exporter_prometheus::PrometheusBuilder::new();
    let handle = builder.install_recorder().expect("Failed to install Prometheus recorder");
    handle
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => tracing::info!("Ctrl+C received, shutting down"),
        _ = terminate => tracing::info!("SIGTERM received, shutting down"),
    }
}
