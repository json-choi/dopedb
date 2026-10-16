//! Workspace administration from Desktop.
//!
//! Members, connection grants, provider integrations, backups and account
//! sessions are owned by the hosted control plane. Desktop sends one closed,
//! validated operation at a time with the signed-in account's Bearer session,
//! which stays in Rust, and returns the status and bounded JSON body to the screen.

mod adapters;
mod application;
pub(crate) mod domain;
mod ports;
pub(crate) mod transport;

use adapters::HostedWorkspaceAdmin;
pub(crate) use application::WorkspaceAdminUseCases;

pub(crate) type WorkspaceAdminFeature = WorkspaceAdminUseCases<HostedWorkspaceAdmin>;

pub(crate) fn compose() -> WorkspaceAdminFeature {
    WorkspaceAdminUseCases::new(HostedWorkspaceAdmin)
}

#[cfg(test)]
pub(crate) fn assert_workspace_admin_contract() {
    domain::assert_workspace_admin_route_contract();
    adapters::assert_workspace_admin_url_contract();
}
