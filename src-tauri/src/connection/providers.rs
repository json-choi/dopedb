//! Per-provider connection-string normalization. We do NOT bundle any external CA files — a custom CA can be
//! supplied per connection via `extra_params["sslrootcert"]` (documented, not shipped).

use std::{sync::Arc, time::Duration};

use sqlparser::ast::{Expr, ObjectName, Set, Statement};
use sqlparser::dialect::{Dialect, MySqlDialect, PostgreSqlDialect};
use sqlparser::parser::Parser;
use sqlx::mysql::{MySqlConnectOptions, MySqlSslMode};
use sqlx::postgres::PgConnectOptions;

use crate::error::{AppError, AppResult};
use crate::model::{ConnectionProfile, Engine, Provider};

const TIME_ZONE_PARAMETER: &str = "dopedb.timeZone";
const KEEP_ALIVE_SECONDS_PARAMETER: &str = "dopedb.keepAliveSeconds";
const AUTO_DISCONNECT_SECONDS_PARAMETER: &str = "dopedb.autoDisconnectSeconds";
const STARTUP_SCRIPT_PARAMETER: &str = "dopedb.startupScript";
/// Marks a PostgreSQL endpoint as a transaction-mode pooler that DopeDB cannot
/// recognize from its host (`"true"` to opt in).
const TRANSACTION_POOLER_PARAMETER: &str = "dopedb.transactionPooler";

const KEEP_ALIVE_MIN_SECONDS: u64 = 10;
const AUTO_DISCONNECT_MIN_SECONDS: u64 = 30;
const CONNECTION_OPTION_MAX_SECONDS: u64 = 86_400;
const STARTUP_SCRIPT_MAX_CHARACTERS: usize = 4_096;

#[derive(Clone)]
pub struct ConnectionRuntimeOptions {
    pub keep_alive_interval: Option<Duration>,
    pub auto_disconnect_timeout: Option<Duration>,
    pub startup_script: Option<Arc<str>>,
}

fn bounded_seconds(
    profile: &ConnectionProfile,
    key: &str,
    min: u64,
) -> AppResult<Option<Duration>> {
    let Some(raw) = profile.extra_params.get(key) else {
        return Ok(None);
    };
    let seconds = raw.trim().parse::<u64>().map_err(|_| {
        AppError::Config(format!(
            "{key} must be an integer from {min} through {CONNECTION_OPTION_MAX_SECONDS}"
        ))
    })?;
    if !(min..=CONNECTION_OPTION_MAX_SECONDS).contains(&seconds) {
        return Err(AppError::Config(format!(
            "{key} must be from {min} through {CONNECTION_OPTION_MAX_SECONDS} seconds"
        )));
    }
    Ok(Some(Duration::from_secs(seconds)))
}

fn time_zone(profile: &ConnectionProfile) -> Option<&str> {
    profile
        .extra_params
        .get(TIME_ZONE_PARAMETER)
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

pub fn connection_runtime_options(
    profile: &ConnectionProfile,
) -> AppResult<ConnectionRuntimeOptions> {
    let startup_script = profile
        .extra_params
        .get(STARTUP_SCRIPT_PARAMETER)
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if startup_script.is_some() && !matches!(profile.engine, Engine::Postgres | Engine::Mysql) {
        return Err(AppError::Config(
            "startup scripts are available only for PostgreSQL and MySQL".into(),
        ));
    }
    if startup_script.is_some_and(|script| script.chars().count() > STARTUP_SCRIPT_MAX_CHARACTERS) {
        return Err(AppError::Config(format!(
            "{STARTUP_SCRIPT_PARAMETER} must not exceed {STARTUP_SCRIPT_MAX_CHARACTERS} characters"
        )));
    }
    if let Some(script) = startup_script {
        validate_startup_script(script, profile.engine)?;
    }

    let zone = time_zone(profile);
    if zone.is_some() && !matches!(profile.engine, Engine::Postgres | Engine::Mysql) {
        return Err(AppError::Config(
            "connection time zones are available only for PostgreSQL and MySQL".into(),
        ));
    }
    if zone.is_some_and(|value| {
        value.len() > 64
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"_./:+-".contains(&byte))
    }) {
        return Err(AppError::Config(format!(
            "{TIME_ZONE_PARAMETER} must be an IANA name or numeric offset"
        )));
    }

    let keep_alive_interval = bounded_seconds(
        profile,
        KEEP_ALIVE_SECONDS_PARAMETER,
        KEEP_ALIVE_MIN_SECONDS,
    )?;
    if keep_alive_interval.is_some() && !matches!(profile.engine, Engine::Postgres | Engine::Mysql)
    {
        return Err(AppError::Config(
            "keep-alive queries are available only for PostgreSQL and MySQL".into(),
        ));
    }

    Ok(ConnectionRuntimeOptions {
        keep_alive_interval,
        auto_disconnect_timeout: bounded_seconds(
            profile,
            AUTO_DISCONNECT_SECONDS_PARAMETER,
            AUTO_DISCONNECT_MIN_SECONDS,
        )?,
        startup_script: startup_script.map(Arc::<str>::from),
    })
}

