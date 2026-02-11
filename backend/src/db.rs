use sqlx::postgres::{PgPool, PgPoolOptions};
use crate::config::Config;

pub type Pool = PgPool;

pub async fn connect(config: &Config) -> Pool {
    PgPoolOptions::new()
        .max_connections(config.db_max_connections)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect(&config.database_url)
        .await
        .expect("Failed to connect to PostgreSQL")
}
