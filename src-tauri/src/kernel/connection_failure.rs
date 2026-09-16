//! Stable, privacy-safe classification of a failed connection attempt.
//!
//! One classifier serves every exposure path: the connection-editor receipt, the
//! Database Explorer tree, and the serialized [`AppError`] payload. Driver text, OS
//! `ssh` output, configuration strings, and connection URLs are untrusted input and
//! never travel with the result; only these enum values do.
//!
//! `detail` is therefore a [`ConnectionFailureDetail`], never a `String` and never a
//! sentence derived from what the far side wrote. A driver message is not safe to
//! forward after filtering: both PostgreSQL and MySQL routinely name a user,
//! database, table, or column in it (`password authentication failed for user "…"`),
//! and stripping control characters or truncating that text redacts none of it. When
//! a failure deserves a more precise sentence, the classification is what gets
//! subdivided.
//!
//! Because the wire carries an identity rather than words, the desktop message
//! catalogue owns the sentence a user reads and it follows their language.

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

/// The identity of the technical detail a screen shows under a failed connection.
///
/// This is a closed set of causes, not text. The desktop catalogue maps each value to
/// one localized sentence, so the sentence cannot be assembled from a driver message
/// and the compiler — not a reviewer — keeps untrusted words out of this position.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ConnectionFailureDetail {
    AccountDatabaseNotAllowed,
    AttemptTimedOut,
    CredentialNotAuthenticated,
    CredentialStoreUnavailable,
    DriverRejectedConfiguration,
    ManagedRepairRequired,
    MongoRejectedConnection,
    NetworkFailed,
    NetworkRefused,
    NetworkReset,
    NetworkTargetNotFound,
    NetworkTimedOut,
    PoolDeadlineExhausted,
    ServerConnectionLostBeforeReady,
    ServerConnectionUnavailable,
    ServerMissingDatabase,
    ServerRejectedAttempt,
    ServerRejectedAuthorization,
    ServerRejectedDatabaseName,
    ServerRejectedLogin,
    ServerUnreachable,
    SshAuthentication,
    SshHostKey,
    SshHostUnreachable,
    SshLaunch,
    SshTimeout,
    SshUnclassified,
    TlsRejected,
    Unclassified,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionFailure {
    pub(crate) code: ConnectionFailureCode,
    pub(crate) field: Option<ConnectionFailureField>,
    /// A closed identity, not a `String`: the compiler, not a reviewer, is what keeps
    /// a driver message or OS output from being assigned here.
    pub(crate) detail: ConnectionFailureDetail,
}

/// Why the system OpenSSH tunnel could not be opened.
///
/// The transport classifies OS `ssh` output into one of these causes and drops the
/// output itself. `Display` is the fixed developer-facing sentence; it never
/// interpolates the Host alias, a path, or anything the OS wrote.
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
    /// The fixed sentence [`AppError`]'s developer-facing `message` renders. Screens
    /// read the classified payload instead, so this text is never what a user sees.
    const fn message(self) -> &'static str {
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

    const fn detail(self) -> ConnectionFailureDetail {
        match self {
            Self::Launch => ConnectionFailureDetail::SshLaunch,
            Self::Host => ConnectionFailureDetail::SshHostUnreachable,
            Self::Authentication => ConnectionFailureDetail::SshAuthentication,
            Self::HostKey => ConnectionFailureDetail::SshHostKey,
            Self::Timeout => ConnectionFailureDetail::SshTimeout,
            Self::Unclassified => ConnectionFailureDetail::SshUnclassified,
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
        formatter.write_str(self.message())
    }
}

/// One classified outcome: the category, the field it identifies without guessing,
/// and the identity of its technical detail. The closed enum is the enforcement, not
/// a convention — a driver or OS string cannot be returned here.
type Classification = (
    ConnectionFailureCode,
    Option<ConnectionFailureField>,
    ConnectionFailureDetail,
);