pub fn validate_connection_options(profile: &ConnectionProfile) -> AppResult<()> {
    connection_runtime_options(profile).map(|_| ())
}

fn startup_value_is_literal(value: &Expr) -> bool {
    match value {
        Expr::Identifier(_) | Expr::CompoundIdentifier(_) | Expr::Value(_) => true,
        Expr::Nested(value) => startup_value_is_literal(value),
        Expr::UnaryOp { expr, .. } => matches!(expr.as_ref(), Expr::Value(_)),
        _ => false,
    }
}

fn startup_variable_allowed(engine: Engine, variable: &ObjectName) -> bool {
    let variable = variable
        .to_string()
        .trim_matches(['`', '"'])
        .to_ascii_lowercase();
    let allowed = match engine {
        Engine::Postgres => &[
            "application_name",
            "bytea_output",
            "client_min_messages",
            "datestyle",
            "extra_float_digits",
            "idle_in_transaction_session_timeout",
            "intervalstyle",
            "lock_timeout",
            "search_path",
            "statement_timeout",
            "timezone",
        ][..],
        Engine::Mysql => &[
            "character_set_results",
            "collation_connection",
            "group_concat_max_len",
            "max_execution_time",
            "optimizer_switch",
            "sql_mode",
            "time_zone",
        ][..],
        Engine::Sqlite | Engine::Mongodb | Engine::Bigquery => &[][..],
    };
    allowed.contains(&variable.as_str())
}

fn startup_set_allowed(engine: Engine, set: &Set) -> bool {
    match set {
        Set::SingleAssignment {
            variable, values, ..
        } => {
            startup_variable_allowed(engine, variable)
                && values.iter().all(startup_value_is_literal)
        }
        Set::MultipleAssignments { assignments } => assignments.iter().all(|assignment| {
            startup_variable_allowed(engine, &assignment.name)
                && startup_value_is_literal(&assignment.value)
        }),
        Set::SetTimeZone { value, .. } => {
            engine == Engine::Postgres && startup_value_is_literal(value)
        }
        Set::SetNames { .. } | Set::SetNamesDefault {} => engine == Engine::Mysql,
        _ => false,
    }
}

pub(crate) fn validate_startup_script(script: &str, engine: Engine) -> AppResult<()> {
    let dialect: Box<dyn Dialect> = match engine {
        Engine::Postgres => Box::new(PostgreSqlDialect {}),
        Engine::Mysql => Box::new(MySqlDialect {}),
        Engine::Sqlite | Engine::Mongodb | Engine::Bigquery => {
            return Err(AppError::Config(
                "startup scripts are available only for PostgreSQL and MySQL".into(),
            ))
        }
    };
    let statements = Parser::parse_sql(&*dialect, script).map_err(|error| {
        AppError::Config(format!("startup script could not be parsed: {error}"))
    })?;
    if statements.is_empty()
        || statements.iter().any(|statement| {
            !matches!(
                statement,
                Statement::Set(set) if startup_set_allowed(engine, set)
            )
        })
    {
        return Err(AppError::Config(
            "startup script accepts only allowlisted session SET statements".into(),
        ));
    }
    Ok(())
}

/// Classify a profile by host. Cheap substring match — hosts are provider-fixed.
pub fn detect(p: &ConnectionProfile) -> Provider {
    let h = p.host.to_ascii_lowercase();
    if h.contains("neon.tech") {
        Provider::Neon
    } else if h.contains("psdb.cloud") {
        Provider::PlanetScale
    } else if h.ends_with(".sql.goog")
        || h.ends_with(".sql-psa.goog")
        || h.ends_with(".sql-psc.goog")
    {
        Provider::GcpCloudSql
    } else {
        Provider::Generic
    }
}

/// Resolve `Auto` to a concrete provider without conflating that provider with an engine.
pub fn resolve(p: &ConnectionProfile) -> Provider {
    match p.provider {
        Provider::Auto => detect(p),
        explicit => explicit,
    }
}

/// PlanetScale/Vitess is sharded — its FK metadata in `information_schema` is
/// unreliable, so introspection skips it.
pub fn skip_fk_metadata(p: &ConnectionProfile) -> bool {
    p.engine == Engine::Mysql && resolve(p) == Provider::PlanetScale
}

/// Pool acquire timeout. Neon scales to zero, so cold connects need slack.
pub fn connect_timeout(p: &ConnectionProfile) -> Duration {
    match resolve(p) {
        Provider::Neon | Provider::GcpCloudSql => Duration::from_secs(30),
        _ => Duration::from_secs(15),
    }
}

/// A Supavisor host: `pooler.supabase.com` itself or a regional
/// `<region>.pooler.supabase.com`, matched at a label boundary so another domain
/// that merely contains the name is never treated as one.
fn supavisor_host(host: &str) -> bool {
    host == "pooler.supabase.com" || host.ends_with(".pooler.supabase.com")
}

