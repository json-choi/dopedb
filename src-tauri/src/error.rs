//! Typed error spine. Every fallible path in the crate returns [`AppError`], which
//! serializes to a `{ kind, message, position?, connectionFailure? }` object so
//! `#[tauri::command]` can hand a structured error straight to the frontend.
//!
//! `message` is a developer-facing `Display` rendering and may quote driver text or
//! configuration values, so screens that report a failed connection read the
//! classified `connectionFailure` payload instead. That payload is produced by the
//! single classifier in [`crate::kernel::connection_failure`], which never carries
//! secrets, connection URLs, or OS output.

use thiserror::Error;

use crate::kernel::connection_failure::{serializable_connection_failure, SshTunnelFailure};

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    /// Errors from the target-database drivers (sqlx).
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),

    /// Errors from the MongoDB document-database driver.
    #[error("database error: {0}")]
    Mongo(#[from] mongodb::error::Error),

    /// An agent-facing operation failed or returned unusable output.
    #[error("agent error: {0}")]
    Agent(String),

    /// A hosted control-plane request failed or returned an invalid response.
    #[error("network error: {0}")]
    Network(String),

    /// A bounded operation exhausted its deadline. This is distinct from a transient
    /// network failure so clients do not retry a still-running or expensive operation.
    #[error("timeout: {0}")]
    Timeout(String),

    /// The system OpenSSH tunnel could not be opened. OS `ssh` output is untrusted
    /// input: the transport classifies it into this cause at the boundary and drops
    /// the text, so no stderr reaches the wire, a screen, or a log.
    #[error("ssh tunnel error: {0}")]
    SshTunnel(SshTunnelFailure),

    /// A safety-layer violation the DB or classifier rejected before execution.
    #[error("safety violation: {0}")]
    Safety(String),

    /// SQL parse/classification failure (L1). Treated as fail-safe (→ write).
    #[error("parse error: {0}")]
    Parse(#[from] sqlparser::parser::ParserError),

    /// OS credential-store access failure (macOS Keychain / Windows Credential Manager).
    #[error("credential store error: {0}")]
    Keychain(#[from] keyring::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    /// Malformed or missing configuration (connection profile, agent config, etc.).
    #[error("config error: {0}")]
    Config(String),

    #[error("not found: {0}")]
    NotFound(String),

    /// A secretless shared template is usable, but this member has not connected a
    /// credential in the current device's OS store yet.
    #[error("shared connection credentials are required on this device")]
    CredentialBindingRequired,

    /// An official provider adapter is available, but its member-local login is no
    /// longer usable. The frontend may route this to that provider's explicit
    /// authentication flow; it must not retry the failed operation automatically.
    #[error("{0} authentication is required")]
    AuthenticationRequired(String),

    /// The shared managed target cannot issue a short-lived credential until a
    /// Workspace manager repairs its provider integration or resource binding.
    #[error("managed workspace connection repair is required")]
    ManagedConnectionRecoveryRequired,

    /// The safety gate blocked an action; `reason` is shown verbatim in the UI.
    #[error("blocked: {reason}")]
    Blocked { reason: String },

    /// A query cannot use the generic SQL runner, regardless of connection settings.
    #[error("SQL is blocked before execution: direct privilege changes and statements that cannot be safely classified are unsupported. Write and schema settings do not enable them. Review the indicated statement; a database administrator must perform privilege administration through the database provider's administration tools.")]
    SqlPolicyBlocked { position: Option<usize> },

    /// The combined desktop read endpoint stopped before any target access
    /// because this statement must use the explicit proposal UI. This is not a
    /// general policy block and is the only failure a client may safely retry
    /// through that separate workflow.
    #[error("SQL read requires the explicit proposal workflow")]
    ProposalRequired,

    /// A target mutation may have committed, but the driver could not confirm its
    /// final state. Callers must not retry automatically.
    #[error("operation outcome is unknown: {0}")]
    OutcomeUnknown(String),
}

impl AppError {
    /// Stable machine-readable discriminant for the frontend to switch on.
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::Db(_) => "db",
            AppError::Mongo(_) => "db",
            AppError::Agent(_) => "agent",
            AppError::Network(_) => "network",
            AppError::Timeout(_) => "timeout",
            AppError::SshTunnel(_) => "sshTunnel",
            AppError::Safety(_) => "safety",
            AppError::Parse(_) => "parse",
            AppError::Keychain(_) => "keychain",
            AppError::Io(_) => "io",
            AppError::Serialization(_) => "serialization",
            AppError::Config(_) => "config",
            AppError::NotFound(_) => "notFound",
            AppError::CredentialBindingRequired => "credentialBindingRequired",
            AppError::AuthenticationRequired(_) => "authenticationRequired",
            AppError::ManagedConnectionRecoveryRequired => "managedConnectionRecoveryRequired",
            AppError::Blocked { .. } => "blocked",
            AppError::SqlPolicyBlocked { .. } => "sqlPolicyBlocked",
            AppError::ProposalRequired => "proposalRequired",
            AppError::OutcomeUnknown(_) => "outcomeUnknown",
        }
    }

    /// 1-based character offset into the executed SQL where the error occurred,
    /// when the driver reports one (Postgres only; MySQL/SQLite don't expose it).
    fn position(&self) -> Option<usize> {
        if let Self::SqlPolicyBlocked { position } = self {
            return *position;
        }
        let AppError::Db(sqlx::Error::Database(db)) = self else {
            return None;
        };
        match db
            .try_downcast_ref::<sqlx::postgres::PgDatabaseError>()?
            .position()?
        {
            sqlx::postgres::PgErrorPosition::Original(p) => Some(p),
            // Position inside an internally-generated query is meaningless to the user.
            sqlx::postgres::PgErrorPosition::Internal { .. } => None,
        }
    }
}

// Serialize to `{ kind, message, position?, connectionFailure? }` so JS gets a typed,
// switchable error object. `connectionFailure` closes the bypass where a screen that
// only has an `AppError` had to fall back to rendering the untranslated `message`.
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let position = self.position();
        let connection_failure = serializable_connection_failure(self);
        let mut st = serializer.serialize_struct(
            "AppError",
            2 + usize::from(position.is_some()) + usize::from(connection_failure.is_some()),
        )?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        if let Some(p) = position {
            st.serialize_field("position", &p)?;
        }
        if let Some(failure) = connection_failure.as_ref() {
            st.serialize_field("connectionFailure", failure)?;
        }
        st.end()
    }
}
