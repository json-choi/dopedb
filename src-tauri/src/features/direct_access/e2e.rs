//! Feature-gated driver for the Docker end-to-end proof of the real target adapters.
//!
//! Compiled only with the `direct-access-e2e` cargo feature (never in production
//! builds) and driven by `examples/direct_access_e2e.rs` from
//! `scripts/test-direct-provisioning.mjs`. Every command runs the same planner,
//! verifier, ownership proof, and `SqlxTargetDatabase` session the administrator
//! device uses; the control-plane receipt is replaced by the caller passing the
//! receipt fields (state, marker, identity) as arguments. Secrets arrive only through
//! environment variables and are never echoed.

use std::time::Duration;

use serde_json::{json, Value};
use sqlx::mysql::{MySqlConnectOptions, MySqlConnection};
use sqlx::postgres::{PgConnectOptions, PgConnection};
use sqlx::{AssertSqlSafe, Connection};

use super::adapters::SqlxTargetDatabase;
use super::domain::{
    AccessLevel, DirectEngine, FailureCode, Marker, PrincipalName, PrincipalState, Scope,
    ServerVersion,
};
use super::ownership::{Receipt, ServerIdentity};
use super::plan::Planner;
use super::ports::{TargetDatabasePort, TargetSession};
use super::sync::{provision, reconcile, revoke};
use super::types::{AdminCredential, PreflightWarning, Secret, TargetEndpoint};
use super::verifier::{mysql_caching_sha2_verifier, postgres_scram_verifier};
use crate::connection::pool::{mysql_ssl_mode, pg_ssl_mode};

fn field<'a>(request: &'a Value, key: &str) -> Result<&'a str, FailureCode> {
    request
        .get(key)
        .and_then(Value::as_str)
        .ok_or(FailureCode::PermissionDenied)
}

fn level(request: &Value, key: &str) -> Result<AccessLevel, FailureCode> {
    match field(request, key)? {
        "none" => Ok(AccessLevel::None),
        "read" => Ok(AccessLevel::Read),
        "write" => Ok(AccessLevel::Write),
        _ => Err(FailureCode::PermissionDenied),
    }
}

fn env(name: &str) -> Result<String, FailureCode> {
    std::env::var(name).map_err(|_| FailureCode::CredentialMissing)
}

fn engine_of(request: &Value) -> Result<DirectEngine, FailureCode> {
    match field(request, "engine")? {
        "postgres" => Ok(DirectEngine::Postgres),
        "mysql" => Ok(DirectEngine::Mysql),
        _ => Err(FailureCode::VersionUnsupported),
    }
}

fn endpoint(request: &Value, engine: DirectEngine) -> Result<TargetEndpoint, FailureCode> {
    Ok(TargetEndpoint {
        engine,
        host: field(request, "host")?.to_owned(),
        port: request
            .get("port")
            .and_then(Value::as_u64)
            .and_then(|port| u16::try_from(port).ok())
            .ok_or(FailureCode::PermissionDenied)?,
        database: field(request, "database")?.to_owned(),
        sslmode: field(request, "sslmode").unwrap_or("disable").to_owned(),
        ssh_alias: None,
    })
}