/// Whether a PostgreSQL profile reaches the database through a transaction-mode
/// pooler, where consecutive transactions may run on different server sessions
/// that other clients share, so a session-level `SET` neither sticks nor stays
/// private: Supavisor's transaction port (a `supavisor_host` on 6543; 5432
/// there is session mode), Neon's pooled endpoints (a first label ending in
/// `-pooler` under `.neon.tech`, PgBouncer in transaction mode), or a profile that
/// sets `dopedb.transactionPooler` to `true`. The connection editor mirrors this
/// rule in `isPostgresTransactionPooler` (`src/features/connections/options.ts`)
/// to warn that the startup script will not run; change both together.
pub(crate) fn pg_transaction_pooler(p: &ConnectionProfile) -> bool {
    let host = p.host.trim().to_ascii_lowercase();
    let neon_pooled = host.ends_with(".neon.tech")
        && host
            .split('.')
            .next()
            .is_some_and(|label| label.ends_with("-pooler"));
    (supavisor_host(&host) && p.port == 6543)
        || neon_pooled
        || p.extra_params
            .get(TRANSACTION_POOLER_PARAMETER)
            .is_some_and(|value| value.trim().eq_ignore_ascii_case("true"))
}

/// Apply Postgres per-provider tuning to freshly-built connect options.
pub fn apply_pg_tuning(p: &ConnectionProfile, mut opts: PgConnectOptions) -> PgConnectOptions {
    if supavisor_host(&p.host.trim().to_ascii_lowercase()) || pg_transaction_pooler(p) {
        // A transaction pooler (Supavisor, PgBouncer before 1.21, …) can hand the
        // next transaction to a server session without this client's named
        // prepared statements; client-side statement caching breaks connections →
        // disable it.
        opts = opts.statement_cache_capacity(0);
    }
    if let Some(zone) = time_zone(p) {
        opts = opts.options([("timezone", zone)]);
    }
    // Neon negotiates channel_binding via SCRAM automatically; its cold-start
    // penalty is handled by connect_timeout(), not an option here.

    // Custom CA (e.g. RDS global CA, ISRG roots) — user-supplied, never bundled.
    if let Some(ca) = p.extra_params.get("sslrootcert") {
        opts = opts.ssl_root_cert(ca);
    }
    if let Some(ca) = p.extra_params.get("sslrootcert_pem") {
        opts = opts.ssl_root_cert_from_pem(ca.as_bytes().to_vec());
    }
    if let Some(cert) = p.extra_params.get("sslcert") {
        opts = opts.ssl_client_cert(cert);
    }
    if let Some(cert) = p.extra_params.get("sslcert_pem") {
        opts = opts.ssl_client_cert_from_pem(cert.as_bytes());
    }
    if let Some(key) = p.extra_params.get("sslkey") {
        opts = opts.ssl_client_key(key);
    }
    if let Some(key) = p.extra_params.get("sslkey_pem") {
        opts = opts.ssl_client_key_from_pem(key.as_bytes());
    }
    opts
}

/// Apply MySQL per-provider tuning.
pub fn apply_mysql_tuning(
    p: &ConnectionProfile,
    mut opts: MySqlConnectOptions,
) -> MySqlConnectOptions {
    if let Some(zone) = time_zone(p) {
        opts = opts.timezone(Some(zone.to_owned()));
    }
    if resolve(p) == Provider::PlanetScale {
        // PlanetScale requires TLS with identity verification.
        opts = opts.ssl_mode(MySqlSslMode::VerifyIdentity);
    }
    if let Some(ca) = p.extra_params.get("sslrootcert") {
        opts = opts.ssl_ca(ca);
    }
    if let Some(ca) = p.extra_params.get("sslrootcert_pem") {
        opts = opts.ssl_ca_from_pem(ca.as_bytes().to_vec());
    }
    if let Some(cert) = p.extra_params.get("sslcert") {
        opts = opts.ssl_client_cert(cert);
    }
    if let Some(cert) = p.extra_params.get("sslcert_pem") {
        opts = opts.ssl_client_cert_from_pem(cert.as_bytes());
    }
    if let Some(key) = p.extra_params.get("sslkey") {
        opts = opts.ssl_client_key(key);
    }
    if let Some(key) = p.extra_params.get("sslkey_pem") {
        opts = opts.ssl_client_key_from_pem(key.as_bytes());
    }
    if resolve(p) == Provider::GcpCloudSql
        && matches!(
            p.sslmode.as_str(),
            "verify-ca" | "verify-full" | "verify-identity"
        )
        && p.extra_params.contains_key("sslrootcert_pem")
    {
        // Cloud SQL IAM authentication uses mysql_clear_password only inside the
        // CA-verified TLS tunnel assembled from the one-time lease response.
        opts = opts.enable_cleartext_plugin(true);
    }
    opts
}
