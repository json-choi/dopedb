//! Direct shared database use cases: preflight, register, member request, status.
//!
//! Desktop is the only place a database administrator credential is used. It probes
//! the target, registers the shared record (endpoint, scope, write ceiling; no
//! secrets) with the control plane, keeps the administrator credential in this
//! device's credential store, and lets each member upload only a public verifier of
//! a password that never leaves their device. Applying work lives in `sync`, and the
//! revocation protocol in `revocation`.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::Mutex;

use dopedb_protocol::{DirectLevel, DirectProvisioningState, DirectVerifierRequest};

use super::domain::{DirectEngine, FailureCode, Marker, PrincipalName, Scope, ServerVersion};
use super::plan::{PlannedStatement, Planner};
use super::ports::{
    AdminCredentialVault, DirectControlPlanePort, DirectLocalPort, TargetDatabasePort,
    TargetSession,
};
use super::types::{
    sslmode_allowed, AdminCredential, CredentialInput, DirectScope, DirectStatus, EndpointInput,
    NamespaceFacts, PreflightReport, PreflightWarning, TargetEndpoint,
};
use super::verifier::{
    generate_member_password, mysql_caching_sha2_verifier, postgres_scram_verifier,
};
use crate::error::{AppError, AppResult};
use crate::kernel::identity::{AccountId, ConnectionId, WorkspaceId};

#[derive(Clone)]
pub(crate) struct DirectAccessUseCases<V, T, C, L> {
    pub(super) vault: V,
    pub(super) target: T,
    pub(super) control: C,
    pub(super) local: L,
    /// One administrator action at a time per device: the background worker and a
    /// synchronous revocation never touch the same database concurrently.
    pub(super) device_lock: Arc<Mutex<()>>,
}

pub(crate) fn require_signed_in(signed_in: &[AccountId], account_id: &AccountId) -> AppResult<()> {
    crate::features::workspace_admin::domain::require_signed_in_account(signed_in, account_id)
}

pub(super) fn blocked(code: FailureCode) -> AppError {
    AppError::Blocked {
        reason: format!("direct shared database setup stopped: {code}"),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PreflightInput {
    pub(crate) account_id: AccountId,
    pub(crate) endpoint: EndpointInput,
    pub(crate) credential: CredentialInput,
    /// Namespaces chosen so far; when present the report includes the exact plan.
    pub(crate) scope: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) write_ceiling: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RegisterInput {
    pub(crate) account_id: AccountId,
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) name: String,
    pub(crate) env: Option<crate::kernel::environment::EnvironmentKind>,
    pub(crate) schema_group: Option<String>,
    pub(crate) endpoint: EndpointInput,
    pub(crate) credential: CredentialInput,
    pub(crate) scope: Vec<String>,
    #[serde(default)]
    pub(crate) write_ceiling: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegisteredDatabase {
    pub(crate) connection_id: ConnectionId,
}

/// The endpoint of one of the caller's saved connections, for the add flow.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EndpointPrefill {
    pub(crate) engine: DirectEngine,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) database: String,
    pub(crate) sslmode: String,
    pub(crate) ssh_alias: Option<String>,
}

