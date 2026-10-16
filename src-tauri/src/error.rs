//! Typed error spine. Every fallible path in the crate returns [`AppError`], which
//! serializes to a `{ kind, message, position? }` object so `#[tauri::command]` can
//! hand a structured error straight to the frontend.

use thiserror::Error;

#[path = "connection_failure.rs"]
mod connection_failure;
pub(crate) use connection_failure::ConnectionFailureCode;

pub type AppResult<T> = Result<T, AppError>;

/// A driver error as users and audit records see it. sqlx appends `at line N` to a
/// PostgreSQL server error, where N is the line in the server's own source code,
/// not in the user's SQL, so that error is shown by its message alone. MySQL and
/// SQLite errors keep sqlx's text (a MySQL `at line N` does name the SQL's line).
pub(crate) fn db_error_text(error: &sqlx::Error) -> impl std::fmt::Display + '_ {
    struct DbErrorText<'a>(&'a sqlx::Error);
    impl std::fmt::Display for DbErrorText<'_> {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            if let sqlx::Error::Database(database) = self.0 {
                if let Some(postgres) =
                    database.try_downcast_ref::<sqlx::postgres::PgDatabaseError>()
                {
                    return write!(f, "error returned from database: {}", postgres.message());
                }
            }
            std::fmt::Display::fmt(self.0, f)
        }
    }
    DbErrorText(error)
}

#[derive(Debug, Error)]
pub enum AppError {
    /// Public connection diagnostics contain only a closed category, never driver output.
    #[error("{0}")]
    ConnectionFailure(ConnectionFailureCode),
    /// Errors from the target-database drivers (sqlx). A PostgreSQL server error
    /// carries only its own message; see [`db_error_text`]. Conversion goes through
    /// `From<sqlx::Error>`, which keeps a column type sqlx cannot resolve apart.
    #[error("database error: {}", db_error_text(.0))]
    Db(#[source] sqlx::Error),

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

    /// A managed connection open failed moments ago. The same target is not opened
    /// again until its cooldown ends, so a burst of readers cannot mint provider
    /// credentials; clients wait `retry_after_seconds` before offering a retry.
    #[error("the connection is cooling down after a failed open; retry in {retry_after_seconds} seconds")]
    RetryLater { retry_after_seconds: u64 },

    /// The shared connection's revision changed after this request pinned it. The
    /// client refreshes workspace data and retries; the stale revision is never used.
    #[error("the shared connection changed; refresh the workspace and retry")]
    SharedConnectionChanged,

    /// The safety gate blocked an action; `reason` is shown verbatim in the UI.
    #[error("blocked: {reason}")]
    Blocked { reason: String },

    /// A query cannot use the generic SQL runner, regardless of connection settings.
    #[error("SQL is blocked before execution: direct privilege changes and statements that cannot be safely classified are unsupported. Write and schema settings do not enable them. Review the indicated statement; a database administrator must perform privilege administration through the database provider's administration tools.")]
    SqlPolicyBlocked { position: Option<usize> },

    /// The SQL could not be parsed under the connection's dialect, so it was
    /// blocked before any target access. `position` is the 1-based character
    /// offset into the submitted SQL (the same convention as PostgreSQL errors).
    #[error("SQL parse error: {message}")]
    SqlParseFailed {
        message: String,
        position: Option<usize>,
    },

    /// A session-state statement (`USE`, `SET`) was submitted to the runner.
    /// DopeDB owns database and schema selection, so the statement is rejected
    /// before target access instead of silently changing a pooled session.
    #[error("Session statements such as USE and SET are not executed; choose the database and schema with the selector instead")]
    SessionStatementBlocked { position: Option<usize> },

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

    /// A manual-transaction command was refused. The closed `code` lets the UI
    /// explain the refusal in the user's language instead of showing this text.
    #[error("{}", .0.message())]
    ManualTransaction(ManualTransactionRefusal),

    /// One result row, with its column names, cannot fit a 512 KiB result page
    /// even after its largest values are shortened to previews.
    #[error("a result row does not fit one result page even after shortening its largest values")]
    ResultRowTooLarge,

    /// The result has a PostgreSQL column type the driver cannot resolve yet (a
    /// multirange, for one), so no row was read. Casting that column to text works.
    #[error("the result has a column type DopeDB cannot read yet, such as a multirange; cast that column to text (column::text) and run again")]
    UnsupportedColumnType,
}

impl From<sqlx::Error> for AppError {
    /// sqlx resolves a PostgreSQL type it has not seen by reading `pg_type`, and a
    /// `typtype` it does not know (`m`, a multirange) fails that catalog read as
    /// `unknown type code N`. That is a typed result-shape limit with a known
    /// workaround, not a server error; every other driver error stays [`AppError::Db`].
    fn from(error: sqlx::Error) -> Self {
        if let sqlx::Error::ColumnDecode { index, source } = &error {
            if index == "\"typtype\"" && source.to_string().starts_with("unknown type code") {
                return AppError::UnsupportedColumnType;
            }
        }
        AppError::Db(error)
    }
}

/// Closed set of manual-transaction refusals, serialized as `code`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ManualTransactionRefusal {
    /// Document and remote-CLI engines expose no manual transaction.
    Unsupported,
    /// The workspace role grants read-only access.
    ReadOnlyRole,
    /// Data changes are off for this connection on this device.
    WritesDisabled,
    /// The open transaction belongs to another database of this connection.
    OtherDatabase,
    /// A statement is still running inside the transaction.
    StatementRunning,
    /// A statement failed and its savepoint could not be restored.
    Failed,
    /// The transaction already ended (committed, rolled back, or closed).
    Ended,
    /// The transaction passed its 30-minute limit and is being rolled back.
    Expired,
    /// The request named a transaction that is no longer the open one.
    Stale,
    /// DDL and privilege statements cannot join a manual rollback boundary.
    UnsupportedStatement,
    /// The connection's workspace authority changed, so it was rolled back.
    AuthorityChanged,
}

