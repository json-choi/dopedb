//! Concrete workspace adapters.

pub(crate) mod control_plane;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub(crate) mod desktop_login_callback;
mod local;

pub(crate) use control_plane::HostedWorkspaceControlPlane;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub(crate) use desktop_login_callback::register_workspace_login_callback;
pub(crate) use local::{
    ConnectionWorkspaceRuntime, ProcessWorkspaceConfiguration, SqliteWorkspaceRepository,
    SystemWorkspaceSshProfile,
};
