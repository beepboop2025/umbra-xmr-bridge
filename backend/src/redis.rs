use redis::aio::ConnectionManager;
use redis::Client;
use crate::config::Config;

pub type RedisPool = ConnectionManager;

pub async fn connect(config: &Config) -> RedisPool {
    let client = Client::open(config.redis_url.as_str())
        .expect("Invalid Redis URL");
    ConnectionManager::new(client)
        .await
        .expect("Failed to connect to Redis")
}
