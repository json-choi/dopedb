//! MongoDB document-database adapter. Deliberately separate from the sqlx pool
//! stack (`connection::pool`): MongoDB has no server-enforced read-only session
//! equivalent to L2, so safety here is structural — data access happens ONLY
//! through the typed [`crate::model::DocumentQuery`] API in [`query`], which
//! calls the driver's `find`/`aggregate`/`count_documents` and never
//! `run_command`. Users are still advised to grant the DB account the `read`
//! role; the client allowlist is not presented as a substitute for it.

pub mod introspect;
pub mod query;

use std::collections::HashMap;

use dopedb_protocol::SharedMongoOptions;
use mongodb::bson::doc;
use mongodb::options::ClientOptions;
use mongodb::Client;

use crate::connection::providers;
use crate::error::{AppError, AppResult};
use crate::model::ConnectionProfile;

/// Option names a shared template owns. `build_uri` reads exactly these spellings
/// (the driver matches option names case-insensitively, so a stray spelling is
/// folded onto them), and no other driver parameter is shared.
const SRV_KEY: &str = "srv";
const AUTH_SOURCE_KEY: &str = "authSource";
const REPLICA_SET_KEY: &str = "replicaSet";

fn is_template_key(key: &str) -> bool {
    [SRV_KEY, AUTH_SOURCE_KEY, REPLICA_SET_KEY]
        .iter()
        .any(|owned| key.eq_ignore_ascii_case(owned))
}

fn param<'a>(params: &'a HashMap<String, String>, name: &str) -> Option<&'a str> {
    params
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.trim())
        .filter(|value| !value.is_empty())
}

/// The shareable subset of a local MongoDB profile's parameters, or `None` when it
/// sets none of them. TLS files, read preference and every other option stay out.
pub(crate) fn template_options(params: &HashMap<String, String>) -> Option<SharedMongoOptions> {
    let srv = param(params, SRV_KEY).is_some_and(|value| value.eq_ignore_ascii_case("true"));
    let auth_source = param(params, AUTH_SOURCE_KEY).map(str::to_owned);
    let replica_set = param(params, REPLICA_SET_KEY).map(str::to_owned);
    (srv || auth_source.is_some() || replica_set.is_some()).then_some(SharedMongoOptions {
        srv,
        auth_source,
        replica_set,
    })
}

/// Make `options` the only template-owned parameters in `params`: stale or
/// differently-cased copies are removed first, so a member binding can neither
/// keep nor override what the shared template says.
pub(crate) fn apply_template_options(
    params: &mut HashMap<String, String>,
    options: Option<&SharedMongoOptions>,
) {
    params.retain(|key, _| !is_template_key(key));
    let Some(options) = options else { return };
    if options.srv {
        params.insert(SRV_KEY.into(), "true".into());
    }
    if let Some(value) = &options.auth_source {
        params.insert(AUTH_SOURCE_KEY.into(), value.clone());
    }
    if let Some(value) = &options.replica_set {
        params.insert(REPLICA_SET_KEY.into(), value.clone());
    }
}

/// A live MongoDB client bound to the profile's database. Cheap to clone —
/// `Client` is an `Arc` handle over its own connection pool.
#[derive(Clone)]
pub struct MongoConnection {
    client: Client,
    db_name: String,
}

impl MongoConnection {
    /// The profile's database handle. All reads and introspection scope to it.
    pub fn database(&self) -> mongodb::Database {
        self.client.database(&self.db_name)
    }

    pub(crate) fn database_name(&self) -> &str {
        &self.db_name
    }

    pub(crate) async fn database_names(&self) -> AppResult<Vec<String>> {
        self.client.list_database_names().await.map_err(Into::into)
    }

    /// Liveness probe. `ping` is a stateless no-op command — the sole
    /// `run_command` in this module; the query path never uses raw commands.
    pub async fn ping(&self) -> AppResult<()> {
        self.database().run_command(doc! { "ping": 1 }).await?;
        Ok(())
    }
}

