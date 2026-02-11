pub mod deposit_monitor;
pub mod withdrawal_processor;
pub mod confirmation_checker;
pub mod expiry;

use crate::AppState;

pub fn spawn_all(state: AppState) {
    tokio::spawn(deposit_monitor::run(state.clone()));
    tokio::spawn(confirmation_checker::run(state.clone()));
    tokio::spawn(expiry::run(state.clone()));
    tracing::info!("Background tasks spawned");
}
