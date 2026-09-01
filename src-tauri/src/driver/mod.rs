//! Driver registry and runtime dispatch. The registry decides which protocol driver is
//! compatible and preferred; concrete adapters own connection mechanics. Downloadable
//! packs use the same metadata contract as bundled drivers, without pretending Rust
//! crates can be hot-loaded like JDBC jars.

use crate::connection::pool::connect_sqlx;
use crate::connection::providers;
use crate::connection::{ConnectionAccess, Live};
use crate::error::{AppError, AppResult};
use crate::features::connections::{
    DriverCapability, DriverDescriptor, DriverInstallMode, DriverInstallState,
};
use crate::model::{ConnectionProfile, Engine, Provider};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeAdapter {
    Postgres,
    Mysql,
    Sqlite,
    Mongodb,
    Bigquery,
}

struct DriverDefinition {
    id: &'static str,
    name: &'static str,
    engine: Engine,
    version: &'static str,
    install_mode: DriverInstallMode,
    install_state: DriverInstallState,
    supported_providers: &'static [Provider],
    capabilities: &'static [DriverCapability],
    recommended: bool,
    adapter: Option<RuntimeAdapter>,
}

const SQL_CAPABILITIES: &[DriverCapability] = &[
    DriverCapability::Sql,
    DriverCapability::Transactions,
    DriverCapability::Introspection,
    DriverCapability::SchemaDiff,
    DriverCapability::Monitoring,
];

const DEFINITIONS: &[DriverDefinition] = &[
    DriverDefinition {
        id: "sqlx-postgres",
        name: "SQLx PostgreSQL",
        engine: Engine::Postgres,
        version: "0.8",
        install_mode: DriverInstallMode::Bundled,
        install_state: DriverInstallState::Installed,
        supported_providers: &[
            Provider::Generic,
            Provider::Neon,
            Provider::PlanetScale,
            Provider::GcpCloudSql,
        ],
        capabilities: SQL_CAPABILITIES,
        recommended: true,
        adapter: Some(RuntimeAdapter::Postgres),
    },
    DriverDefinition {
        id: "sqlx-mysql",
        name: "SQLx MySQL / MariaDB",
        engine: Engine::Mysql,
        version: "0.8",
        install_mode: DriverInstallMode::Bundled,
        install_state: DriverInstallState::Installed,
        supported_providers: &[
            Provider::Generic,
            Provider::PlanetScale,
            Provider::GcpCloudSql,
        ],
        capabilities: SQL_CAPABILITIES,
        recommended: true,
        adapter: Some(RuntimeAdapter::Mysql),
    },
    DriverDefinition {
        id: "sqlx-sqlite",
        name: "SQLx SQLite",
        engine: Engine::Sqlite,
        version: "0.8",
        install_mode: DriverInstallMode::Bundled,
        install_state: DriverInstallState::Installed,
        supported_providers: &[Provider::Generic],
        capabilities: SQL_CAPABILITIES,
        recommended: true,
        adapter: Some(RuntimeAdapter::Sqlite),
    },
    DriverDefinition {
        id: "mongodb-rust",
        name: "MongoDB Rust Driver",
        engine: Engine::Mongodb,
        version: "3.2",
        // Statically linked like the sqlx drivers — same Bundled pattern.
        install_mode: DriverInstallMode::Bundled,
        install_state: DriverInstallState::Installed,
        supported_providers: &[Provider::Generic],
        // Read-only document surface. Sql/Transactions/SchemaDiff stay absent on
        // purpose: their omission is what hides SQL-only features in the UI/CLI.
        capabilities: &[
            DriverCapability::DocumentQuery,
            DriverCapability::Collections,
            DriverCapability::Introspection,
        ],
        recommended: true,
        adapter: Some(RuntimeAdapter::Mongodb),
    },
    DriverDefinition {
        id: "google-bq-cli",
        name: "Google BigQuery CLI",
        engine: Engine::Bigquery,
        version: ">=2.0.29",
        // Reuse a verified system SDK when present; otherwise DopeDB prepares one
        // pinned official Google archive in app-owned local data on first sign-in.
        install_mode: DriverInstallMode::Managed,
        // `descriptor` replaces this with a live verified-path presence probe.
        install_state: DriverInstallState::Available,
        supported_providers: &[Provider::Generic],
        capabilities: &[DriverCapability::Sql, DriverCapability::Introspection],
        recommended: true,
        adapter: Some(RuntimeAdapter::Bigquery),
    },
];

impl DriverDefinition {
    fn descriptor(&self) -> DriverDescriptor {
        let install_state = if self.engine == Engine::Bigquery {
            if crate::bigquery::is_cli_available() {
                DriverInstallState::Installed
            } else {
                DriverInstallState::Available
            }
        } else {
            self.install_state
        };
        DriverDescriptor {
            id: self.id.to_string(),
            name: self.name.to_string(),
            engine: self.engine,
            version: self.version.to_string(),
            install_mode: self.install_mode,
            install_state,
            supported_providers: self.supported_providers.to_vec(),
            capabilities: self.capabilities.to_vec(),
            recommended: self.recommended,
        }
    }

