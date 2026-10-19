//! Local store and credential-store adapter for direct shared databases.
//!
//! Reads cached shared templates (endpoint only), keeps the member's generated
//! password in the same credential store item family as every other member
//! credential, and records the ready principal name on the member binding. Nothing
//! here reads or writes an administrator credential.

use std::collections::HashMap;
use std::sync::Arc;

use uuid::Uuid;

use crate::connection::ssh::{self, SSH_ALIAS_PARAMETER};
use crate::error::{AppError, AppResult};
use crate::features::connections::ConnectionCredentialVault;
use crate::kernel::identity::{AccountId, ConnectionId};
use crate::model::{ConnectionProfile, Engine};
use crate::store::Store;

use super::super::domain::DirectEngine;
use super::super::ports::{DirectLocalPort, LocalTemplate, StagedPassword};
use super::super::types::DirectScope;

#[derive(Clone)]
pub(crate) struct StoreDirectLocal {
    store: Store,
    credentials: Arc<dyn ConnectionCredentialVault>,
}

impl StoreDirectLocal {
    pub(crate) fn new(store: Store, credentials: Arc<dyn ConnectionCredentialVault>) -> Self {
        Self { store, credentials }
    }
}

fn template_of(profile: &ConnectionProfile) -> AppResult<LocalTemplate> {
    let engine = match profile.engine {
        Engine::Postgres => DirectEngine::Postgres,
        Engine::Mysql => DirectEngine::Mysql,
        _ => {
            return Err(AppError::Blocked {
                reason: "direct sharing supports PostgreSQL and MySQL".into(),
            })
        }
    };
    Ok(LocalTemplate {
        engine,
        host: profile.host.clone(),
        port: profile.port,
        database: profile.database.clone(),
        sslmode: profile.sslmode.clone(),
    })
}

impl DirectLocalPort for StoreDirectLocal {
    async fn template(&self, scope: &DirectScope) -> AppResult<LocalTemplate> {
        let profile = self
            .store
            .provisioned_template(
                scope.workspace_id.into(),
                scope.account_id.as_str(),
                scope.connection_id.into(),
            )
            .await?;
        template_of(&profile)
    }

    async fn prefill(
        &self,
        connection_id: ConnectionId,
    ) -> AppResult<(LocalTemplate, Option<String>)> {
        let profile = self.store.get_connection(connection_id.into()).await?;
        let alias = profile.extra_params.get(SSH_ALIAS_PARAMETER).cloned();
        Ok((template_of(&profile)?, alias))
    }

    async fn provisioned(&self) -> AppResult<Vec<DirectScope>> {
        self.store
            .provisioned_templates()
            .await?
            .into_iter()
            .filter_map(|(workspace_id, account, profile)| {
                Some(DirectScope {
                    account_id: AccountId::new(account)?,
                    workspace_id: workspace_id.into(),
                    connection_id: profile.id.into(),
                })
            })
            .map(Ok)
            .collect()
    }

    async fn device_id(&self, scope: &DirectScope) -> AppResult<String> {
        Ok(self
            .store
            .analysis_run_device_id(scope.account_id.as_str(), scope.workspace_id.into())
            .await?
            .to_string())
    }

    fn stage_password(&self, password: &str) -> AppResult<StagedPassword> {
        let id = Uuid::new_v4();
        self.credentials.store(&id, password)?;
        Ok(StagedPassword(id))
    }

    fn discard_password(&self, staged: StagedPassword) {
        if self.credentials.delete(&staged.0).is_err() {
            tracing::warn!("member password cleanup deferred");
        }
    }

    async fn bind_password(
        &self,
        scope: &DirectScope,
        staged: StagedPassword,
        ssh_alias: Option<&str>,
    ) -> AppResult<()> {
        let mut profile = self
            .store
            .provisioned_template(
                scope.workspace_id.into(),
                scope.account_id.as_str(),
                scope.connection_id.into(),
            )
            .await?;
        let mut extra_params = HashMap::new();
        if let Some(alias) = ssh_alias.map(str::trim).filter(|alias| !alias.is_empty()) {
            extra_params.insert(SSH_ALIAS_PARAMETER.to_owned(), alias.to_owned());
        }
        profile.extra_params = extra_params.clone();
        ssh::validate_profile(&profile)?;
        let previous = self
            .store
            .bind_provisioned_secret(
                scope.connection_id.into(),
                scope.account_id.as_str(),
                &extra_params,
                &staged.0.to_string(),
            )
            .await?;
        if let Some(previous) = previous.and_then(|id| Uuid::parse_str(&id).ok()) {
            if self.credentials.delete(&previous).is_err() {
                let _ = self.store.defer_credential_delete(previous).await;
            }
        }
        Ok(())
    }

    async fn apply_principal(
        &self,
        scope: &DirectScope,
        principal_name: Option<&str>,
    ) -> AppResult<()> {
        self.store
            .apply_provisioned_principal(
                scope.connection_id.into(),
                scope.account_id.as_str(),
                principal_name,
            )
            .await
    }
}
