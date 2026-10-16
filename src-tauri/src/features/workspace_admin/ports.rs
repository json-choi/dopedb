//! Platform ports required by workspace administration use cases.

use std::future::Future;

use crate::error::AppResult;
use crate::kernel::identity::AccountId;

use super::domain::{AdminRoute, WorkspaceAdminResponse};

/// Authenticated transport to the hosted control plane. The Bearer session is
/// resolved and used entirely inside the adapter.
pub(crate) trait WorkspaceAdminControlPlanePort: Clone + Send + Sync + 'static {
    fn execute(
        &self,
        account_id: &AccountId,
        route: AdminRoute,
    ) -> impl Future<Output = AppResult<WorkspaceAdminResponse>> + Send;

    /// The validated control-plane origin used for every request.
    fn origin(&self) -> AppResult<String>;
}
