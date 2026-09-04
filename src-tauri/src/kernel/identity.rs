//! Strong resource identities used at feature boundaries.
//!
//! A raw UUID can otherwise be passed to the wrong lookup without a compiler error.
//! These transparent wrappers keep the existing wire representation while making
//! connection, workspace, and document identities distinct inside the Rust core.

use std::fmt;
use std::ops::Deref;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

macro_rules! uuid_identity {
    ($name:ident) => {
        #[derive(
            Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
        )]
        #[serde(transparent)]
        pub(crate) struct $name(Uuid);

        impl From<Uuid> for $name {
            fn from(value: Uuid) -> Self {
                Self(value)
            }
        }

        impl From<$name> for Uuid {
            fn from(value: $name) -> Self {
                value.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }
    };
}

uuid_identity!(WorkspaceId);
uuid_identity!(ConnectionId);
uuid_identity!(SqlDocumentId);
uuid_identity!(ErdLayoutId);
uuid_identity!(ErdVirtualRelationId);
uuid_identity!(QueryRunId);
uuid_identity!(QueryExecutionId);
uuid_identity!(TerminalSessionId);
uuid_identity!(AcpSessionId);
uuid_identity!(RuntimeId);
uuid_identity!(JobId);
uuid_identity!(JobFileCapabilityId);
uuid_identity!(JobArtifactId);
uuid_identity!(OperationId);
// Provider credentials are local, capability-bearing resources. Keeping their
// identities distinct prevents an integration id from ever being used as a
// keyring-item id or a one-use receipt id by accident.
uuid_identity!(ProviderIntegrationId);
uuid_identity!(ProviderBindingId);
uuid_identity!(ProviderCredentialReceiptId);
uuid_identity!(DeviceId);

/// Complete job lookup identity. A job UUID is never loaded without the
/// connection scope that gives it meaning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct ConnectionJobId {
    pub(crate) connection_id: ConnectionId,
    pub(crate) job_id: JobId,
}

/// Public account identity returned by the hosted authentication authority.
///
/// It is deliberately distinct from [`AccountScopeId`]: an account identifies a
/// signed-in person, while an account scope is the local storage partition derived
/// from the currently selected workspace/account pair.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub(crate) struct AccountId(String);

impl AccountId {
    pub(crate) fn new(value: impl Into<String>) -> Option<Self> {
        let value = value.into();
        (!value.is_empty()
            && value.len() <= 255
            && !value
                .chars()
                .any(|character| character.is_whitespace() || character.is_control()))
        .then_some(Self(value))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for AccountId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).ok_or_else(|| serde::de::Error::custom("invalid account id"))
    }
}

impl fmt::Display for AccountId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl Deref for AccountId {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        self.as_str()
    }
}

/// Stable, non-secret account partition used by local synchronized artifacts.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct AccountScopeId(String);

impl AccountScopeId {
    pub(crate) fn new(value: impl Into<String>) -> Option<Self> {
        let value = value.into();
        (!value.is_empty()).then_some(Self(value))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

/// Complete database resource identity. A connection UUID is never looked up without
/// the workspace that gives it meaning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct WorkspaceConnectionId {
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) connection_id: ConnectionId,
}
