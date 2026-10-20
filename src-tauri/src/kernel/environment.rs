//! The fixed environment list shared by Project environments, connection labels,
//! and every production safeguard.

use serde::{Deserialize, Serialize};

/// The fixed environment list. The kind is the environment: a Project holds at
/// most one environment per kind, and every production safeguard derives from
/// the most sensitive kind a connection reaches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnvironmentKind {
    Production,
    Staging,
    Test,
    Development,
}

impl EnvironmentKind {
    /// Higher is more sensitive: production > staging > test > development.
    pub(crate) fn sensitivity(self) -> u8 {
        match self {
            Self::Production => 3,
            Self::Staging => 2,
            Self::Test => 1,
            Self::Development => 0,
        }
    }

    pub(crate) fn most_sensitive(kinds: impl IntoIterator<Item = Self>) -> Option<Self> {
        kinds.into_iter().max_by_key(|kind| kind.sensitivity())
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Production => "production",
            Self::Staging => "staging",
            Self::Test => "test",
            Self::Development => "development",
        }
    }

    /// Accepts the stored kind names and the short labels (`prod`, `dev`) that
    /// earlier connection profiles used; any other label is not an environment.
    /// The label that travels to the control plane and is stored there. Desktops that predate
    /// the fixed list only check `prod`, so production keeps that token on the wire.
    pub(crate) fn wire_token(self) -> &'static str {
        match self {
            Self::Production => "prod",
            Self::Staging => "staging",
            Self::Test => "test",
            Self::Development => "dev",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "production" | "prod" => Some(Self::Production),
            "staging" => Some(Self::Staging),
            "test" => Some(Self::Test),
            "development" | "dev" => Some(Self::Development),
            _ => None,
        }
    }
}

/// The single effective-environment rule behind every production safeguard: the most
/// sensitive kind among the Project environments a connection is bound to in the active
/// workspace and the connection's own label. A production label is never lowered by a
/// development binding.
pub(crate) fn effective_environment(
    own: Option<EnvironmentKind>,
    bound: impl IntoIterator<Item = EnvironmentKind>,
) -> Option<EnvironmentKind> {
    EnvironmentKind::most_sensitive(bound.into_iter().chain(own))
}

/// Serde adapter for an optional stored label: an unrecognised or retired label
/// (`custom`, free text) reads as no environment instead of failing the profile.
pub(crate) fn deserialize_optional_kind<'de, D>(
    deserializer: D,
) -> Result<Option<EnvironmentKind>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let label = Option::<String>::deserialize(deserializer)?;
    Ok(label.as_deref().and_then(EnvironmentKind::parse))
}
