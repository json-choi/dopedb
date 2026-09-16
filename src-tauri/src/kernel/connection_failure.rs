//! Stable, privacy-safe classification of a failed connection attempt.
//!
//! One classifier serves every exposure path: the connection-editor receipt, the
//! Database Explorer tree, and the serialized [`AppError`] payload. Driver text, OS
//! `ssh` output, configuration strings, and connection URLs are untrusted input and
//! never travel with the result; only these enum values and a fixed English
//! technical sentence do.
//!
//! `detail` is therefore chosen from a `&'static str`, never derived from what the
//! far side wrote. A driver message is not safe to forward after filtering: both
//! PostgreSQL and MySQL routinely name a user, database, table, or column in it
//! (`password authentication failed for user "…"`), and stripping control
//! characters or truncating that text redacts none of it. When a failure deserves a
//! more precise sentence, the classification is what gets subdivided.

use std::fmt;

use serde::Serialize;

use crate::error::AppError;

/// Stable, privacy-safe connection probe categories consumed by the editor and the
/// Database Explorer tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ConnectionFailureCode {
    TimeoutNetwork,
    Authentication,
    Tls,
    DatabaseConfig,
    SshLaunch,
    SshHost,
    SshAuthentication,
    SshHostKey,
    SshTimeout,
    SshUnclassified,
    Unknown,
}

/// A field is returned only when the failure identifies it without guessing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ConnectionFailureField {
    Credentials,
    Tls,
    Database,
    SshAlias,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionFailure {
    pub(crate) code: ConnectionFailureCode,
    pub(crate) field: Option<ConnectionFailureField>,
    /// `&'static str`, not `String`: the compiler, not a reviewer, is what keeps a
    /// driver message or OS output from being assigned here.
    pub(crate) detail: &'static str,
}

/// Why the system OpenSSH tunnel could not be opened.
///
/// The transport classifies OS `ssh` output into one of these causes and drops the
/// output itself. `Display` is the fixed sentence every exposure path may show; it
/// never interpolates the Host alias, a path, or anything the OS wrote.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SshTunnelFailure {
    Launch,
    Host,
    Authentication,
    HostKey,
    Timeout,
    Unclassified,
}

impl SshTunnelFailure {
    const fn detail(self) -> &'static str {
        match self {
            Self::Launch => "the system ssh client could not be started for this Host alias",
            Self::Host => "the system ssh client could not reach the configured Host alias",
            Self::Authentication => {
                "the SSH server rejected the system ssh client's authentication"
            }
            Self::HostKey => "the SSH host key could not be verified",
            Self::Timeout => "the SSH tunnel did not become ready before its deadline",
            Self::Unclassified => "the system ssh client failed without a recognizable cause",
        }
    }

    const fn code(self) -> ConnectionFailureCode {
        match self {
            Self::Launch => ConnectionFailureCode::SshLaunch,
            Self::Host => ConnectionFailureCode::SshHost,
            Self::Authentication => ConnectionFailureCode::SshAuthentication,
            Self::HostKey => ConnectionFailureCode::SshHostKey,
            Self::Timeout => ConnectionFailureCode::SshTimeout,
            Self::Unclassified => ConnectionFailureCode::SshUnclassified,
        }
    }
}

impl fmt::Display for SshTunnelFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.detail())
    }
}

/// One classified outcome: the category, the field it identifies without guessing,
/// and the fixed sentence shown as its technical detail. The `&'static str` is the
/// enforcement, not a convention — a driver or OS string cannot be returned here.
type Classification = (
    ConnectionFailureCode,
    Option<ConnectionFailureField>,
    &'static str,
);

const UNCLASSIFIED: Classification = (
    ConnectionFailureCode::Unknown,
    None,
    "the driver did not provide a safe diagnostic",
);

