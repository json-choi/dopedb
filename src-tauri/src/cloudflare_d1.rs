//! Cloudflare D1 adapter backed by Cloudflare's official Wrangler CLI.
//!
//! Wrangler owns browser OAuth, token refresh, and every Cloudflare request. DopeDB
//! stores only an opaque Workspace/member-scoped CLI home plus the selected account
//! and database identifiers. SQL enters the verified Wrangler process over stdin so
//! statement text is never exposed in the operating-system process list.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::kernel::access::ActiveResourceScope;
use crate::model::{ConnectionProfile, Engine, Provider, QueryKind, QueryResult};

#[path = "cloudflare_d1/introspection.rs"]
mod introspection;
#[path = "cloudflare_d1/onboarding.rs"]
mod onboarding;
#[path = "cloudflare_d1/process.rs"]
mod process;

pub(crate) use onboarding::{
    auth_state, authenticate_account, cleanup_connection_auth, discover_accounts,
    discover_databases, CloudflareD1AccountSummary, CloudflareD1AuthState,
    CloudflareD1DatabaseSummary,
};

const QUERY_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CloudflareD1AuthScope {
    key: String,
}

impl CloudflareD1AuthScope {
    pub(crate) fn from_active_scope(scope: &ActiveResourceScope, connection_id: Uuid) -> Self {
        let mut digest = Sha256::new();
        digest.update(b"dopedb-cloudflare-d1-workspace-member-connection-v1\0");
        digest.update(scope.workspace_id.as_bytes());
        digest.update(b"\0");
        digest.update(scope.account_scope.storage_key().as_bytes());
        digest.update(b"\0");
        digest.update(connection_id.as_bytes());
        Self {
            key: hex::encode(digest.finalize()),
        }
    }

    fn key(&self) -> &str {
        &self.key
    }
}

#[derive(Clone)]
pub(crate) struct D1Connection {
    inner: Arc<D1ConnectionInner>,
}

struct D1ConnectionInner {
    runtime: process::WranglerRuntime,
    auth_root: PathBuf,
    account_id: String,
    database_id: Uuid,
}

#[derive(Debug, Default, Deserialize)]
struct D1Meta {
    #[serde(default)]
    changes: u64,
}

#[derive(Debug, Default, Deserialize)]
struct WranglerResult {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    results: Vec<serde_json::Map<String, Value>>,
    #[serde(default)]
    meta: D1Meta,
}

pub(crate) fn is_cli_available() -> bool {
    process::runtime_candidates_exist()
}

pub(crate) async fn connect(
    profile: &ConnectionProfile,
    scope: &CloudflareD1AuthScope,
) -> AppResult<D1Connection> {
    validate_profile(profile)?;
    let auth_root = onboarding::auth_root(scope)?;
    let runtime = process::discover_runtime().await?;
    process::verify_version(&runtime, &auth_root).await?;
    let connection = D1Connection {
        inner: Arc::new(D1ConnectionInner {
            runtime,
            auth_root,
            account_id: profile.host.trim().to_owned(),
            database_id: Uuid::parse_str(profile.database.trim())
                .map_err(|_| AppError::Config("Cloudflare D1 database id must be a UUID".into()))?,
        }),
    };
    connection.ping().await?;
    Ok(connection)
}

pub(crate) fn validate_profile(profile: &ConnectionProfile) -> AppResult<()> {
    if profile.engine != Engine::Sqlite || profile.provider != Provider::CloudflareD1 {
        return Err(AppError::Config(
            "Cloudflare D1 requires the SQLite engine and cloudflareD1 provider".into(),
        ));
    }
    let account_id = profile.host.trim();
    if account_id.len() != 32 || !account_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(AppError::Config(
            "Cloudflare account id must be exactly 32 hexadecimal characters".into(),
        ));
    }
    Uuid::parse_str(profile.database.trim())
        .map_err(|_| AppError::Config("Cloudflare D1 database id must be a UUID".into()))?;
    if profile.port != 443 || profile.sslmode != "require" {
        return Err(AppError::Config(
            "Cloudflare D1 connections require HTTPS on port 443".into(),
        ));
    }
    if !profile.username.trim().is_empty() || profile.secret_ref.is_some() {
        return Err(AppError::Config(
            "Cloudflare credentials are owned by Wrangler; username and password must be empty"
                .into(),
        ));
    }
    if !profile.extra_params.is_empty() {
        return Err(AppError::Config(
            "Cloudflare D1 does not accept custom connection parameters".into(),
        ));
    }
    Ok(())
}

impl D1Connection {
    pub(crate) async fn ping(&self) -> AppResult<()> {
        self.query("SELECT 1 AS dopedb_ping", 1).await.map(|_| ())
    }

    pub(crate) async fn query(&self, sql: &str, max_rows: u64) -> AppResult<QueryResult> {
        let classification = crate::safety::classify(sql, Engine::Sqlite)?;
        if classification.kind != QueryKind::Read || classification.statement_count != 1 {
            return Err(AppError::Blocked {
                reason: "Cloudflare D1 reads require one read-only statement".into(),
            });
        }
        self.raw(sql, max_rows).await
    }

    async fn raw(&self, sql: &str, max_rows: u64) -> AppResult<QueryResult> {
        let started = Instant::now();
        let results = self.run_sql(sql).await?;
        let result = results
            .into_iter()
            .next()
            .ok_or_else(|| AppError::Network("Wrangler returned no D1 query result".into()))?;
        if !result.success {
            return Err(AppError::Network(
                "Wrangler reported an unsuccessful D1 query".into(),
            ));
        }
        let columns = result
            .results
            .first()
            .map(|row| row.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        let max = usize::try_from(max_rows).unwrap_or(usize::MAX);
        let truncated = result.results.len() > max;
        let rows = result
            .results
            .into_iter()
            .take(max)
            .map(|mut row| {
                columns
                    .iter()
                    .map(|column| row.remove(column).unwrap_or(Value::Null))
                    .collect()
            })
            .collect::<Vec<_>>();
        Ok(QueryResult {
            columns,
            row_count: rows.len(),
            rows,
            decode_failures: Vec::new(),
            truncated,
            duration_ms: started.elapsed().as_millis() as u64,
        })
    }

    pub(crate) async fn execute(&self, sql: &str) -> AppResult<u64> {
        let results = self.run_sql(sql).await.map_err(|error| match error {
            AppError::Network(message) | AppError::Timeout(message) => {
                AppError::OutcomeUnknown(message)
            }
            other => other,
        })?;
        if results.iter().any(|result| !result.success) {
            return Err(AppError::Network(
                "Wrangler reported an unsuccessful D1 mutation".into(),
            ));
        }
        Ok(results.into_iter().map(|result| result.meta.changes).sum())
    }

    async fn run_sql(&self, sql: &str) -> AppResult<Vec<WranglerResult>> {
        let value = process::run_json(
            &self.inner.runtime,
            &[
                "d1".into(),
                "execute".into(),
                self.inner.database_id.to_string(),
                "--remote".into(),
                "--command".into(),
                sql.into(),
                "--json".into(),
            ],
            &self.inner.auth_root,
            Some(&self.inner.account_id),
            QUERY_TIMEOUT,
        )
        .await?;
        serde_json::from_value(value)
            .map_err(|_| AppError::Config("Wrangler returned invalid D1 query JSON".into()))
    }
}