impl<V, T, C, L> DirectAccessUseCases<V, T, C, L>
where
    V: AdminCredentialVault,
    T: TargetDatabasePort,
    C: DirectControlPlanePort,
    L: DirectLocalPort,
{
    pub(crate) fn new(vault: V, target: T, control: C, local: L) -> Self {
        Self {
            vault,
            target,
            control,
            local,
            device_lock: Arc::new(Mutex::new(())),
        }
    }

    pub(super) async fn endpoint_for(
        &self,
        scope: &DirectScope,
        credential: &AdminCredential,
    ) -> AppResult<TargetEndpoint> {
        let template = self.local.template(scope).await?;
        Ok(TargetEndpoint {
            engine: template.engine,
            host: template.host,
            port: template.port,
            database: template.database,
            sslmode: template.sslmode,
            ssh_alias: credential.ssh_alias.clone(),
        })
    }

    /// Copy only the endpoint of an existing saved connection. Credentials are
    /// never read; the SSH alias is the connection's own device-local alias.
    pub(crate) async fn prefill(&self, connection_id: ConnectionId) -> AppResult<EndpointPrefill> {
        let (template, ssh_alias) = self.local.prefill(connection_id).await?;
        let sslmode = if sslmode_allowed(template.engine, &template.sslmode) {
            template.sslmode
        } else {
            match template.engine {
                DirectEngine::Postgres => "verify-full".into(),
                DirectEngine::Mysql => "VERIFY_IDENTITY".into(),
            }
        };
        Ok(EndpointPrefill {
            engine: template.engine,
            host: template.host,
            port: template.port,
            database: template.database,
            sslmode,
            ssh_alias,
        })
    }

    pub(crate) async fn preflight(
        &self,
        signed_in: &[AccountId],
        input: PreflightInput,
    ) -> AppResult<PreflightReport> {
        require_signed_in(signed_in, &input.account_id)?;
        let endpoint = input.endpoint.into_endpoint()?;
        let credential = AdminCredential::new(
            input.credential.username,
            input.credential.password,
            endpoint.ssh_alias.clone(),
        )?;
        let scope = input
            .scope
            .map(|names| {
                Scope::new(endpoint.engine, names)
                    .ok_or_else(|| AppError::Config("the sharing scope is invalid".into()))
            })
            .transpose()?;
        Ok(self
            .probe(&endpoint, &credential, scope.as_ref(), input.write_ceiling)
            .await)
    }

    /// Read what the administrator may do on the target. Probe failures are data.
    pub(super) async fn probe(
        &self,
        endpoint: &TargetEndpoint,
        credential: &AdminCredential,
        scope: Option<&Scope>,
        write_ceiling: bool,
    ) -> PreflightReport {
        let mut report = PreflightReport {
            engine: endpoint.engine,
            server_version: None,
            version_supported: false,
            can_create_principal: false,
            can_end_sessions: false,
            namespaces: Vec::new(),
            warnings: Vec::new(),
            failure_code: None,
            plan_read: Vec::new(),
            plan_write: Vec::new(),
        };
        let mut session = match self.target.open(endpoint, credential).await {
            Ok(session) => session,
            Err(code) => {
                report.failure_code = Some(code);
                return report;
            }
        };
        let outcome = self
            .probe_session(
                &mut session,
                endpoint.engine,
                scope,
                write_ceiling,
                &mut report,
            )
            .await;
        session.close().await;
        if let Err(code) = outcome {
            report.failure_code = Some(code);
        }
        report
    }

    async fn probe_session(
        &self,
        session: &mut T::Session,
        engine: DirectEngine,
        scope: Option<&Scope>,
        write_ceiling: bool,
        report: &mut PreflightReport,
    ) -> Result<(), FailureCode> {
        let version = ServerVersion::check(engine, &session.version().await?)?;
        report.server_version = Some(format!(
            "{}.{}.{}",
            version.major, version.minor, version.patch
        ));
        report.version_supported = true;
        let facts = session.preflight(write_ceiling).await?;
        report.can_create_principal = facts.can_create_principal;
        report.can_end_sessions = facts.can_end_sessions;
        report.namespaces = facts.namespaces;
        if let Some(scope) = scope {
            let chosen: Vec<&NamespaceFacts> = scope
                .names()
                .iter()
                .filter_map(|name| report.namespaces.iter().find(|facts| &facts.name == name))
                .collect();
            if chosen.len() != scope.names().len() {
                return Err(FailureCode::GrantorInsufficient);
            }
            if chosen.iter().any(|facts| !facts.grantable) {
                report.warnings.push(PreflightWarning::GrantorInsufficient);
            }
            if chosen.iter().any(|facts| facts.public_create) {
                report.warnings.push(PreflightWarning::PublicCreate);
            }
            let planner = Planner::new(engine, version, scope.clone())?;
            report.plan_read = plan_preview(&planner, engine, super::domain::AccessLevel::Read)?;
            if write_ceiling {
                report.plan_write =
                    plan_preview(&planner, engine, super::domain::AccessLevel::Write)?;
            }
        }
        Ok(())
    }

    /// Register a direct shared database. The target is probed again here, so a
    /// stale screen can never register a scope the administrator cannot grant.
    pub(crate) async fn register(
        &self,
        signed_in: &[AccountId],
        input: RegisterInput,
    ) -> AppResult<RegisteredDatabase> {
        require_signed_in(signed_in, &input.account_id)?;
        let name = input.name.trim().to_owned();
        if name.is_empty() || name.len() > 120 || name.chars().any(char::is_control) {
            return Err(AppError::Config(
                "the shared database name is invalid".into(),
            ));
        }
        let endpoint = input.endpoint.into_endpoint()?;
        let credential = AdminCredential::new(
            input.credential.username,
            input.credential.password,
            endpoint.ssh_alias.clone(),
        )?;
        let scope = Scope::new(endpoint.engine, input.scope)
            .ok_or_else(|| AppError::Config("the sharing scope is invalid".into()))?;
        let report = self
            .probe(&endpoint, &credential, Some(&scope), input.write_ceiling)
            .await;
        if let Some(code) = report.failure_code {
            return Err(blocked(code));
        }
        if !report.can_create_principal {
            return Err(blocked(FailureCode::PermissionDenied));
        }
        if report
            .warnings
            .contains(&PreflightWarning::GrantorInsufficient)
        {
            return Err(blocked(FailureCode::GrantorInsufficient));
        }
        let mut body = json!({
            "name": name,
            "engine": match endpoint.engine {
                DirectEngine::Postgres => "postgres",
                DirectEngine::Mysql => "mysql",
            },
            "host": endpoint.host,
            "port": endpoint.port,
            "database": endpoint.database,
            "sslmode": endpoint.sslmode,
            "scope": scope.names(),
            "writeCeiling": input.write_ceiling,
        });
        if let Some(env) = input.env {
            body["env"] = json!(env.wire_token());
        }
        if let Some(group) = input.schema_group.filter(|value| !value.trim().is_empty()) {
            body["schemaGroup"] = json!(group.trim());
        }
        let (connection_id, revision) = self
            .control
            .register(&input.account_id, input.workspace_id, body)
            .await?;
        let direct = DirectScope {
            account_id: input.account_id.clone(),
            workspace_id: input.workspace_id,
            connection_id,
        };
        if let Err(error) = self.vault.store(&direct, &credential) {
            // Without the credential no device can apply anything; undo the record.
            let rollback = json!({
                "kind": "deleteSharedConnection",
                "workspaceId": input.workspace_id,
                "connectionId": connection_id,
                "expectedRevision": revision,
            });
            if self
                .control
                .mutate(&input.account_id, rollback)
                .await
                .is_err()
            {
                tracing::warn!("direct shared database registration rollback deferred");
            }
            return Err(error);
        }
        Ok(RegisteredDatabase { connection_id })
    }

    /// First connect of a member: generate the password on this device, keep it in
    /// the credential store, and upload only its public verifier. Idempotent while a
    /// principal is requested, applying, or ready.
    pub(crate) async fn member_request(
        &self,
        signed_in: &[AccountId],
        scope: DirectScope,
        ssh_alias: Option<String>,
    ) -> AppResult<DirectStatus> {
        require_signed_in(signed_in, &scope.account_id)?;
        let current = self.control.principal_status(&scope).await?;
        if matches!(
            current.state,
            DirectProvisioningState::Requested
                | DirectProvisioningState::Applying
                | DirectProvisioningState::Ready
        ) {
            return self.status_inner(&scope, current).await;
        }
        let template = self.local.template(&scope).await?;
        let password = generate_member_password()
            .map_err(|_| AppError::Config("the system random source is unavailable".into()))?;
        let request = match template.engine {
            DirectEngine::Postgres => DirectVerifierRequest {
                verifier_kind: dopedb_protocol::DirectVerifierKind::ScramSha256,
                verifier: postgres_scram_verifier(&password)
                    .map_err(|_| AppError::Config("the member password is invalid".into()))?,
            },
            DirectEngine::Mysql => DirectVerifierRequest {
                verifier_kind: dopedb_protocol::DirectVerifierKind::CachingSha2,
                verifier: mysql_caching_sha2_verifier(&password)
                    .map_err(|_| AppError::Config("the member password is invalid".into()))?,
            },
        };
        let staged = self.local.stage_password(&password)?;
        let status = match self.control.put_verifier(&scope, &request).await {
            Ok(status) => status,
            Err(error) => {
                self.local.discard_password(staged);
                return Err(error);
            }
        };
        if let Err(error) = self
            .local
            .bind_password(&scope, staged, ssh_alias.as_deref())
            .await
        {
            self.local.discard_password(staged);
            return Err(error);
        }
        self.status_inner(&scope, status).await
    }

    pub(crate) async fn status(
        &self,
        signed_in: &[AccountId],
        scope: DirectScope,
    ) -> AppResult<DirectStatus> {
        require_signed_in(signed_in, &scope.account_id)?;
        let status = self.control.principal_status(&scope).await?;
        self.status_inner(&scope, status).await
    }

    async fn status_inner(
        &self,
        scope: &DirectScope,
        provisioning: dopedb_protocol::DirectProvisioningStatus,
    ) -> AppResult<DirectStatus> {
        // Only a ready principal with a privilege level opens the connection.
        let ready_name = (provisioning.state == DirectProvisioningState::Ready
            && provisioning.level != DirectLevel::None)
            .then_some(provisioning.principal_name.as_deref())
            .flatten();
        self.local.apply_principal(scope, ready_name).await?;
        Ok(DirectStatus {
            provisioning,
            admin_credential_on_device: self.vault.contains(scope).unwrap_or(false),
        })
    }

    /// Remove this device's administrator credential. The database keeps working for
    /// members; only this device stops applying work.
    pub(crate) fn forget_admin_credential(
        &self,
        signed_in: &[AccountId],
        scope: &DirectScope,
    ) -> AppResult<()> {
        require_signed_in(signed_in, &scope.account_id)?;
        self.vault.delete(scope)
    }
}

