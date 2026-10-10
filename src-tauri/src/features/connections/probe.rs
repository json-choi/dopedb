//! Connection probe outcomes: the closed check receipt and the database discovery
//! receipt.
//!
//! A probe never serializes driver text. A failure projects to a closed code and
//! an optional field the editor can focus, and a probe refused before contacting
//! any server says why instead of sending a saved secret somewhere new.

use serde::Serialize;

use crate::error::{AppError, AppResult, ConnectionFailureCode};
use crate::features::catalog::DatabaseSummary;
#[cfg(test)]
use crate::{
    connection::ssh::SSH_ALIAS_PARAMETER,
    model::{ConnectionProfile, Engine},
};

#[cfg(test)]
use super::credential_endpoint::same_credential_endpoint;

/// A probe that stopped for a reason its failure code alone cannot explain: most
/// were refused before contacting any server, and a lock wait was stopped by the
/// database. The editor shows dedicated copy for each instead of treating it as a
/// broken connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ConnectionProbeRefusal {
    /// The draft names another endpoint than the saved profile, or weaker
    /// transport security, so the saved credential is withheld until the
    /// password is entered again.
    SavedCredentialEndpointChanged,
    /// A managed open failed moments ago and is cooling down; the receipt says
    /// how many seconds remain before a retry can run.
    RetryLater,
    /// The shared connection changed after this device pinned it; refreshing the
    /// workspace picks up the current revision.
    SharedConnectionChanged,
    /// This device's workspace session is missing or was rejected, so no shared
    /// access was authorized; the member signs in again.
    WorkspaceSignInRequired,
    /// This device's OS credential store refused to release the saved credential,
    /// so nothing was sent; the person allows access and checks again.
    CredentialStoreDenied,
    /// Another session held a lock the check needed, so the database stopped
    /// waiting; nothing about the connection needs to change before a retry.
    LockTimeout,
}

/// Databases a draft can reach, or why discovery refused before connecting.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DatabaseDiscoveryReceipt {
    databases: Vec<DatabaseSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    refusal: Option<ConnectionProbeRefusal>,
}

impl DatabaseDiscoveryReceipt {
    pub(crate) fn found(databases: Vec<DatabaseSummary>) -> Self {
        Self {
            databases,
            refusal: None,
        }
    }

    pub(crate) fn refused(refusal: ConnectionProbeRefusal) -> Self {
        Self {
            databases: Vec::new(),
            refusal: Some(refusal),
        }
    }
}

/// Stable, privacy-safe connection probe categories consumed by the editor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ConnectionTestFailureCode {
    SshClientMissing,
    SshConfiguration,
    SshHostKey,
    SshAuthentication,
    SshForwarding,
    SshTimeout,
    SshUnknown,
    TimeoutNetwork,
    Authentication,
    Tls,
    DatabaseConfig,
    Unknown,
}

/// A field is returned only when the driver error identifies it without guessing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ConnectionTestFailureField {
    Ssh,
    Credentials,
    Tls,
    Database,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionTestFailure {
    code: ConnectionTestFailureCode,
    field: Option<ConnectionTestFailureField>,
    detail: String,
    /// Present only for a probe that stopped with its own recovery (see
    /// [`ConnectionProbeRefusal`]), so the wire shape of every other
    /// driver-reported failure stays unchanged.
    #[serde(skip_serializing_if = "Option::is_none")]
    refusal: Option<ConnectionProbeRefusal>,
    /// Whole seconds left in a `retryLater` cooldown; absent for every other failure.
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after_seconds: Option<u64>,
}

/// Connection probes resolve to a receipt so the frontend never has to classify
/// driver message text. Secrets and connection URLs are excluded from `detail`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionTestReceipt {
    ok: bool,
    failure: Option<ConnectionTestFailure>,
}

impl ConnectionTestReceipt {
    pub(crate) fn from_result(result: AppResult<()>) -> Self {
        match result {
            Ok(()) => Self {
                ok: true,
                failure: None,
            },
            Err(error) => Self {
                ok: false,
                failure: Some(connection_test_failure(&error)),
            },
        }
    }

