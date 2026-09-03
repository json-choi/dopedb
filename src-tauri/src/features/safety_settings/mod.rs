//! Scope-aware per-connection safety settings.

mod application;
mod ports;

use uuid::Uuid;

use crate::connection::ConnectionManager;
use crate::error::AppResult;
use crate::model::{SafetySettings, WorkspaceCredentialMode};
use crate::store::Store;

use application::SafetyUseCases;
use ports::SafetySettingsPort;

#[derive(Clone)]
struct SafetyPlatformAdapter {
    store: Store,
    connections: ConnectionManager,
}

type ComposedSafetyApplication = SafetyUseCases<SafetyPlatformAdapter>;

#[derive(Clone)]
pub(crate) struct SafetySettingsFeature {
    application: ComposedSafetyApplication,
}

impl SafetySettingsFeature {
    pub(crate) async fn get(&self, connection_id: Uuid) -> AppResult<SafetySettings> {
        self.application.get(connection_id).await
    }

    pub(crate) async fn update(
        &self,
        connection_id: Uuid,
        settings: SafetySettings,
    ) -> AppResult<bool> {
        self.application.update(connection_id, settings).await
    }
}

pub(crate) fn compose(store: Store, connections: ConnectionManager) -> SafetySettingsFeature {
    SafetySettingsFeature {
        application: SafetyUseCases::new(SafetyPlatformAdapter::new(store, connections)),
    }
}

impl SafetyPlatformAdapter {
    fn new(store: Store, connections: ConnectionManager) -> Self {
        Self { store, connections }
    }

    pub(crate) async fn get(&self, connection_id: Uuid) -> AppResult<SafetySettings> {
        self.store.get_safety(connection_id).await
    }

    /// Normalize untrusted UI limits and persist them under the active scope guard.
    /// Shared write policy is projected by the server rather than widened by this
    /// member-local settings surface. A limits-only edit must not drain a live
    /// connection; an actual write-gate change retires the cached pool afterward.
    pub(crate) async fn update(
        &self,
        connection_id: Uuid,
        mut settings: SafetySettings,
    ) -> AppResult<bool> {
        let operation_scope = self.connections.begin_operation_scope().await;
        let pin = operation_scope
            .pin_connection_for_view(connection_id)
            .await?;
        let profile = &pin.profile;
        let update_local_write_ceiling = profile.credential_mode == WorkspaceCredentialMode::Local
            && profile.workspace_access == crate::model::WorkspaceConnectionAccess::Local;
        let local_mutations_supported = !matches!(
            profile.engine,
            crate::model::Engine::Bigquery | crate::model::Engine::Mongodb
        );
        if update_local_write_ceiling && !local_mutations_supported {
            settings.allow_writes = false;
        } else if !update_local_write_ceiling {
            settings.allow_writes = settings.allow_writes
                && profile.credential_mode == WorkspaceCredentialMode::Managed
                && profile.allow_writes
                && profile.workspace_access.can_write();
        } else if !profile.workspace_access.can_write() {
            settings.allow_writes = false;
        }
        settings.allow_schema_changes = settings.allow_schema_changes
            && settings.allow_writes
            && if profile.credential_mode == WorkspaceCredentialMode::Managed {
                profile.workspace_access.can_manage()
                    && matches!(
                        profile.provider,
                        crate::model::Provider::Neon | crate::model::Provider::GcpCloudSql
                    )
                    && profile.engine == crate::model::Engine::Postgres
            } else {
                update_local_write_ceiling && local_mutations_supported
            };
        let expected_connection_revision = pin.connection_revision;
        settings.max_rows = settings.max_rows.clamp(1, 100_000);
        settings.exec_preview_row_limit = settings.exec_preview_row_limit.clamp(0, 1_000_000);
        let write_policy_changed = self
            .store
            .set_safety(
                connection_id,
                expected_connection_revision,
                update_local_write_ceiling,
                &settings,
            )
            .await?;
        if write_policy_changed {
            operation_scope.retire_connection(connection_id).await;
        }
        Ok(write_policy_changed)
    }
}

impl SafetySettingsPort for SafetyPlatformAdapter {
    fn get(
        &self,
        connection_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<SafetySettings>> + Send {
        SafetyPlatformAdapter::get(self, connection_id)
    }

    fn update(
        &self,
        connection_id: Uuid,
        settings: SafetySettings,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send {
        SafetyPlatformAdapter::update(self, connection_id, settings)
    }
}
