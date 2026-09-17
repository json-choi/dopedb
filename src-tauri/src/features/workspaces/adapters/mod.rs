//! Concrete workspace adapters.

pub(crate) mod control_plane;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub(crate) mod desktop_callbacks;
pub(crate) mod desktop_login;
mod local;

pub(crate) use control_plane::HostedWorkspaceControlPlane;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub(crate) use desktop_callbacks::register_workspace_callbacks;
pub(crate) use local::{
    ConnectionWorkspaceRuntime, ProcessWorkspaceConfiguration, SqliteWorkspaceRepository,
    SystemWorkspaceSshProfile,
};
