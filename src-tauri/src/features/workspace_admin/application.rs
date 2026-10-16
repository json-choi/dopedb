//! Workspace administration use cases.
//!
//! Desktop is a thin, authenticated client here: the control plane decides every
//! membership, grant, provider and lifecycle change. These use cases only confirm
//! the acting account is signed in on this device, project the closed operation
//! onto its route, and keep provider authorization state out of the webview.

use crate::error::AppResult;
use crate::kernel::identity::AccountId;

use super::domain::{
    require_signed_in_account, validated_provider_start_url, ProviderAuthorizationRequest,
    WorkspaceAdminRequest, WorkspaceAdminResponse,
};
use super::ports::WorkspaceAdminControlPlanePort;

#[derive(Clone)]
pub(crate) struct WorkspaceAdminUseCases<C> {
    control_plane: C,
}

/// A provider authorization either opened the browser start page or returned the
/// control plane's refusal for the screen to explain.
pub(crate) enum ProviderAuthorizationStart {
    Open(String),
    Refused(WorkspaceAdminResponse),
}

impl<C> WorkspaceAdminUseCases<C>
where
    C: WorkspaceAdminControlPlanePort,
{
    pub(crate) fn new(control_plane: C) -> Self {
        Self { control_plane }
    }

    pub(crate) async fn execute(
        &self,
        signed_in: &[AccountId],
        request: WorkspaceAdminRequest,
    ) -> AppResult<WorkspaceAdminResponse> {
        require_signed_in_account(signed_in, &request.account_id)?;
        let route = request.operation.route()?;
        self.control_plane.execute(&request.account_id, route).await
    }

    /// Requests a one-use provider state and returns the same-origin start page.
    /// The state stays in Rust; the webview only learns whether a browser opened.
    pub(crate) async fn start_provider_authorization(
        &self,
        signed_in: &[AccountId],
        request: ProviderAuthorizationRequest,
    ) -> AppResult<ProviderAuthorizationStart> {
        require_signed_in_account(signed_in, &request.account_id)?;
        let response = self
            .control_plane
            .execute(&request.account_id, request.route()?)
            .await?;
        if !(200..300).contains(&response.status) {
            return Ok(ProviderAuthorizationStart::Refused(response));
        }
        let origin = self.control_plane.origin()?;
        validated_provider_start_url(&origin, response.body.as_ref())
            .map(ProviderAuthorizationStart::Open)
    }
}