    /// A draft that moved away from its saved credential's endpoint, refused
    /// before contacting the server; it points at the credential field.
    pub(crate) fn saved_credential_endpoint_changed() -> Self {
        Self {
            ok: false,
            failure: Some(ConnectionTestFailure {
                code: ConnectionTestFailureCode::Authentication,
                field: Some(ConnectionTestFailureField::Credentials),
                detail: "the saved credential belongs to a different endpoint".into(),
                refusal: Some(ConnectionProbeRefusal::SavedCredentialEndpointChanged),
                retry_after_seconds: None,
            }),
        }
    }
}

fn connection_test_failure(error: &AppError) -> ConnectionTestFailure {
    let (code, field) = match error {
        AppError::ConnectionFailure(code) => {
            let mapped = match code {
                ConnectionFailureCode::SshClientMissing => {
                    ConnectionTestFailureCode::SshClientMissing
                }
                ConnectionFailureCode::SshConfiguration => {
                    ConnectionTestFailureCode::SshConfiguration
                }
                ConnectionFailureCode::SshHostKey => ConnectionTestFailureCode::SshHostKey,
                ConnectionFailureCode::SshAuthentication => {
                    ConnectionTestFailureCode::SshAuthentication
                }
                ConnectionFailureCode::SshForwarding => ConnectionTestFailureCode::SshForwarding,
                ConnectionFailureCode::SshTimeout => ConnectionTestFailureCode::SshTimeout,
                ConnectionFailureCode::SshUnknown => ConnectionTestFailureCode::SshUnknown,
                ConnectionFailureCode::Network => ConnectionTestFailureCode::TimeoutNetwork,
                ConnectionFailureCode::Tls => ConnectionTestFailureCode::Tls,
                ConnectionFailureCode::Authentication => ConnectionTestFailureCode::Authentication,
                ConnectionFailureCode::Configuration => ConnectionTestFailureCode::DatabaseConfig,
                // A lock wait belongs to the timeout family; its refusal says a
                // retry, not a connection edit, resolves it.
                ConnectionFailureCode::LockTimeout => ConnectionTestFailureCode::TimeoutNetwork,
                ConnectionFailureCode::Cancelled | ConnectionFailureCode::Unknown => {
                    ConnectionTestFailureCode::Unknown
                }
            };
            let field = if code.kind().starts_with("ssh") {
                Some(ConnectionTestFailureField::Ssh)
            } else {
                None
            };
            (mapped, field)
        }
        AppError::Timeout(_) | AppError::Network(_) | AppError::Io(_) => {
            (ConnectionTestFailureCode::TimeoutNetwork, None)
        }
        AppError::Db(sqlx::Error::PoolTimedOut | sqlx::Error::Io(_)) => {
            (ConnectionTestFailureCode::TimeoutNetwork, None)
        }
        AppError::Db(sqlx::Error::Tls(_)) => (
            ConnectionTestFailureCode::Tls,
            Some(ConnectionTestFailureField::Tls),
        ),
        AppError::Db(sqlx::Error::Database(database)) => {
            classify_database_failure(database.as_ref())
        }
        AppError::AuthenticationRequired(_) | AppError::ManagedConnectionRecoveryRequired => (
            ConnectionTestFailureCode::Authentication,
            Some(ConnectionTestFailureField::Credentials),
        ),
        // The saved credential is missing from, or was refused by, this device's
        // OS credential store. Either way the receipt points at the credential
        // field instead of an unknown failure; a refusal adds its own guidance.
        AppError::CredentialBindingRequired | AppError::Keychain(_) => (
            ConnectionTestFailureCode::Authentication,
            Some(ConnectionTestFailureField::Credentials),
        ),
        AppError::Config(_) => (ConnectionTestFailureCode::DatabaseConfig, None),
        // A managed open is cooling down after a failure moments ago. It belongs to
        // the network family, and nothing was contacted for this check.
        AppError::RetryLater { .. } => (ConnectionTestFailureCode::TimeoutNetwork, None),
        _ => (ConnectionTestFailureCode::Unknown, None),
    };
    let (refusal, retry_after_seconds) = match error {
        AppError::RetryLater {
            retry_after_seconds,
        } => (
            Some(ConnectionProbeRefusal::RetryLater),
            Some(*retry_after_seconds),
        ),
        AppError::SharedConnectionChanged => {
            (Some(ConnectionProbeRefusal::SharedConnectionChanged), None)
        }
        AppError::AuthenticationRequired(authority)
            if authority == crate::hosted_control_plane::WORKSPACE_AUTHENTICATION =>
        {
            (Some(ConnectionProbeRefusal::WorkspaceSignInRequired), None)
        }
        AppError::Keychain(_) => (Some(ConnectionProbeRefusal::CredentialStoreDenied), None),
        AppError::ConnectionFailure(ConnectionFailureCode::LockTimeout) => {
            (Some(ConnectionProbeRefusal::LockTimeout), None)
        }
        _ => (None, None),
    };
    ConnectionTestFailure {
        code,
        field,
        detail: safe_connection_test_detail(error),
        refusal,
        retry_after_seconds,
    }
}