const UNCLASSIFIED: Classification = (
    ConnectionFailureCode::Unknown,
    None,
    ConnectionFailureDetail::Unclassified,
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
            ConnectionFailureDetail::AttemptTimedOut,
        ),
        AppError::Network(_) | AppError::Io(_) => (
            ConnectionFailureCode::TimeoutNetwork,
            None,
            ConnectionFailureDetail::NetworkFailed,
        ),
        AppError::Db(sqlx::Error::PoolTimedOut) => (
            ConnectionFailureCode::TimeoutNetwork,
            None,
            ConnectionFailureDetail::PoolDeadlineExhausted,
        ),
        AppError::Db(sqlx::Error::Io(io)) => (
            ConnectionFailureCode::TimeoutNetwork,
            None,
            match io.kind() {
                std::io::ErrorKind::TimedOut => ConnectionFailureDetail::NetworkTimedOut,
                std::io::ErrorKind::ConnectionRefused => ConnectionFailureDetail::NetworkRefused,
                std::io::ErrorKind::ConnectionReset => ConnectionFailureDetail::NetworkReset,
                std::io::ErrorKind::NotFound => ConnectionFailureDetail::NetworkTargetNotFound,
                _ => ConnectionFailureDetail::NetworkFailed,
            },
        ),
        AppError::Db(sqlx::Error::Tls(_)) => (
            ConnectionFailureCode::Tls,
            Some(ConnectionFailureField::Tls),
            ConnectionFailureDetail::TlsRejected,
        ),
        AppError::Db(sqlx::Error::Database(database)) => {
            classify_database_failure(database.as_ref())
        }
        AppError::AuthenticationRequired(_) => (
            ConnectionFailureCode::Authentication,
            Some(ConnectionFailureField::Credentials),
            ConnectionFailureDetail::CredentialNotAuthenticated,
        ),
        AppError::ManagedConnectionRecoveryRequired => (
            ConnectionFailureCode::Authentication,
            Some(ConnectionFailureField::Credentials),
            ConnectionFailureDetail::ManagedRepairRequired,
        ),
        AppError::Config(_) => (
            ConnectionFailureCode::DatabaseConfig,
            None,
            ConnectionFailureDetail::DriverRejectedConfiguration,
        ),
        AppError::Keychain(_) => (
            ConnectionFailureCode::Unknown,
            None,
            ConnectionFailureDetail::CredentialStoreUnavailable,
        ),
        AppError::Mongo(_) => (
            ConnectionFailureCode::Unknown,
            None,
            ConnectionFailureDetail::MongoRejectedConnection,
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

/// Map a driver's failure identity to a category and a detail identity.
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
        ConnectionFailureDetail::ServerRejectedLogin,
    );
    const MISSING_DATABASE: Classification = (
        ConnectionFailureCode::DatabaseConfig,
        Some(ConnectionFailureField::Database),
        ConnectionFailureDetail::ServerMissingDatabase,
    );
    match mysql_number {
        Some(1_044) => {
            return (
                ConnectionFailureCode::Authentication,
                Some(ConnectionFailureField::Credentials),
                ConnectionFailureDetail::AccountDatabaseNotAllowed,
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
            ConnectionFailureDetail::ServerRejectedAuthorization,
        ),
        "08001" => (
            ConnectionFailureCode::TimeoutNetwork,
            None,
            ConnectionFailureDetail::ServerUnreachable,
        ),
        "08004" => (
            ConnectionFailureCode::TimeoutNetwork,
            None,
            ConnectionFailureDetail::ServerRejectedAttempt,
        ),
        "08006" => (
            ConnectionFailureCode::TimeoutNetwork,
            None,
            ConnectionFailureDetail::ServerConnectionLostBeforeReady,
        ),
        state if state.starts_with("08") => (
            ConnectionFailureCode::TimeoutNetwork,
            None,
            ConnectionFailureDetail::ServerConnectionUnavailable,
        ),
        "3D000" => MISSING_DATABASE,
        state if state.starts_with("3D") => (
            ConnectionFailureCode::DatabaseConfig,
            Some(ConnectionFailureField::Database),
            ConnectionFailureDetail::ServerRejectedDatabaseName,
        ),
        _ => UNCLASSIFIED,
    }
}