/// Display text of the create plan at `level`: server-quoted identifiers are shown
/// quoted, the verifier and marker are placeholders.
fn plan_preview(
    planner: &Planner,
    engine: DirectEngine,
    level: super::domain::AccessLevel,
) -> Result<Vec<String>, FailureCode> {
    use dopedb_protocol::DatabaseEngine;
    let name =
        PrincipalName::parse("dopedb_00000000000000000000").ok_or(FailureCode::PermissionDenied)?;
    let marker = Marker::parse("preview-marker-0000").ok_or(FailureCode::PermissionDenied)?;
    let password = generate_member_password().map_err(|_| FailureCode::PermissionDenied)?;
    let verifier = match engine {
        DirectEngine::Postgres => postgres_scram_verifier(&password),
        DirectEngine::Mysql => mysql_caching_sha2_verifier(&password),
    }
    .map_err(|_| FailureCode::PermissionDenied)?;
    let statements = planner.create(&name, &marker, &verifier, level)?;
    Ok(statements
        .iter()
        .filter_map(|statement: &PlannedStatement| {
            let quoted_schema = statement.schema.as_deref().map(|schema| {
                crate::ddl::common::quote_identifier(DatabaseEngine::Postgres, schema)
            });
            statement
                .render(quoted_schema.as_deref(), Some("\"<database>\""))
                .map(|sql| sql.replace(&verifier, "<verifier>"))
        })
        .collect())
}
