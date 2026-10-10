//! Closed, secret-free connection failures shared by SSH and catalog boundaries.

use super::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionFailureCode {
    SshClientMissing,
    SshConfiguration,
    SshHostKey,
    SshAuthentication,
    SshForwarding,
    SshTimeout,
    SshUnknown,
    Network,
    Tls,
    Authentication,
    Configuration,
    Cancelled,
    /// Another session held a lock on the object past the request's lock timeout.
    LockTimeout,
    Unknown,
}

impl ConnectionFailureCode {
    pub(crate) fn kind(self) -> &'static str {
        match self {
            Self::SshClientMissing => "sshClientMissing",
            Self::SshConfiguration => "sshConfiguration",
            Self::SshHostKey => "sshHostKey",
            Self::SshAuthentication => "sshAuthentication",
            Self::SshForwarding => "sshForwarding",
            Self::SshTimeout => "sshTimeout",
            Self::SshUnknown => "sshUnknown",
            Self::Network => "connectionNetwork",
            Self::Tls => "connectionTls",
            Self::Authentication => "connectionAuthentication",
            Self::Configuration => "connectionConfiguration",
            Self::Cancelled => "cancelled",
            Self::LockTimeout => "lockTimeout",
            Self::Unknown => "connectionUnknown",
        }
    }

    pub(crate) fn message(self) -> &'static str {
        match self {
            Self::SshClientMissing => "The system SSH client is unavailable.",
            Self::SshConfiguration => "Check the Host alias in your system SSH configuration.",
            Self::SshHostKey => "SSH host identity verification failed. Verify the host identity with your administrator before retrying.",
            Self::SshAuthentication => "SSH authentication failed. Check your system SSH agent and credentials.",
            Self::SshForwarding => "SSH could not establish forwarding. Check the network and the target forwarding policy.",
            Self::SshTimeout => "The SSH tunnel did not become ready before the deadline.",
            Self::SshUnknown => "The system SSH client could not establish the tunnel.",
            Self::Network => "The database network connection failed.",
            Self::Tls => "Database TLS negotiation or certificate verification failed.",
            Self::Authentication => "Database authentication failed.",
            Self::Configuration => "Check the database connection configuration.",
            Self::Cancelled => "The database request was cancelled.",
            Self::LockTimeout => {
                "Another session holds a lock on this object; the request stopped waiting."
            }
            Self::Unknown => "The database connection could not complete the request.",
        }
    }
}

impl std::fmt::Display for ConnectionFailureCode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message())
    }
}

impl AppError {
    /// A catalog scan raced a concurrent DROP: a lookup helper (`pg_get_viewdef`, a
    /// regclass cast, a type or relation open) read the live system caches for an
    /// object the scan's snapshot still lists. A fresh scan no longer sees it.
    /// Timeouts, cancels, authentication and network failures never qualify.
    pub(crate) fn is_concurrent_catalog_drop(&self) -> bool {
        let Self::Db(sqlx::Error::Database(database)) = self else {
            return false;
        };
        match database.code().as_deref() {
            Some("XX000") => {
                let message = database.message();
                message.starts_with("cache lookup failed for")
                    || message.starts_with("could not open relation with OID")
            }
            // undefined_table, undefined_object, invalid_schema_name
            Some("42P01" | "42704" | "3F000") => true,
            _ => false,
        }
    }

    /// Drop all untrusted diagnostics before a catalog result reaches IPC, logs,
    /// or the Agent. Preserve the existing access/authentication recovery identity.
    pub(crate) fn public_connection_failure(self) -> Self {
        use ConnectionFailureCode as Code;
        let code = match self {
            // Closed, secret-free recovery identities pass through unchanged.
            Self::ConnectionFailure(_)
            | Self::CredentialBindingRequired
            | Self::ManagedConnectionRecoveryRequired
            | Self::RetryLater { .. }
            | Self::SharedConnectionChanged => return self,
            Self::AuthenticationRequired(_) => {
                return Self::AuthenticationRequired("Provider".into())
            }
            Self::Blocked { .. } => {
                return Self::Blocked {
                    reason: "Access to this connection is not permitted in the current scope."
                        .into(),
                }
            }
            Self::Safety(_) => {
                return Self::Safety("Connection access was rejected by the current policy.".into())
            }
            Self::Timeout(_) | Self::Db(sqlx::Error::PoolTimedOut) => {
                return Self::Timeout("The catalog request exceeded its deadline.".into())
            }
            Self::NotFound(_) => {
                return Self::NotFound("The requested connection resource is unavailable.".into())
            }
            // A refused OS credential store is recovered by allowing access, not by
            // re-entering the credential; keep that identity without the platform text.
            Self::Keychain(_) => {
                return Self::Keychain(keyring::Error::NoStorageAccess(
                    "The OS credential store refused access.".into(),
                ))
            }
            Self::Network(_) | Self::Io(_) | Self::Db(sqlx::Error::Io(_)) => Code::Network,
            Self::Db(sqlx::Error::Tls(_)) => Code::Tls,
            Self::Db(sqlx::Error::Database(ref database)) => {
                let state = database.code();
                if state.as_deref() == Some("57014") {
                    return if database.message() == "canceling statement due to statement timeout" {
                        Self::Timeout("The catalog request exceeded its deadline.".into())
                    } else {
                        Self::ConnectionFailure(Code::Cancelled)
                    };
                }
                let number = database
                    .try_downcast_ref::<sqlx::mysql::MySqlDatabaseError>()
                    .map(sqlx::mysql::MySqlDatabaseError::number);
                // PostgreSQL `lock_not_available` and MySQL's lock wait timeout: the
                // object is busy, which a later retry resolves without any edit.
                if state.as_deref() == Some("55P03") || number == Some(1205) {
                    return Self::ConnectionFailure(Code::LockTimeout);
                }
                if state
                    .as_deref()
                    .is_some_and(|state| state.starts_with("28"))
                    || matches!(number, Some(1044 | 1045))
                {
                    Code::Authentication
                } else if state
                    .as_deref()
                    .is_some_and(|state| state.starts_with("08"))
                {
                    Code::Network
                } else if state
                    .as_deref()
                    .is_some_and(|state| state.starts_with("3D"))
                    || number == Some(1049)
                {
                    Code::Configuration
                } else {
                    Code::Unknown
                }
            }
            Self::Config(_) => Code::Configuration,
            _ => Code::Unknown,
        };
        Self::ConnectionFailure(code)
    }
}