    fn supports(&self, engine: Engine, provider: Provider) -> bool {
        self.engine == engine && self.supported_providers.contains(&provider)
    }
}

/// All known drivers in preference order. Bundled and managed packs share this shape.
pub fn list() -> Vec<DriverDescriptor> {
    DEFINITIONS
        .iter()
        .map(DriverDefinition::descriptor)
        .collect()
}

fn find(id: &str) -> AppResult<&'static DriverDefinition> {
    DEFINITIONS
        .iter()
        .find(|driver| driver.id == id)
        .ok_or_else(|| AppError::Config(format!("unknown database driver {id:?}")))
}

fn resolve(profile: &ConnectionProfile) -> AppResult<&'static DriverDefinition> {
    providers::validate_connection_options(profile)?;
    crate::connection::ssh::validate_profile(profile)?;
    let provider = providers::resolve(profile);
    let selected = match profile.driver_id.as_deref() {
        Some(id) => find(id)?,
        None => DEFINITIONS
            .iter()
            .find(|driver| driver.recommended && driver.supports(profile.engine, provider))
            .ok_or_else(|| {
                AppError::Config(format!(
                    "no installed driver supports {:?} on {:?}",
                    profile.engine, provider
                ))
            })?,
    };

    if !selected.supports(profile.engine, provider) {
        return Err(AppError::Config(format!(
            "driver {:?} does not support {:?} on {:?}",
            selected.id, profile.engine, provider
        )));
    }
    match selected.descriptor().install_state {
        DriverInstallState::Installed => {}
        DriverInstallState::Available => {
            return Err(AppError::Config(format!(
                "driver {:?} must be installed before connecting",
                selected.id
            )))
        }
        DriverInstallState::Planned => {
            return Err(AppError::Config(format!(
                "driver {:?} is planned but not available in this build",
                selected.id
            )))
        }
    }
    if selected.adapter.is_none() {
        return Err(AppError::Config(format!(
            "installed driver {:?} has no runtime adapter in this build",
            selected.id
        )));
    }
    Ok(selected)
}

/// Validate the selected or automatically recommended driver without opening a socket.
pub fn validate(profile: &ConnectionProfile) -> AppResult<DriverDescriptor> {
    Ok(resolve(profile)?.descriptor())
}

/// Ensure a driver is installed. Bundled drivers are already ready; managed packs will
/// route through the verified pack installer once a signed pack is added to the catalog.
pub fn install(id: &str) -> AppResult<DriverDescriptor> {
    let driver = find(id)?;
    if driver.install_state == DriverInstallState::Planned {
        return Err(AppError::Config(format!(
            "driver {:?} is planned but not available in this build",
            driver.id
        )));
    }
    match driver.install_mode {
        DriverInstallMode::Bundled => Ok(driver.descriptor()),
        DriverInstallMode::Managed if driver.descriptor().install_state == DriverInstallState::Installed => {
            Ok(driver.descriptor())
        }
        DriverInstallMode::Managed => Err(AppError::Config(format!(
            "managed driver pack {:?} has not been prepared",
            driver.id
        ))),
        DriverInstallMode::System => Err(AppError::Config(
            "install Google Cloud CLI with the BigQuery `bq` component outside DopeDB, then restart the app"
                .into(),
        )),
    }
}

/// Resolve the optimal compatible adapter, then open only the typed capability requested.
/// [`ConnectionAccess::Read`] must never construct a SQL write pool.
pub async fn connect(
    profile: &ConnectionProfile,
    secret: &str,
    access: ConnectionAccess,
    bigquery_auth_scope: Option<&crate::bigquery::BigQueryAuthScope>,
) -> AppResult<Live> {
    let driver = resolve(profile)?;
    let adapter = driver.adapter.ok_or_else(|| {
        AppError::Config(format!(
            "driver {:?} has no runtime adapter in this build",
            driver.id
        ))
    })?;
    Ok(match adapter {
        RuntimeAdapter::Postgres => {
            Live::Sql(connect_sqlx(Engine::Postgres, profile, secret, access.is_mutation()).await?)
        }
        RuntimeAdapter::Mysql => {
            Live::Sql(connect_sqlx(Engine::Mysql, profile, secret, access.is_mutation()).await?)
        }
        RuntimeAdapter::Sqlite => {
            Live::Sql(connect_sqlx(Engine::Sqlite, profile, secret, access.is_mutation()).await?)
        }
        RuntimeAdapter::Mongodb => Live::Mongo(crate::mongo::connect(profile, secret).await?),
        RuntimeAdapter::Bigquery => {
            if access.is_mutation() {
                return Err(AppError::Blocked {
                    reason: "BigQuery connections are read-only in DopeDB".into(),
                });
            }
            let auth_scope = bigquery_auth_scope.ok_or_else(|| AppError::Blocked {
                reason: "BigQuery authentication is not pinned to the active Workspace member"
                    .into(),
            })?;
            Live::Sql(crate::connection::LiveConnection::bigquery(
                crate::bigquery::connect(profile, auth_scope).await?,
            ))
        }
    })
}