fn names(request: &Value) -> Vec<String> {
    request
        .get("scope")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn identity_of(engine: DirectEngine, value: Option<&str>) -> Option<ServerIdentity> {
    let value = value?;
    match engine {
        DirectEngine::Postgres => value.parse().ok().map(ServerIdentity::PostgresRoleOid),
        DirectEngine::Mysql => Some(ServerIdentity::MysqlServerUuid(value.to_owned())),
    }
}

fn identity_text(identity: &ServerIdentity) -> String {
    match identity {
        ServerIdentity::PostgresRoleOid(oid) => oid.to_string(),
        ServerIdentity::MysqlServerUuid(uuid) => uuid.clone(),
    }
}

fn state_of(value: &str) -> Result<PrincipalState, FailureCode> {
    Ok(match value {
        "requested" => PrincipalState::Requested,
        "applying" => PrincipalState::Applying,
        "ready" => PrincipalState::Ready,
        "failed" => PrincipalState::Failed,
        "drop_pending" => PrincipalState::DropPending,
        _ => return Err(FailureCode::PermissionDenied),
    })
}

fn receipt(request: &Value, engine: DirectEngine) -> Result<Receipt, FailureCode> {
    Ok(Receipt {
        state: state_of(field(request, "state")?)?,
        name: PrincipalName::parse(field(request, "name")?).ok_or(FailureCode::MarkerMismatch)?,
        marker: Marker::parse(field(request, "marker")?).ok_or(FailureCode::MarkerMismatch)?,
        identity: identity_of(engine, request.get("identity").and_then(Value::as_str)),
    })
}

fn verifier(engine: DirectEngine) -> Result<String, FailureCode> {
    let password = env("E2E_MEMBER_PASSWORD")?;
    match engine {
        DirectEngine::Postgres => postgres_scram_verifier(&password),
        DirectEngine::Mysql => mysql_caching_sha2_verifier(&password),
    }
    .map_err(|_| FailureCode::PermissionDenied)
}

type Session = <SqlxTargetDatabase as TargetDatabasePort>::Session;

async fn open(request: &Value, engine: DirectEngine) -> Result<Session, FailureCode> {
    let credential = AdminCredential::new(
        env("E2E_ADMIN_USER")?,
        Secret::new(env("E2E_ADMIN_PASSWORD")?),
        None,
    )
    .map_err(|_| FailureCode::CredentialMissing)?;
    SqlxTargetDatabase
        .open(&endpoint(request, engine)?, &credential)
        .await
}

async fn planner(
    session: &mut Session,
    engine: DirectEngine,
    request: &Value,
) -> Result<Planner, FailureCode> {
    let version = ServerVersion::check(engine, &session.version().await?)?;
    let scope = Scope::new(engine, names(request)).ok_or(FailureCode::PermissionDenied)?;
    Planner::new(engine, version, scope)
}

async fn preflight(
    session: &mut Session,
    engine: DirectEngine,
    request: &Value,
) -> Result<Value, FailureCode> {
    let raw = session.version().await?;
    let version = ServerVersion::check(engine, &raw)?;
    let write = request.get("write").and_then(Value::as_bool) == Some(true);
    let facts = session.preflight(write).await?;
    let chosen = names(request);
    let mut warnings = Vec::new();
    for facts in facts
        .namespaces
        .iter()
        .filter(|facts| chosen.contains(&facts.name))
    {
        if !facts.grantable {
            warnings.push(PreflightWarning::GrantorInsufficient);
        }
        if facts.public_create {
            warnings.push(PreflightWarning::PublicCreate);
        }
    }
    warnings.sort_by_key(|warning| format!("{warning:?}"));
    warnings.dedup();
    Ok(json!({
        "version": format!("{}.{}.{}", version.major, version.minor, version.patch),
        "canCreatePrincipal": facts.can_create_principal,
        "canEndSessions": facts.can_end_sessions,
        "namespaces": facts.namespaces,
        "warnings": warnings,
    }))
}

/// `sync::provision`: observe, decide, execute (rolling back a failed MySQL create),
/// re-observe, prove.
async fn create(
    session: &mut Session,
    engine: DirectEngine,
    request: &Value,
) -> Result<Value, FailureCode> {
    let planner = planner(session, engine, request).await?;
    let receipt = receipt(request, engine)?;
    let proven = provision(
        session,
        &planner,
        &receipt,
        &verifier(engine)?,
        level(request, "level")?,
    )
    .await?;
    Ok(json!({ "identity": identity_text(proven.identity()) }))
}

/// `sync::reconcile`: prove, then rotate and/or move level (same level re-grants).
async fn change(
    session: &mut Session,
    engine: DirectEngine,
    request: &Value,
) -> Result<Value, FailureCode> {
    let planner = planner(session, engine, request).await?;
    let receipt = receipt(request, engine)?;
    let rotate = if request.get("rotate").and_then(Value::as_bool) == Some(true) {
        Some(verifier(engine)?)
    } else {
        None
    };
    reconcile(
        session,
        &planner,
        &receipt,
        level(request, "from")?,
        level(request, "to")?,
        rotate.as_deref(),
    )
    .await?;
    Ok(json!({}))
}

/// `sync::revoke` with a target of none: prove, revoke, lock, end sessions when the
/// administrator account may, drop. Reports whether open sessions may persist.
async fn drop_principal(
    session: &mut Session,
    engine: DirectEngine,
    request: &Value,
) -> Result<Value, FailureCode> {
    let planner = planner(session, engine, request).await?;
    let receipt = receipt(request, engine)?;
    let effect = revoke(
        session,
        &planner,
        &receipt,
        level(request, "from")?,
        AccessLevel::None,
    )
    .await?;
    Ok(json!({ "openSessions": effect.open_sessions() }))
}

async fn observe(session: &mut Session, request: &Value) -> Result<Value, FailureCode> {
    let name = PrincipalName::parse(field(request, "name")?).ok_or(FailureCode::MarkerMismatch)?;
    let observed = session.observe(&name).await?;
    Ok(json!({
        "exists": observed.name_exists,
        "marker": observed.marker.is_some(),
        "ownedObjects": observed.owned_objects,
        "memberships": observed.unexpected_memberships,
    }))
}

/// One login as the principal; returns the SQLSTATE / error number on refusal.
enum Member {
    Postgres(PgConnection),
    Mysql(MySqlConnection),
}

fn failure_of(error: &sqlx::Error) -> Value {
    match error {
        sqlx::Error::Database(database) => {
            // MySQL reports its error number (1142, 1045, ...); PostgreSQL its SQLSTATE.
            let code = database
                .try_downcast_ref::<sqlx::mysql::MySqlDatabaseError>()
                .map(|error| error.number().to_string())
                .or_else(|| database.code().map(|code| code.into_owned()));
            json!({ "ok": false, "code": code })
        }
        _ => json!({ "ok": false, "code": "transport" }),
    }
}

async fn login(request: &Value, engine: DirectEngine) -> Result<Member, sqlx::Error> {
    let name = field(request, "name").unwrap_or_default().to_owned();
    let password = env("E2E_MEMBER_PASSWORD").unwrap_or_default();
    let endpoint = endpoint(request, engine).map_err(|_| sqlx::Error::PoolClosed)?;
    match engine {
        DirectEngine::Postgres => PgConnection::connect_with(
            &PgConnectOptions::new()
                .host(&endpoint.host)
                .port(endpoint.port)
                .database(&endpoint.database)
                .username(&name)
                .password(&password)
                .ssl_mode(pg_ssl_mode(&endpoint.sslmode).map_err(|_| sqlx::Error::PoolClosed)?),
        )
        .await
        .map(Member::Postgres),
        DirectEngine::Mysql => MySqlConnection::connect_with(
            &MySqlConnectOptions::new()
                .host(&endpoint.host)
                .port(endpoint.port)
                .database(&endpoint.database)
                .username(&name)
                .password(&password)
                .ssl_mode(mysql_ssl_mode(&endpoint.sslmode).map_err(|_| sqlx::Error::PoolClosed)?),
        )
        .await
        .map(Member::Mysql),
    }
}

async fn run_sql(member: &mut Member, sql: &str) -> Result<u64, sqlx::Error> {
    match member {
        Member::Postgres(conn) => sqlx::raw_sql(AssertSqlSafe(sql.to_owned()))
            .execute(&mut *conn)
            .await
            .map(|done| done.rows_affected()),
        Member::Mysql(conn) => sqlx::raw_sql(AssertSqlSafe(sql.to_owned()))
            .execute(&mut *conn)
            .await
            .map(|done| done.rows_affected()),
    }
}

async fn query_scalar(member: &mut Member, sql: &str) -> Result<String, sqlx::Error> {
    match member {
        Member::Postgres(conn) => {
            sqlx::query_scalar::<_, String>(AssertSqlSafe(sql.to_owned()))
                .fetch_one(&mut *conn)
                .await
        }
        Member::Mysql(conn) => {
            sqlx::query_scalar::<_, String>(AssertSqlSafe(sql.to_owned()))
                .fetch_one(&mut *conn)
                .await
        }
    }
}

/// Log in as the principal and run `sql` (a statement for `exec`, a single text
/// column for `scalar`).
async fn as_member(request: &Value, engine: DirectEngine) -> Value {
    let mut member = match login(request, engine).await {
        Ok(member) => member,
        Err(error) => return failure_of(&error),
    };
    let sql = field(request, "sql").unwrap_or("SELECT 1");
    let result = if field(request, "cmd") == Ok("scalar") {
        query_scalar(&mut member, sql)
            .await
            .map(|value| json!({ "ok": true, "value": value }))
    } else {
        run_sql(&mut member, sql)
            .await
            .map(|rows| json!({ "ok": true, "rows": rows }))
    };
    result.unwrap_or_else(|error| failure_of(&error))
}

/// Keep one session open running `sql` until the server refuses it, printing `ready`
/// after the first success. `code` says why it ended: a transport error means the
/// session was terminated, a database error means it lingers without the privilege.
async fn hold(request: &Value, engine: DirectEngine) -> Value {
    let mut member = match login(request, engine).await {
        Ok(member) => member,
        Err(error) => return failure_of(&error),
    };
    let sql = field(request, "sql").unwrap_or("SELECT 1");
    if let Err(error) = run_sql(&mut member, sql).await {
        return failure_of(&error);
    }
    println!("ready");
    for _ in 0..600 {
        if let Err(error) = run_sql(&mut member, sql).await {
            let mut ended = failure_of(&error);
            ended["ended"] = json!(true);
            ended["ok"] = json!(true);
            return ended;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    json!({ "ok": true, "ended": false })
}

/// Run one scenario command and return its JSON result.
pub async fn run(request: &str) -> Value {
    let Ok(request) = serde_json::from_str::<Value>(request) else {
        return json!({ "ok": false, "code": "bad_request" });
    };
    let Ok(engine) = engine_of(&request) else {
        return json!({ "ok": false, "code": "bad_request" });
    };
    let command = field(&request, "cmd").unwrap_or_default().to_owned();
    match command.as_str() {
        "exec" | "scalar" => return as_member(&request, engine).await,
        "hold" => return hold(&request, engine).await,
        _ => {}
    }
    let mut session = match open(&request, engine).await {
        Ok(session) => session,
        Err(code) => return json!({ "ok": false, "code": code.as_str() }),
    };
    let result = match command.as_str() {
        "preflight" => preflight(&mut session, engine, &request).await,
        "create" => create(&mut session, engine, &request).await,
        "change" => change(&mut session, engine, &request).await,
        "drop" => drop_principal(&mut session, engine, &request).await,
        "observe" => observe(&mut session, &request).await,
        _ => Err(FailureCode::PermissionDenied),
    };
    session.close().await;
    match result {
        Ok(mut value) => {
            value["ok"] = json!(true);
            value
        }
        Err(code) => json!({ "ok": false, "code": code.as_str() }),
    }
}