/// Open (and verify with a ping) a MongoDB connection for `profile`.
pub(crate) async fn connect(
    profile: &ConnectionProfile,
    secret: &str,
) -> AppResult<MongoConnection> {
    let uri = build_uri(profile, secret)?;
    let mut options = ClientOptions::parse(&uri)
        .await
        .map_err(|e| sanitize(e, secret))?;
    let runtime = providers::connection_runtime_options(profile)?;
    options.app_name = Some("DopeDB".into());
    options.server_selection_timeout = Some(providers::connect_timeout(profile));
    options.max_idle_time = runtime.auto_disconnect_timeout;
    let client = Client::with_options(options).map_err(|e| sanitize(e, secret))?;
    let conn = MongoConnection {
        client,
        db_name: profile.database.clone(),
    };
    // The client is lazy; ping so connect fails eagerly like the sqlx pools do.
    conn.ping().await?;
    Ok(conn)
}

/// Assemble a `mongodb://` / `mongodb+srv://` URI from the decomposed profile.
///
/// Conventions (no store schema change needed):
/// - `extra_params["srv"] == "true"` selects the `mongodb+srv` scheme (port unused).
/// - `host` passes through verbatim, so a comma-separated replica-set list or an
///   explicit `host:port` works; the profile port is appended only to a bare host.
/// - Every other `extra_params` entry becomes a URI option (`authSource`,
///   `replicaSet`, `tls`, `tlsCAFile`, …) — the official driver parses/validates.
fn build_uri(profile: &ConnectionProfile, secret: &str) -> AppResult<String> {
    let srv = profile
        .extra_params
        .get("srv")
        .is_some_and(|v| v.trim().eq_ignore_ascii_case("true"));
    let host = profile.host.trim();
    let host = if host.is_empty() { "localhost" } else { host };

    let database = profile.database.trim();
    if database.is_empty() {
        return Err(AppError::Config(
            "MongoDB connections need a database name".into(),
        ));
    }
    if database.contains(['/', '\\', '?', '#', '@', ' ']) {
        return Err(AppError::Config(format!(
            "invalid MongoDB database name {database:?}"
        )));
    }

    let scheme = if srv { "mongodb+srv" } else { "mongodb" };
    let authority = if srv || host.contains(',') || host.contains(':') {
        host.to_string()
    } else {
        format!("{host}:{}", profile.port)
    };

    let mut uri = format!("{scheme}://");
    if !profile.username.is_empty() {
        uri.push_str(&encode_component(&profile.username));
        if !secret.is_empty() {
            uri.push(':');
            uri.push_str(&encode_component(secret));
        }
        uri.push('@');
    }
    uri.push_str(&authority);
    uri.push('/');
    uri.push_str(database);

    let mut params: Vec<(&String, &String)> = profile
        .extra_params
        .iter()
        .filter(|(k, _)| k.as_str() != "srv" && !k.starts_with("dopedb."))
        .collect();
    params.sort();
    for (i, (k, v)) in params.iter().enumerate() {
        uri.push(if i == 0 { '?' } else { '&' });
        uri.push_str(&encode_component(k));
        uri.push('=');
        uri.push_str(&encode_component(v));
    }
    Ok(uri)
}

/// Percent-encode everything outside RFC 3986 unreserved characters.
fn encode_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Driver config errors can echo parts of the connection string. The secret must
/// never reach logs, the UI, or the append-only audit chain — scrub both its raw
/// and percent-encoded spellings before the message leaves this module.
fn sanitize(e: mongodb::error::Error, secret: &str) -> AppError {
    AppError::Config(format!(
        "MongoDB connection failed: {}",
        scrub(e.to_string(), secret)
    ))
}

fn scrub(mut msg: String, secret: &str) -> String {
    if !secret.is_empty() {
        msg = msg.replace(secret, "***");
        msg = msg.replace(&encode_component(secret), "***");
    }
    msg
}