impl ManualTransactionRefusal {
    pub fn code(self) -> &'static str {
        match self {
            Self::Unsupported => "unsupported",
            Self::ReadOnlyRole => "readOnlyRole",
            Self::WritesDisabled => "writesDisabled",
            Self::OtherDatabase => "otherDatabase",
            Self::StatementRunning => "statementRunning",
            Self::Failed => "failed",
            Self::Ended => "ended",
            Self::Expired => "expired",
            Self::Stale => "stale",
            Self::UnsupportedStatement => "unsupportedStatement",
            Self::AuthorityChanged => "authorityChanged",
        }
    }

    fn message(self) -> &'static str {
        match self {
            Self::Unsupported => "manual transactions are unavailable for this connection",
            Self::ReadOnlyRole => "your workspace role grants read-only database access",
            Self::WritesDisabled => {
                "data changes are off for this connection; turn them on in Safety settings to start or commit a manual transaction"
            }
            Self::OtherDatabase => {
                "the open manual transaction belongs to another database; commit or roll it back before switching"
            }
            Self::StatementRunning => {
                "a statement is still running in this manual transaction; wait for it or cancel it first"
            }
            Self::Failed => "the manual transaction failed and can only be rolled back",
            Self::Ended => "the manual transaction has already ended",
            Self::Expired => "the manual transaction reached its time limit and was rolled back",
            Self::Stale => "this manual transaction is no longer the open one; refresh and retry",
            Self::UnsupportedStatement => {
                "DDL and privilege statements are excluded from a manual rollback boundary"
            }
            Self::AuthorityChanged => {
                "the connection's access changed, so the manual transaction was rolled back"
            }
        }
    }
}

impl AppError {
    /// Stable machine-readable discriminant for the frontend to switch on.
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::ConnectionFailure(code) => code.kind(),
            AppError::Db(_) => "db",
            AppError::Mongo(_) => "db",
            AppError::Agent(_) => "agent",
            AppError::Network(_) => "network",
            AppError::Timeout(_) => "timeout",
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
            AppError::RetryLater { .. } => "retryLater",
            AppError::SharedConnectionChanged => "sharedConnectionChanged",
            AppError::Blocked { .. } => "blocked",
            AppError::SqlPolicyBlocked { .. } => "sqlPolicyBlocked",
            AppError::SqlParseFailed { .. } => "sqlParseFailed",
            AppError::SessionStatementBlocked { .. } => "sessionStatementBlocked",
            AppError::ProposalRequired => "proposalRequired",
            AppError::OutcomeUnknown(_) => "outcomeUnknown",
            AppError::ManualTransaction(_) => "manualTransaction",
            AppError::ResultRowTooLarge => "resultRowTooLarge",
            AppError::UnsupportedColumnType => "unsupportedColumnType",
        }
    }

    /// 1-based character offset into the executed SQL where the error occurred,
    /// when the driver reports one (Postgres only; MySQL/SQLite don't expose it).
    fn position(&self) -> Option<usize> {
        match self {
            Self::SqlPolicyBlocked { position }
            | Self::SqlParseFailed { position, .. }
            | Self::SessionStatementBlocked { position } => return *position,
            _ => {}
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

    /// A PostgreSQL server error's SQLSTATE, DETAIL, and HINT: diagnostics the
    /// message (see [`db_error_text`]) leaves out, kept as separate fields.
    fn pg_diagnostics(&self) -> Option<(&str, Option<&str>, Option<&str>)> {
        let AppError::Db(sqlx::Error::Database(db)) = self else {
            return None;
        };
        let postgres = db.try_downcast_ref::<sqlx::postgres::PgDatabaseError>()?;
        Some((postgres.code(), postgres.detail(), postgres.hint()))
    }
}

// Serialize to `{ kind, message, position?, code?, retryAfterSeconds?, sqlstate?,
// detail?, hint? }` so JS gets a typed, switchable error object. `code` is present only
// for a closed refusal set such as `manualTransaction`; `retryAfterSeconds` only for
// `retryLater`; `sqlstate`/`detail`/`hint` only for a PostgreSQL server error.
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let position = self.position();
        let code = match self {
            Self::ManualTransaction(refusal) => Some(refusal.code()),
            _ => None,
        };
        let retry_after_seconds = match self {
            Self::RetryLater {
                retry_after_seconds,
            } => Some(*retry_after_seconds),
            _ => None,
        };
        let (sqlstate, detail, hint) = match self.pg_diagnostics() {
            Some((sqlstate, detail, hint)) => (Some(sqlstate), detail, hint),
            None => (None, None, None),
        };
        let mut st = serializer.serialize_struct(
            "AppError",
            2 + usize::from(position.is_some())
                + usize::from(code.is_some())
                + usize::from(retry_after_seconds.is_some())
                + usize::from(sqlstate.is_some())
                + usize::from(detail.is_some())
                + usize::from(hint.is_some()),
        )?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        if let Some(p) = position {
            st.serialize_field("position", &p)?;
        }
        if let Some(code) = code {
            st.serialize_field("code", code)?;
        }
        if let Some(seconds) = retry_after_seconds {
            st.serialize_field("retryAfterSeconds", &seconds)?;
        }
        if let Some(sqlstate) = sqlstate {
            st.serialize_field("sqlstate", sqlstate)?;
        }
        if let Some(detail) = detail {
            st.serialize_field("detail", detail)?;
        }
        if let Some(hint) = hint {
            st.serialize_field("hint", hint)?;
        }
        st.end()
    }
}