/// Classify any error a target-access attempt produced. Total by design: the editor
/// receipt must always have a category to show.
pub(crate) fn classify_connection_failure(error: &AppError) -> ConnectionFailure {
    let (code, field, detail): Classification = match error {
        AppError::SshTunnel(cause) => (
            cause.code(),
            Some(ConnectionFailureField::SshAlias),
            cause.detail(),
        ),
        AppError::Timeout(_) => (
            ConnectionFailureCode::TimeoutNetwork,
            None,
            "the bounded connection attempt timed out",
        ),
        AppError::Network(_) | AppError::Io(_) => (
            ConnectionFailureCode::TimeoutNetwork,
            None,
            "the network connection failed",
        ),
        AppError::Db(sqlx::Error::PoolTimedOut) => (
            ConnectionFailureCode::TimeoutNetwork,
            None,
            "the connection attempt exhausted its bounded pool deadline",
        ),
        AppError::Db(sqlx::Error::Io(io)) => (
            ConnectionFailureCode::TimeoutNetwork,
            None,
            match io.kind() {
                std::io::ErrorKind::TimedOut => "the network connection timed out",
                std::io::ErrorKind::ConnectionRefused => "the network connection was refused",
                std::io::ErrorKind::ConnectionReset => "the network connection was reset",
                std::io::ErrorKind::NotFound => "the network target was not found",
                _ => "the network connection failed",
            },
        ),
        AppError::Db(sqlx::Error::Tls(_)) => (
            ConnectionFailureCode::Tls,
            Some(ConnectionFailureField::Tls),
            "TLS negotiation or certificate verification failed",
        ),
        AppError::Db(sqlx::Error::Database(database)) => {
            classify_database_failure(database.as_ref())
        }
        AppError::AuthenticationRequired(_) => (
            ConnectionFailureCode::Authentication,
            Some(ConnectionFailureField::Credentials),
            "the connection credential is no longer authenticated",
        ),
        AppError::ManagedConnectionRecoveryRequired => (
            ConnectionFailureCode::Authentication,
            Some(ConnectionFailureField::Credentials),
            "the managed workspace connection requires provider repair",
        ),
        AppError::Config(_) => (
            ConnectionFailureCode::DatabaseConfig,
            None,
            "the driver rejected the connection configuration",
        ),
        AppError::Keychain(_) => (
            ConnectionFailureCode::Unknown,
            None,
            "the OS credential store could not supply this connection",
        ),
        AppError::Mongo(_) => (
            ConnectionFailureCode::Unknown,
            None,
            "the MongoDB driver rejected the connection",
        ),
        _ => UNCLASSIFIED,
    };
    ConnectionFailure {
        code,
        field,
        detail,
    }
}

/// A connection-failure payload is attached to a serialized error only when a
/// target-access attempt can actually produce it. A policy, parse, or proposal
/// decision is about a statement, not about reaching a database, and must never be
/// relabelled as a connection cause.
pub(crate) fn serializable_connection_failure(error: &AppError) -> Option<ConnectionFailure> {
    match error {
        AppError::Db(_)
        | AppError::Mongo(_)
        | AppError::SshTunnel(_)
        | AppError::Network(_)
        | AppError::Timeout(_)
        | AppError::Io(_)
        | AppError::Keychain(_)
        | AppError::Config(_)
        | AppError::CredentialBindingRequired
        | AppError::AuthenticationRequired(_)
        | AppError::ManagedConnectionRecoveryRequired => Some(classify_connection_failure(error)),
        _ => None,
    }
}

fn classify_database_failure(
    database: &(dyn sqlx::error::DatabaseError + 'static),
) -> Classification {
    // Only the driver's own identity — its SQLSTATE and, for MySQL, its error
    // number — is read. `database.message()` is deliberately never touched.
    let sqlstate = database.code();
    let sqlstate = sqlstate.as_deref();
    let mysql_number = database
        .try_downcast_ref::<sqlx::mysql::MySqlDatabaseError>()
        .map(sqlx::mysql::MySqlDatabaseError::number);
    classify_database_identity(sqlstate, mysql_number)
}

/// Map a driver's failure identity to a category and a fixed sentence.
///
/// An unrecognized identity resolves to [`UNCLASSIFIED`] the same way unrecognized
/// `ssh` output does, so a server can never choose the words a user reads.
pub(crate) fn classify_database_identity(
    sqlstate: Option<&str>,
    mysql_number: Option<u16>,
) -> Classification {
    const REJECTED_LOGIN: Classification = (
        ConnectionFailureCode::Authentication,
        Some(ConnectionFailureField::Credentials),
        "the database server rejected the user name or password",
    );
    const MISSING_DATABASE: Classification = (
        ConnectionFailureCode::DatabaseConfig,
        Some(ConnectionFailureField::Database),
        "the database server has no database with the configured name",
    );
    match mysql_number {
        Some(1_044) => {
            return (
                ConnectionFailureCode::Authentication,
                Some(ConnectionFailureField::Credentials),
                "the account is not allowed to open the configured database",
            )
        }
        Some(1_045) => return REJECTED_LOGIN,
        Some(1_049) => return MISSING_DATABASE,
        _ => {}
    }
    let Some(sqlstate) = sqlstate else {
        return UNCLASSIFIED;
    };
    match sqlstate {
        "28P01" => REJECTED_LOGIN,
        state if state.starts_with("28") => (
            ConnectionFailureCode::Authentication,
            Some(ConnectionFailureField::Credentials),
            "the database server rejected the connection's authorization",
        ),
        "08001" => (
            ConnectionFailureCode::TimeoutNetwork,
            None,
            "the driver could not establish a connection to the database server",
        ),
        "08004" => (
            ConnectionFailureCode::TimeoutNetwork,
            None,
            "the database server rejected the connection attempt",
        ),
        "08006" => (
            ConnectionFailureCode::TimeoutNetwork,
            None,
            "the connection to the database server failed before it was ready",
        ),
        state if state.starts_with("08") => (
            ConnectionFailureCode::TimeoutNetwork,
            None,
            "the connection to the database server was not available",
        ),
        "3D000" => MISSING_DATABASE,
        state if state.starts_with("3D") => (
            ConnectionFailureCode::DatabaseConfig,
            Some(ConnectionFailureField::Database),
            "the database server rejected the configured database name",
        ),
        _ => UNCLASSIFIED,
    }
}
