pub mod deposit_monitor;
pub mod withdrawal_processor;
pub mod confirmation_checker;
pub mod expiry;
pub mod sentinel_watch;
pub mod transparency_seal;

use crate::AppState;

pub fn spawn_all(state: AppState) {
    tokio::spawn(deposit_monitor::run(state.clone()));
    tokio::spawn(confirmation_checker::run(state.clone()));
    tokio::spawn(withdrawal_processor::run(state.clone()));
    tokio::spawn(expiry::run(state.clone()));
    tokio::spawn(sentinel_watch::run(state.clone()));
    tokio::spawn(transparency_seal::run(state.clone()));
    tracing::info!("Background tasks spawned");
}
