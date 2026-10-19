//! Background worker of an administrator device.
//!
//! Every minute it visits the cached provisioned shared databases whose administrator
//! credential this device holds and runs one synchronization pass for each. Offline,
//! signed-out, or busy states wait silently for the next poll; only categorical
//! error kinds are logged.

use std::time::Duration;

use super::application::DirectAccessUseCases;
use super::ports::{
    AdminCredentialVault, DirectControlPlanePort, DirectLocalPort, TargetDatabasePort,
};

const POLL_INTERVAL: Duration = Duration::from_secs(60);
const START_DELAY: Duration = Duration::from_secs(30);
/// PostgreSQL grants are refreshed for new tables every tenth poll.
const REGRANT_EVERY_POLLS: u32 = 10;

impl<V, T, C, L> DirectAccessUseCases<V, T, C, L>
where
    V: AdminCredentialVault,
    T: TargetDatabasePort,
    C: DirectControlPlanePort,
    L: DirectLocalPort,
{
    /// Run forever; spawn once from the application setup.
    pub(crate) async fn run_worker(self) {
        tokio::time::sleep(START_DELAY).await;
        let mut polls = 0u32;
        loop {
            self.poll_once(polls.is_multiple_of(REGRANT_EVERY_POLLS))
                .await;
            polls = polls.wrapping_add(1);
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    }

    pub(super) async fn poll_once(&self, regrant: bool) {
        let Ok(scopes) = self.local.provisioned().await else {
            return;
        };
        for scope in scopes {
            if !self.vault.contains(&scope).unwrap_or(false) {
                continue;
            }
            if let Err(error) = self.sync_once(&scope, false, regrant).await {
                tracing::debug!(error_kind = error.kind(), "direct access poll deferred");
            }
        }
    }
}