fn classify_database_failure(
    database: &(dyn sqlx::error::DatabaseError + 'static),
) -> (
    ConnectionTestFailureCode,
    Option<ConnectionTestFailureField>,
) {
    let sqlstate = database.code();
    let sqlstate = sqlstate.as_deref();
    let mysql_number = database
        .try_downcast_ref::<sqlx::mysql::MySqlDatabaseError>()
        .map(sqlx::mysql::MySqlDatabaseError::number);
    classify_database_identity(sqlstate, mysql_number)
}

fn classify_database_identity(
    sqlstate: Option<&str>,
    mysql_number: Option<u16>,
) -> (
    ConnectionTestFailureCode,
    Option<ConnectionTestFailureField>,
) {
    if sqlstate.is_some_and(|code| code.starts_with("28"))
        || matches!(mysql_number, Some(1_044 | 1_045))
    {
        return (
            ConnectionTestFailureCode::Authentication,
            Some(ConnectionTestFailureField::Credentials),
        );
    }
    if sqlstate.is_some_and(|code| code.starts_with("08")) {
        return (ConnectionTestFailureCode::TimeoutNetwork, None);
    }
    if sqlstate.is_some_and(|code| code.starts_with("3D")) || mysql_number == Some(1_049) {
        return (
            ConnectionTestFailureCode::DatabaseConfig,
            Some(ConnectionTestFailureField::Database),
        );
    }
    (ConnectionTestFailureCode::Unknown, None)
}

fn safe_connection_test_detail(error: &AppError) -> String {
    let detail = match error {
        AppError::ConnectionFailure(code) => code.message(),
        AppError::Db(sqlx::Error::Database(_)) => "the database rejected the connection request",
        AppError::Db(sqlx::Error::PoolTimedOut) => {
            "the connection attempt exhausted its bounded pool deadline"
        }
        AppError::Db(sqlx::Error::Io(io)) => match io.kind() {
            std::io::ErrorKind::TimedOut => "the network connection timed out",
            std::io::ErrorKind::ConnectionRefused => "the network connection was refused",
            std::io::ErrorKind::ConnectionReset => "the network connection was reset",
            std::io::ErrorKind::NotFound => "the network target was not found",
            _ => "the network connection failed",
        },
        AppError::Db(sqlx::Error::Tls(_)) => "TLS negotiation or certificate verification failed",
        AppError::Timeout(_) => "the bounded connection attempt timed out",
        AppError::Network(_) | AppError::Io(_) => "the network connection failed",
        AppError::AuthenticationRequired(_) => {
            "the connection credential is no longer authenticated"
        }
        AppError::ManagedConnectionRecoveryRequired => {
            "the managed workspace connection requires provider repair"
        }
        AppError::Config(_) => "the driver rejected the connection configuration",
        AppError::CredentialBindingRequired => {
            "this device has no saved credential for the connection"
        }
        AppError::Keychain(_) => "the OS credential store could not supply this connection",
        AppError::RetryLater { .. } => "the connection is cooling down after a failed open",
        AppError::SharedConnectionChanged => {
            "the shared connection changed after this device loaded it"
        }
        AppError::Mongo(_) => "the MongoDB driver rejected the connection",
        _ => "the driver did not provide a safe diagnostic",
    };
    detail.to_owned()
}

#[cfg(test)]
pub(crate) fn assert_connection_test_failure_contract() {
    #[derive(Debug, thiserror::Error)]
    #[error("{0}")]
    struct HostileDatabaseError(String);
    impl sqlx::error::DatabaseError for HostileDatabaseError {
        fn message(&self) -> &str {
            &self.0
        }
        fn code(&self) -> Option<std::borrow::Cow<'_, str>> {
            Some("28P01".into())
        }
        fn as_error(&self) -> &(dyn std::error::Error + Send + Sync + 'static) {
            self
        }
        fn as_error_mut(&mut self) -> &mut (dyn std::error::Error + Send + Sync + 'static) {
            self
        }
        fn into_error(self: Box<Self>) -> Box<dyn std::error::Error + Send + Sync + 'static> {
            self
        }
        fn kind(&self) -> sqlx::error::ErrorKind {
            sqlx::error::ErrorKind::Other
        }
    }
    let hostile = "postgres://fixture:password@host/db?token=private /Users/fixture/.ssh/key\u{1b}[31m\n\tsecret";
    let database_error = AppError::Db(sqlx::Error::Database(Box::new(HostileDatabaseError(
        hostile.into(),
    ))));
    let database_failure = connection_test_failure(&database_error);
    assert_eq!(
        database_failure.code,
        ConnectionTestFailureCode::Authentication
    );
    assert_eq!(
        database_failure.detail,
        "the database rejected the connection request"
    );
    let public_database = database_error.public_connection_failure();
    assert_eq!(public_database.kind(), "connectionAuthentication");
    assert_eq!(
        public_database.to_string(),
        ConnectionFailureCode::Authentication.message()
    );
    for (diagnostic, expected) in [
        (
            "Host key verification failed",
            ConnectionFailureCode::SshHostKey,
        ),
        (
            "Permission denied (publickey)",
            ConnectionFailureCode::SshAuthentication,
        ),
        (
            "Bad configuration option",
            ConnectionFailureCode::SshConfiguration,
        ),
        ("Connection refused", ConnectionFailureCode::SshForwarding),
        ("Connection timed out", ConnectionFailureCode::SshTimeout),
        ("unrecognized diagnostic", ConnectionFailureCode::SshUnknown),
    ] {
        let stderr = format!("{diagnostic}\n{hostile}");
        let code = crate::connection::ssh::classify_ssh_failure(stderr.as_bytes());
        assert_eq!(code, expected);
        let error = AppError::ConnectionFailure(code);
        let wire = serde_json::to_string(&error).unwrap();
        assert!(!wire.contains("password"));
        assert!(!wire.contains("token="));
        assert!(!wire.contains("/Users/"));
        assert!(!error.to_string().chars().any(char::is_control));
        let receipt = ConnectionTestReceipt::from_result(Err(error));
        let failure = receipt.failure.unwrap();
        assert_eq!(failure.field, Some(ConnectionTestFailureField::Ssh));
        assert_eq!(failure.detail, code.message());
    }
    for error in [
        AppError::Network(hostile.into()),
        AppError::Config(hostile.into()),
        AppError::AuthenticationRequired(hostile.into()),
        AppError::Blocked {
            reason: hostile.into(),
        },
        AppError::Agent(hostile.into()),
    ] {
        let public = error.public_connection_failure();
        let wire = serde_json::to_string(&public).unwrap();
        assert!(!wire.contains("password"));
        assert!(!wire.contains("token="));
        assert!(!wire.contains("/Users/"));
        assert!(!public.to_string().chars().any(char::is_control));
    }
    assert_eq!(
        AppError::AuthenticationRequired(hostile.into())
            .public_connection_failure()
            .kind(),
        "authenticationRequired"
    );
    assert_eq!(
        AppError::ManagedConnectionRecoveryRequired
            .public_connection_failure()
            .kind(),
        "managedConnectionRecoveryRequired"
    );
    assert_eq!(
        AppError::CredentialBindingRequired
            .public_connection_failure()
            .kind(),
        "credentialBindingRequired"
    );
    assert_eq!(
        AppError::Blocked {
            reason: hostile.into()
        }
        .public_connection_failure()
        .kind(),
        "blocked"
    );
    assert_eq!(
        connection_test_failure(&AppError::ConnectionFailure(
            ConnectionFailureCode::SshClientMissing
        ))
        .code,
        ConnectionTestFailureCode::SshClientMissing
    );
    assert_eq!(
        classify_database_identity(Some("28P01"), None),
        (
            ConnectionTestFailureCode::Authentication,
            Some(ConnectionTestFailureField::Credentials),
        ),
    );
    assert_eq!(
        classify_database_identity(Some("08006"), None).0,
        ConnectionTestFailureCode::TimeoutNetwork,
    );
    assert_eq!(
        classify_database_identity(None, Some(1_049)),
        (
            ConnectionTestFailureCode::DatabaseConfig,
            Some(ConnectionTestFailureField::Database),
        ),
    );
    assert_eq!(
        connection_test_failure(&AppError::Timeout("probe".into())).code,
        ConnectionTestFailureCode::TimeoutNetwork,
    );
    assert_eq!(
        connection_test_failure(&AppError::AuthenticationRequired("Google Cloud".into())),
        ConnectionTestFailure {
            code: ConnectionTestFailureCode::Authentication,
            field: Some(ConnectionTestFailureField::Credentials),
            detail: "the connection credential is no longer authenticated".into(),
            refusal: None,
            retry_after_seconds: None,
        },
    );
    assert_eq!(
        connection_test_failure(&AppError::Db(sqlx::Error::Tls(Box::new(
            std::io::Error::other("certificate detail must not serialize"),
        ))))
        .code,
        ConnectionTestFailureCode::Tls,
    );
    assert_eq!(
        connection_test_failure(&AppError::NotFound("connection".into())).code,
        ConnectionTestFailureCode::Unknown,
    );
    // A saved credential missing from this device routes to credential entry.
    assert_eq!(
        connection_test_failure(&AppError::CredentialBindingRequired),
        ConnectionTestFailure {
            code: ConnectionTestFailureCode::Authentication,
            field: Some(ConnectionTestFailureField::Credentials),
            detail: "this device has no saved credential for the connection".into(),
            refusal: None,
            retry_after_seconds: None,
        },
    );
    assert_eq!(
        connection_test_failure(&AppError::Config("secret=must-not-serialize".into())).detail,
        "the driver rejected the connection configuration",
    );
    let success = serde_json::to_value(ConnectionTestReceipt::from_result(Ok(()))).unwrap();
    assert_eq!(success, serde_json::json!({"ok": true, "failure": null}));
    let failure = serde_json::to_value(ConnectionTestReceipt::from_result(Err(AppError::Timeout(
        "probe".into(),
    ))))
    .unwrap();
    assert_eq!(failure["failure"]["code"], "timeoutNetwork");
    assert_eq!(failure["failure"]["field"], serde_json::Value::Null);
    // A driver-reported failure keeps its wire shape; only a refusal adds fields.
    assert!(failure["failure"].get("refusal").is_none());
    assert!(failure["failure"].get("retryAfterSeconds").is_none());

    // A cooling-down managed open stays in the network family and reports the
    // remaining wait; a changed shared connection asks for a workspace refresh.
    let cooling = serde_json::to_value(ConnectionTestReceipt::from_result(Err(
        AppError::RetryLater {
            retry_after_seconds: 12,
        },
    )))
    .unwrap();
    assert_eq!(cooling["failure"]["code"], "timeoutNetwork");
    assert_eq!(cooling["failure"]["field"], serde_json::Value::Null);
    assert_eq!(cooling["failure"]["refusal"], "retryLater");
    assert_eq!(cooling["failure"]["retryAfterSeconds"], 12);
    let changed = serde_json::to_value(ConnectionTestReceipt::from_result(Err(
        AppError::SharedConnectionChanged,
    )))
    .unwrap();
    assert_eq!(changed["failure"]["code"], "unknown");
    assert_eq!(changed["failure"]["field"], serde_json::Value::Null);
    assert_eq!(changed["failure"]["refusal"], "sharedConnectionChanged");
    assert!(changed["failure"].get("retryAfterSeconds").is_none());
    // A missing or rejected workspace session asks for sign-in, while a provider
    // CLI sign-in keeps the plain credential failure.
    let signed_out = connection_test_failure(&AppError::AuthenticationRequired(
        crate::hosted_control_plane::WORKSPACE_AUTHENTICATION.into(),
    ));
    assert_eq!(signed_out.code, ConnectionTestFailureCode::Authentication);
    assert_eq!(
        signed_out.refusal,
        Some(ConnectionProbeRefusal::WorkspaceSignInRequired)
    );
    // A credential store that refused access points at the credential field with
    // its own guidance, never as an unknown failure, and drops platform detail.
    let denied = serde_json::to_value(ConnectionTestReceipt::from_result(Err(AppError::Keychain(
        keyring::Error::PlatformFailure("platform keychain detail must not serialize".into()),
    ))))
    .unwrap();
    assert_eq!(denied["failure"]["code"], "authentication");
    assert_eq!(denied["failure"]["field"], "credentials");
    assert_eq!(denied["failure"]["refusal"], "credentialStoreDenied");
    assert!(!denied.to_string().contains("platform keychain detail"));
    assert!(
        connection_test_failure(&AppError::CredentialBindingRequired)
            .refusal
            .is_none()
    );
    // A lock wait belongs to the timeout family and asks for a retry, not an edit.
    let locked = connection_test_failure(&AppError::ConnectionFailure(
        ConnectionFailureCode::LockTimeout,
    ));
    assert_eq!(locked.code, ConnectionTestFailureCode::TimeoutNetwork);
    assert_eq!(locked.field, None);
    assert_eq!(locked.refusal, Some(ConnectionProbeRefusal::LockTimeout));
    assert_eq!(
        serde_json::to_value(locked.refusal).unwrap(),
        serde_json::json!("lockTimeout")
    );

    // A saved credential is reused only for the endpoint it was stored with.
    let stored: ConnectionProfile = serde_json::from_value(serde_json::json!({
        "id": "6c1f2d8e-61b5-4d3e-9a52-0a5a6a0f4c11",
        "name": "fixture",
        "engine": "postgres",
        "host": "db.example.test",
        "port": 5432,
        "database": "app",
        "username": "reader",
        "sslmode": "require",
        "extraParams": { SSH_ALIAS_PARAMETER: "bastion" },
        "readonlyDefault": true,
        "allowWrites": false,
        "secretRef": "1f0e9d8c-7b6a-4954-8372-615049382716",
    }))
    .unwrap();
    let mut draft = stored.clone();
    draft.database = "analytics".into();
    draft.host = " DB.Example.Test ".into();
    assert!(same_credential_endpoint(&stored, &draft));
    let moves: [fn(&mut ConnectionProfile); 5] = [
        |draft| draft.host = "attacker.example.test".into(),
        |draft| draft.port = 6543,
        |draft| draft.username = "admin".into(),
        |draft| draft.engine = Engine::Mysql,
        |draft| {
            draft.extra_params.remove(SSH_ALIAS_PARAMETER);
        },
    ];
    for change in moves {
        let mut moved = stored.clone();
        change(&mut moved);
        assert!(!same_credential_endpoint(&stored, &moved));
    }

    // Equal or stronger transport security keeps the saved credential. A weaker
    // channel, a spelling the driver rejects, or a different trust anchor while
    // the stored profile verifies the server does not.
    fn with(
        profile: &ConnectionProfile,
        sslmode: &str,
        params: &[(&str, &str)],
    ) -> ConnectionProfile {
        let mut changed = profile.clone();
        changed.sslmode = sslmode.into();
        for (key, value) in params {
            changed.extra_params.insert((*key).into(), (*value).into());
        }
        changed
    }
    for (sslmode, keeps) in [
        ("disable", false),
        ("allow", false),
        ("prefer", false),
        ("", false),
        ("require", true),
        ("verify-ca", true),
        ("verify-full", true),
        ("verrify-full", false),
    ] {
        assert_eq!(
            same_credential_endpoint(&stored, &with(&stored, sslmode, &[])),
            keeps,
            "{sslmode}"
        );
    }
    assert!(same_credential_endpoint(
        &stored,
        &with(&stored, "verify-full", &[("sslrootcert_pem", "PEM")]),
    ));
    let verified = with(
        &stored,
        "verify-ca",
        &[("sslrootcert", "/etc/dopedb/ca.pem")],
    );
    assert!(same_credential_endpoint(
        &verified,
        &with(&verified, "verify-full", &[])
    ));
    assert!(!same_credential_endpoint(
        &verified,
        &with(&verified, "require", &[])
    ));
    assert!(!same_credential_endpoint(
        &verified,
        &with(
            &verified,
            "verify-full",
            &[("sslrootcert", "/tmp/other-ca.pem")]
        ),
    ));
    let mut unanchored = verified.clone();
    unanchored.extra_params.remove("sslrootcert");
    assert!(!same_credential_endpoint(&verified, &unanchored));
    let mut mysql = with(&stored, "required", &[]);
    mysql.engine = Engine::Mysql;
    assert!(same_credential_endpoint(
        &mysql,
        &with(&mysql, "verify-identity", &[])
    ));
    assert!(!same_credential_endpoint(
        &mysql,
        &with(&mysql, "preferred", &[])
    ));
    assert!(!same_credential_endpoint(
        &mysql,
        &with(&mysql, "allow", &[])
    ));
    let mut mongo = with(&stored, "", &[("tls", "true")]);
    mongo.engine = Engine::Mongodb;
    assert!(same_credential_endpoint(&mongo, &mongo.clone()));
    for weaker in [
        ("tls", "false"),
        ("TLS", "false"),
        ("ssl", "false"),
        ("tlsInsecure", "true"),
        ("tlsAllowInvalidCertificates", "true"),
        ("tlsAllowInvalidHostnames", "true"),
        ("tls", "maybe"),
    ] {
        assert!(
            !same_credential_endpoint(&mongo, &with(&mongo, "", &[weaker])),
            "{weaker:?}"
        );
    }
    let mut srv = mongo.clone();
    srv.extra_params.remove("tls");
    srv.extra_params.insert("srv".into(), "true".into());
    let mut plain = srv.clone();
    plain.extra_params.remove("srv");
    assert!(!same_credential_endpoint(&srv, &plain));
    assert!(same_credential_endpoint(&plain, &srv));
    let anchored = with(&mongo, "", &[("tlsCAFile", "/etc/dopedb/mongo-ca.pem")]);
    assert!(same_credential_endpoint(&anchored, &anchored.clone()));
    assert!(!same_credential_endpoint(
        &anchored,
        &with(&anchored, "", &[("tlsCAFile", "/tmp/other-ca.pem")]),
    ));

    let refused =
        serde_json::to_value(ConnectionTestReceipt::saved_credential_endpoint_changed()).unwrap();
    assert_eq!(refused["ok"], false);
    assert_eq!(refused["failure"]["code"], "authentication");
    assert_eq!(refused["failure"]["field"], "credentials");
    assert_eq!(
        refused["failure"]["refusal"],
        "savedCredentialEndpointChanged"
    );
    assert_eq!(
        serde_json::to_value(DatabaseDiscoveryReceipt::refused(
            ConnectionProbeRefusal::SavedCredentialEndpointChanged,
        ))
        .unwrap(),
        serde_json::json!({ "databases": [], "refusal": "savedCredentialEndpointChanged" }),
    );
    assert_eq!(
        serde_json::to_value(DatabaseDiscoveryReceipt::found(Vec::new())).unwrap(),
        serde_json::json!({ "databases": [] }),
    );
}
