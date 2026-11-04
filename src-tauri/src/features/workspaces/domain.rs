//! Workspace domain values and invariants.
//!
//! These contracts contain no Tauri, SQLite, HTTP, keychain, or connection-pool
//! details. Typed identities keep account, workspace, and connection selectors from
//! being exchanged accidentally while preserving the existing string/UUID wire shape.

use crate::error::{AppError, AppResult};
use crate::kernel::access::WorkspaceKind;
use crate::kernel::identity::{AccountId, ConnectionId, WorkspaceId};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Workspace {
    pub(crate) id: WorkspaceId,
    pub(crate) name: String,
    pub(crate) kind: WorkspaceKind,
    pub(crate) lifecycle_state: WorkspaceLifecycleState,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceFeatureState {
    pub(crate) enabled: bool,
}

/// Public identity fields returned after the hosted authority validates a session.
/// The bearer token itself never enters this domain value or crosses IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceAuthUser {
    pub(crate) id: AccountId,
    pub(crate) email: String,
    pub(crate) display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceAccountMembership {
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) role: WorkspaceRole,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceAuthAccount {
    pub(crate) user: WorkspaceAuthUser,
    pub(crate) memberships: Vec<WorkspaceAccountMembership>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceAuthState {
    pub(crate) authenticated: bool,
    pub(crate) user: Option<WorkspaceAuthUser>,
    pub(crate) accounts: Vec<WorkspaceAuthAccount>,
    /// Monotonic identity for every active workspace/account/membership authority.
    /// Renderer caches and external stores must scope private state to this value.
    pub(crate) authority_generation: i64,
    /// Where promoting this device's team-local connections to team connections stands.
    pub(crate) connection_promotion: ConnectionPromotionStatus,
}

/// Closed counts only: connections shared since launch, and the still-local ones by reason.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionPromotionStatus {
    pub(crate) promoted: usize,
    /// The account's role is below editor.
    pub(crate) role_denied: usize,
    /// The workspace service could not be reached; retried automatically.
    pub(crate) unreachable: usize,
    /// The service or this device refused the connection as it is.
    pub(crate) refused: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkspaceLoginStatus {
    SignedIn,
    Denied,
    Expired,
}

/// Public Desktop handoff metadata; native PKCE credentials never cross IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceDesktopAuthorization {
    pub(crate) attempt_id: String,
    pub(crate) authorization_url: String,
    pub(crate) expires_in: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceLoginResult {
    pub(crate) status: WorkspaceLoginStatus,
    pub(crate) user: Option<WorkspaceAuthUser>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkspaceLifecycleState {
    Active,
    Archived,
    Deleted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkspaceRole {
    Viewer,
    Analyst,
    Editor,
    Admin,
    Owner,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RemoteWorkspace {
    pub(crate) id: WorkspaceId,
    pub(crate) name: String,
    pub(crate) role: WorkspaceRole,
}

/// One payload-free page of the hosted workspace change journal. A page only
/// selects authoritative collections to reconcile; resource ids, audit summaries,
/// credentials, Article definitions, and result evidence never cross this contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct WorkspacePullPage {
    pub(crate) next_cursor: i64,
    pub(crate) has_more: bool,
    pub(crate) reset: bool,
    pub(crate) refresh_connections: bool,
    pub(crate) refresh_analyses: bool,
    pub(crate) connection_tombstone: bool,
    pub(crate) analysis_tombstone: bool,
}

/// Complete local authority snapshot used after a hosted refresh. The active scope,
/// its generation, and active connection revisions decide which process capabilities
/// survive; the all-account grant set separately drives provider-binding cleanup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceAuthorityFingerprint {
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) account_scope: String,
    pub(crate) generation: i64,
    /// Active-scope connection and member-local binding revisions. A remote
    /// collection refresh can change one exact Agent grant without changing the
    /// workspace membership generation, so transport fencing compares this set too.
    pub(crate) connections: Vec<(ConnectionId, i64, i64)>,
    pub(crate) grants: Vec<(AccountId, WorkspaceId, WorkspaceRole)>,
}

pub(crate) fn workspace_feature_enabled(raw: Option<&str>) -> bool {
    raw.map(|value| {
        !matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "0" | "false" | "off"
        )
    })
    .unwrap_or(true)
}

pub(crate) fn parse_workspace_role(value: Option<&str>) -> AppResult<WorkspaceRole> {
    match value.unwrap_or("viewer") {
        "viewer" => Ok(WorkspaceRole::Viewer),
        "analyst" => Ok(WorkspaceRole::Analyst),
        "editor" => Ok(WorkspaceRole::Editor),
        "admin" => Ok(WorkspaceRole::Admin),
        "owner" => Ok(WorkspaceRole::Owner),
        _ => Err(AppError::Network(
            "workspace membership returned an invalid role".into(),
        )),
    }
}

/// Editors and above create team connections; viewers and analysts only use them.
pub(crate) fn can_create_team_connection(role: WorkspaceRole) -> bool {
    role >= WorkspaceRole::Editor
}

/// A team connection is publishable unless it names a file on one machine: a SQLite path is
/// device-only, while Cloudflare D1 is an account and database identity any member can reach.
pub(crate) fn is_publishable(profile: &crate::model::ConnectionProfile) -> bool {
    profile.engine != crate::model::Engine::Sqlite
        || profile.provider == crate::model::Provider::CloudflareD1
}

pub(crate) fn validate_member_username(username: &str) -> AppResult<&str> {
    let username = username.trim();
    if username.len() > 320 || username.chars().any(char::is_control) {
        return Err(AppError::Config("username is invalid".into()));
    }
    Ok(username)
}

/// TLS file locations a member may keep in their own shared-connection binding.
/// The shared template owns the TLS mode; certificate and key files live on each
/// member's device, so their paths stay in the local binding and never reach the
/// workspace. MongoDB has no template TLS mode, so its enable flag is member-local.
const SQL_MEMBER_TLS_FILES: [&str; 3] = ["sslrootcert", "sslcert", "sslkey"];
const MONGO_MEMBER_TLS_FILES: [&str; 2] = ["tlsCAFile", "tlsCertificateKeyFile"];
const MONGO_MEMBER_TLS_FLAG: &str = "tls";
const MAX_MEMBER_TLS_PATH_CHARS: usize = 4_096;

/// Apply requested member-local TLS settings to a binding's parameters. An empty
/// value removes the setting; keys outside the engine's allowlist are rejected so
/// this path cannot smuggle other driver options into the binding.
pub(crate) fn merge_member_tls_files(
    engine: crate::model::Engine,
    extra_params: &mut std::collections::HashMap<String, String>,
    requested: &std::collections::HashMap<String, String>,
) -> AppResult<()> {
    use crate::model::Engine;
    let (files, flag): (&[&str], Option<&str>) = match engine {
        Engine::Postgres | Engine::Mysql => (&SQL_MEMBER_TLS_FILES, None),
        Engine::Mongodb => (&MONGO_MEMBER_TLS_FILES, Some(MONGO_MEMBER_TLS_FLAG)),
        Engine::Sqlite | Engine::Bigquery => (&[], None),
    };
    for (key, value) in requested {
        let value = value.trim();
        if flag == Some(key.as_str()) {
            match value {
                "true" => {
                    extra_params.insert(key.clone(), "true".into());
                }
                "" => {
                    extra_params.remove(key);
                }
                _ => return Err(AppError::Config("TLS setting is invalid".into())),
            }
            continue;
        }
        if !files.contains(&key.as_str()) {
            return Err(AppError::Config(
                "this TLS setting is not available for the connection engine".into(),
            ));
        }
        if value.chars().count() > MAX_MEMBER_TLS_PATH_CHARS || value.chars().any(char::is_control)
        {
            return Err(AppError::Config("TLS file path is invalid".into()));
        }
        if value.is_empty() {
            extra_params.remove(key);
        } else {
            extra_params.insert(key.clone(), value.to_owned());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::model::{ConnectionProfile, Engine, Provider};

    fn profile(engine: Engine, provider: Provider) -> ConnectionProfile {
        let mut profile: ConnectionProfile = serde_json::from_value(serde_json::json!({
            "id": uuid::Uuid::new_v4(),
            "name": "workspace-domain-fixture",
            "engine": "postgres",
            "host": "db.example.invalid",
            "port": 5432,
            "database": "app",
            "username": "reader",
            "sslmode": "require",
            "readonlyDefault": true,
            "allowWrites": false,
            "secretRef": null
        }))
        .expect("fixture profile");
        profile.engine = engine;
        profile.provider = provider;
        profile
    }

    fn params(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect()
    }

    #[test]
    fn membership_roles_feature_flags_and_usernames_fail_closed() {
        // A hosted role string is accepted only in its exact lowercase spelling;
        // anything else is a malformed authority response, never a guessed role.
        for (raw, role) in [
            (None, WorkspaceRole::Viewer),
            (Some("viewer"), WorkspaceRole::Viewer),
            (Some("analyst"), WorkspaceRole::Analyst),
            (Some("editor"), WorkspaceRole::Editor),
            (Some("admin"), WorkspaceRole::Admin),
            (Some("owner"), WorkspaceRole::Owner),
        ] {
            assert_eq!(parse_workspace_role(raw).unwrap(), role, "{raw:?}");
        }
        for raw in ["", "Owner", " admin", "superuser", "editor\n"] {
            assert!(
                matches!(parse_workspace_role(Some(raw)), Err(AppError::Network(_))),
                "role {raw:?} must be rejected"
            );
        }
        // Only editors and above may create team connections.
        for (role, allowed) in [
            (WorkspaceRole::Viewer, false),
            (WorkspaceRole::Analyst, false),
            (WorkspaceRole::Editor, true),
            (WorkspaceRole::Admin, true),
            (WorkspaceRole::Owner, true),
        ] {
            assert_eq!(can_create_team_connection(role), allowed, "{role:?}");
        }

        // The workspace feature is on unless explicitly disabled.
        for (raw, enabled) in [
            (None, true),
            (Some("1"), true),
            (Some("true"), true),
            (Some("unexpected"), true),
            (Some("0"), false),
            (Some("false"), false),
            (Some(" OFF "), false),
            (Some("False"), false),
        ] {
            assert_eq!(workspace_feature_enabled(raw), enabled, "{raw:?}");
        }

        assert_eq!(
            validate_member_username("  reader@example.invalid ").unwrap(),
            "reader@example.invalid"
        );
        let longest = "u".repeat(320);
        assert_eq!(validate_member_username(&longest).unwrap(), longest);
        for invalid in ["u".repeat(321), "read\u{0}er".into(), "reader\nrole".into()] {
            assert!(
                matches!(validate_member_username(&invalid), Err(AppError::Config(_))),
                "username {invalid:?} must be rejected"
            );
        }

        // A SQLite file path is device-only; Cloudflare D1 and network engines publish.
        assert!(!is_publishable(&profile(Engine::Sqlite, Provider::Generic)));
        assert!(!is_publishable(&profile(Engine::Sqlite, Provider::Auto)));
        assert!(is_publishable(&profile(
            Engine::Sqlite,
            Provider::CloudflareD1
        )));
        assert!(is_publishable(&profile(Engine::Postgres, Provider::Neon)));
        assert!(is_publishable(&profile(Engine::Mongodb, Provider::Generic)));
    }

    #[test]
    fn member_tls_merge_accepts_only_engine_allowlisted_device_paths() {
        // SQL engines keep certificate paths member-local; an empty value removes one.
        for engine in [Engine::Postgres, Engine::Mysql] {
            let mut current = params(&[("sslkey", "/old/key.pem"), ("connect_timeout", "5")]);
            merge_member_tls_files(
                engine,
                &mut current,
                &params(&[
                    ("sslrootcert", "  /certs/root.pem "),
                    ("sslcert", "/certs/client.pem"),
                    ("sslkey", "  "),
                ]),
            )
            .unwrap();
            assert_eq!(
                current,
                params(&[
                    ("sslrootcert", "/certs/root.pem"),
                    ("sslcert", "/certs/client.pem"),
                    ("connect_timeout", "5"),
                ]),
                "{engine:?}"
            );
        }

        // MongoDB owns a member-local enable flag that accepts only `true` or removal.
        let mut mongo = HashMap::new();
        merge_member_tls_files(
            Engine::Mongodb,
            &mut mongo,
            &params(&[("tls", " true "), ("tlsCAFile", "/certs/ca.pem")]),
        )
        .unwrap();
        assert_eq!(
            mongo,
            params(&[("tls", "true"), ("tlsCAFile", "/certs/ca.pem")])
        );
        merge_member_tls_files(Engine::Mongodb, &mut mongo, &params(&[("tls", "")])).unwrap();
        assert_eq!(mongo, params(&[("tlsCAFile", "/certs/ca.pem")]));

        // Nothing outside the engine allowlist can be smuggled into the binding,
        // and a rejected request leaves the existing parameters untouched.
        let too_long = "p".repeat(MAX_MEMBER_TLS_PATH_CHARS + 1);
        for (engine, key, value) in [
            (Engine::Postgres, "sslmode", "disable"),
            (Engine::Postgres, "host", "attacker.example.invalid"),
            (Engine::Postgres, "tls", "true"),
            (Engine::Mysql, "tlsCAFile", "/certs/ca.pem"),
            (Engine::Mongodb, "sslrootcert", "/certs/root.pem"),
            (Engine::Mongodb, "tls", "false"),
            (Engine::Mongodb, "tlsInsecure", "true"),
            (Engine::Sqlite, "sslrootcert", "/certs/root.pem"),
            (Engine::Bigquery, "sslcert", "/certs/client.pem"),
            (
                Engine::Postgres,
                "sslcert",
                "/certs/client.pem\nsslmode=disable",
            ),
            (Engine::Mongodb, "tlsCertificateKeyFile", too_long.as_str()),
        ] {
            let mut current = params(&[("sslmode", "verify-full")]);
            assert!(
                matches!(
                    merge_member_tls_files(engine, &mut current, &params(&[(key, value)])),
                    Err(AppError::Config(_))
                ),
                "{engine:?} {key}={value:?} must be rejected"
            );
            assert_eq!(
                current,
                params(&[("sslmode", "verify-full")]),
                "{engine:?} {key}"
            );
        }
        let longest = "p".repeat(MAX_MEMBER_TLS_PATH_CHARS);
        let mut current = HashMap::new();
        merge_member_tls_files(
            Engine::Postgres,
            &mut current,
            &params(&[("sslcert", longest.as_str())]),
        )
        .unwrap();
        assert_eq!(current.get("sslcert"), Some(&longest));
    }
}
