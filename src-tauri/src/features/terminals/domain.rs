//! Serializable advanced Shell contracts and immutable session metadata.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::kernel::identity::{ConnectionId, TerminalSessionId, WorkspaceId};
use crate::model::Engine;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalProfile {
    Shell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalLifecycle {
    Starting,
    Running,
    Stopping,
    Exited,
    Failed,
}

impl TerminalLifecycle {
    pub(super) const fn is_terminal(self) -> bool {
        matches!(self, Self::Exited | Self::Failed)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalDatabasePolicy {
    ReadOnly,
    ApprovalRequired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSize {
    pub cols: u16,
    pub rows: u16,
    #[serde(default)]
    pub pixel_width: u16,
    #[serde(default)]
    pub pixel_height: u16,
}

impl Default for TerminalSize {
    fn default() -> Self {
        Self {
            cols: 100,
            rows: 30,
            pixel_width: 0,
            pixel_height: 0,
        }
    }
}

impl TerminalSize {
    pub(super) fn validate(self) -> Result<Self, &'static str> {
        if !(10..=1_000).contains(&self.cols)
            || !(2..=500).contains(&self.rows)
            || self.pixel_width > 32_000
            || self.pixel_height > 32_000
        {
            return Err("terminal dimensions are outside the supported bounds");
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalCreateRequest {
    pub connection_id: ConnectionId,
    pub profile: TerminalProfile,
    #[serde(default)]
    pub size: TerminalSize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalConnectionPin {
    pub workspace_id: WorkspaceId,
    pub account_scope: String,
    pub scope_generation: i64,
    pub connection_id: ConnectionId,
    pub connection_revision: i64,
    pub connection_name: String,
    pub database: String,
    pub environment: Option<String>,
    pub engine: Engine,
    pub policy: TerminalDatabasePolicy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExit {
    pub success: bool,
    pub code: Option<u32>,
    pub signal: Option<String>,
    pub at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionSummary {
    pub id: TerminalSessionId,
    pub name: String,
    pub profile: TerminalProfile,
    pub lifecycle: TerminalLifecycle,
    pub size: TerminalSize,
    pub connection: TerminalConnectionPin,
    pub created_at: DateTime<Utc>,
    pub last_activity_at: DateTime<Utc>,
    pub exit: Option<TerminalExit>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputChunk {
    pub session_id: TerminalSessionId,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStateEvent {
    pub session: TerminalSessionSummary,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_request_size_bounds_and_terminal_lifecycle_are_closed() {
        // The renderer may omit the size, but it cannot add fields beside the
        // exact connection selector and profile.
        let connection_id = uuid::Uuid::new_v4();
        let request: TerminalCreateRequest = serde_json::from_value(serde_json::json!({
            "connectionId": connection_id,
            "profile": "shell"
        }))
        .unwrap();
        assert_eq!(uuid::Uuid::from(request.connection_id), connection_id);
        assert_eq!(request.size, TerminalSize::default());
        assert_eq!(
            request.size.validate(),
            Ok(TerminalSize {
                cols: 100,
                rows: 30,
                pixel_width: 0,
                pixel_height: 0,
            })
        );
        for rejected in [
            serde_json::json!({ "connectionId": connection_id, "profile": "shell", "command": "sh" }),
            serde_json::json!({ "connectionId": connection_id, "profile": "agent" }),
            serde_json::json!({ "profile": "shell" }),
        ] {
            assert!(
                serde_json::from_value::<TerminalCreateRequest>(rejected.clone()).is_err(),
                "{rejected}"
            );
        }

        let size = |cols, rows, pixel_width, pixel_height| TerminalSize {
            cols,
            rows,
            pixel_width,
            pixel_height,
        };
        for accepted in [size(10, 2, 0, 0), size(1_000, 500, 32_000, 32_000)] {
            assert_eq!(accepted.validate(), Ok(accepted));
        }
        for rejected in [
            size(9, 30, 0, 0),
            size(1_001, 30, 0, 0),
            size(100, 1, 0, 0),
            size(100, 501, 0, 0),
            size(100, 30, 32_001, 0),
            size(100, 30, 0, 32_001),
        ] {
            assert!(rejected.validate().is_err(), "{rejected:?}");
        }

        // Only exited and failed sessions are terminal; a stopping session still
        // owns its process tree.
        for (lifecycle, terminal) in [
            (TerminalLifecycle::Starting, false),
            (TerminalLifecycle::Running, false),
            (TerminalLifecycle::Stopping, false),
            (TerminalLifecycle::Exited, true),
            (TerminalLifecycle::Failed, true),
        ] {
            assert_eq!(lifecycle.is_terminal(), terminal, "{lifecycle:?}");
        }
    }
}
