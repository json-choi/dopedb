//! Connection use cases.
//!
//! Validation and mutation ordering live here. Concrete SQLite, keychain, driver,
//! pool, and Tauri details remain behind ports.

use std::sync::Arc;

use uuid::Uuid;
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};
use crate::kernel::identity::ConnectionId;
use crate::kernel::TerminalAuthority;
use crate::model::{ConnectionProfile, Engine, WorkspaceConnectionAccess, WorkspaceCredentialMode};

use super::credential_endpoint::same_credential_endpoint;
use super::domain::{
    normalize_schema_group, resolve_cli_name, validate_schema_group_engine, AgentConnectionSummary,
    CliConnectionResolutionError, DriverDescriptor, LocalDatabaseListener, LOCAL_LISTENER_TARGETS,
    MAX_CONNECTION_CREDENTIAL_BYTES,
};
use super::ports::{
    AdHocConnectionPort, AuthorizedConnectionPort, ConnectionCredentialVault,
    ConnectionMutationPort, ConnectionPermission, ConnectionRepositoryPort, ConnectionRuntimePort,
    DriverRegistryPort, LocalListenerProbePort, ProfileMutationPort, ScopeMutationPort,
};
use super::probe::{ConnectionProbeRefusal, ConnectionTestReceipt, DatabaseDiscoveryReceipt};

pub(crate) struct ConnectionUpsertRequest {
    pub(crate) profile: ConnectionProfile,
    pub(crate) password: Option<Zeroizing<String>>,
    /// Remove the saved credential when no replacement password is supplied.
    pub(crate) clear_password: bool,
}

pub(crate) struct ConnectionProfileTestRequest {
    pub(crate) profile: ConnectionProfile,
    pub(crate) password: Option<Zeroizing<String>>,
}

/// The saved credential an unsaved draft may use for one probe.
enum SavedCredential {
    /// The saved secret of the same stored endpoint.
    Reuse(Zeroizing<String>),
    /// No saved credential participates: none is stored, the draft opted out, or
    /// the profile authenticates through the socket or trust.
    Empty,
    /// The draft moved to another endpoint; the saved secret is withheld.
    EndpointChanged,
}

pub(crate) struct ConnectionUseCases<R, A, D, T, V, P>
where
    V: ConnectionCredentialVault + ?Sized,
{
    repository: R,
    authority: A,
    drivers: D,
    tester: T,
    credentials: Arc<V>,
    local_listeners: P,
}

impl<R, A, D, T, V, P> Clone for ConnectionUseCases<R, A, D, T, V, P>
where
    R: Clone,
    A: Clone,
    D: Clone,
    T: Clone,
    P: Clone,
    V: ConnectionCredentialVault + ?Sized,
{
    fn clone(&self) -> Self {
        Self {
            repository: self.repository.clone(),
            authority: self.authority.clone(),
            drivers: self.drivers.clone(),
            tester: self.tester.clone(),
            credentials: Arc::clone(&self.credentials),
            local_listeners: self.local_listeners.clone(),
        }
    }
}

impl<R, A, D, T, V, P> ConnectionUseCases<R, A, D, T, V, P>
where
    R: ConnectionRepositoryPort,
    A: ConnectionRuntimePort,
    D: DriverRegistryPort,
    T: AdHocConnectionPort,
    V: ConnectionCredentialVault + ?Sized,
    P: LocalListenerProbePort,
{
    pub(crate) fn new(
        repository: R,
        authority: A,
        drivers: D,
        tester: T,
        credentials: Arc<V>,
        local_listeners: P,
    ) -> Self {
        Self {
            repository,
            authority,
            drivers,
            tester,
            credentials,
            local_listeners,
        }
    }

    /// Suggest database servers already listening on this machine so the first
    /// connection needs fewer remembered values.
    ///
    /// Probes only the closed `LOCAL_LISTENER_TARGETS` allowlist on loopback,
    /// sends no credential, and reads no client configuration. The result is a
    /// suggestion: nothing is saved, nothing is connected, and the caller still
    /// supplies the account and database.
    pub(crate) async fn discover_local_listeners(&self) -> Vec<LocalDatabaseListener> {
        futures::future::join_all(
            LOCAL_LISTENER_TARGETS
                .iter()
                .copied()
                .map(|target| self.local_listeners.probe(target)),
        )
        .await
        .into_iter()
        .flatten()
        .collect()
    }

    pub(crate) fn list_drivers(&self) -> Vec<DriverDescriptor> {
        self.drivers.list()
    }

    pub(crate) fn install_driver(&self, id: &str) -> AppResult<DriverDescriptor> {
        self.drivers.install(id)
    }

    pub(crate) async fn list_profiles(&self) -> AppResult<Vec<ConnectionProfile>> {
        self.repository.list().await
    }

    /// Persist one local connection and atomically rotate its credential pointer.
    pub(crate) async fn upsert(
        &self,
        request: ConnectionUpsertRequest,
    ) -> AppResult<ConnectionProfile> {
        let ConnectionUpsertRequest {
            mut profile,
            password,
            clear_password,
        } = request;
        self.retry_deferred_credential_deletes().await;
        if profile.workspace_access != WorkspaceConnectionAccess::Local {
            return Err(AppError::Blocked {
                reason:
                    "shared templates are edited by workspace editors; bind credentials separately"
                        .into(),
            });
        }
        profile.schema_group = normalize_schema_group(profile.schema_group);
        let uses_cli_authentication = profile.engine == Engine::Bigquery
            || (profile.engine == Engine::Sqlite
                && profile.provider == crate::model::Provider::CloudflareD1);
        if uses_cli_authentication {
            profile.secret_ref = None;
        }
        self.drivers.validate(&profile)?;

        let id = ConnectionId::from(profile.id);
        // Hold a shared scope guard while validating and persisting so unrelated
        // catalog reads continue but workspace/account switches remain fenced.
        // Existing profiles publish their new generation by detaching only that
        // connection's pools; generation checks reject a racing old pin.
        let mut profile_mutation = Some(self.authority.begin_profile_mutation(id).await);
        self.repository.ensure_write_scope(id).await?;
        let connections = self.repository.list().await?;
        let stored = connections
            .iter()
            .find(|connection| connection.id == profile.id);
        let existing = stored.is_some();
        // `Settings → Safety` is the single owner of the write ceiling. Neither the
        // editor draft nor a pasted URL may change it, and a stale draft must not
        // revert a newer Safety decision. A new profile starts without writes.
        profile.allow_writes = stored.is_some_and(|connection| connection.allow_writes);
        validate_schema_group_engine(&profile, &connections)?;
        let existing_secret_id = stored
            .and_then(|connection| connection.secret_ref.as_deref())
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|_| {
                AppError::Config("stored connection secret reference is invalid".into())
            })?;
        let password = password.filter(|password| !password.is_empty());
        if uses_cli_authentication && password.is_some() {
            return Err(AppError::Config(
                "CLI-authenticated connection credentials cannot be stored as a database password"
                    .into(),
            ));
        }
        if password
            .as_ref()
            .is_some_and(|value| value.len() > MAX_CONNECTION_CREDENTIAL_BYTES)
        {
            return Err(AppError::Config(
                "connection credential exceeds the size limit".into(),
            ));
        }

        let removes_stored_secret =
            clear_password && password.is_none() && existing_secret_id.is_some();
        // A saved credential stays bound to the endpoint it was entered for. Keeping
        // it while the profile moves to another engine, host, port, user, or SSH
        // alias would let the next check send it there, so a moved profile must
        // carry a new password or explicitly drop the saved one.
        if password.is_none()
            && !removes_stored_secret
            && !uses_cli_authentication
            && existing_secret_id.is_some()
            && stored.is_some_and(|stored| !same_credential_endpoint(stored, &profile))
        {
            return Err(AppError::CredentialBindingRequired);
        }
        profile.secret_ref = if uses_cli_authentication || removes_stored_secret {
            None
        } else {
            existing_secret_id.map(|value| value.to_string())
        };
        let replacement_secret_id = password.as_ref().map(|_| Uuid::new_v4());
        if let Some(password) = password.as_deref() {
            let credential_id = replacement_secret_id.expect("password has a replacement id");
            self.credentials.store(&credential_id, password)?;
            profile.secret_ref = Some(credential_id.to_string());
        }

        match self.repository.upsert(&profile).await {
            Ok(profile) => {
                let _ = self.repository.clear_schema_cache(id).await;
                if existing {
                    profile_mutation
                        .take()
                        .expect("connection upsert holds a profile mutation guard")
                        .retire_connection(id)
                        .await;
                }
                if replacement_secret_id.is_some() {
                    if let Some(previous_id) = existing_secret_id {
                        self.delete_secret_best_effort(
                            previous_id,
                            "replace_connection_credentials",
                        )
                        .await;
                    }
                } else if uses_cli_authentication || removes_stored_secret {
                    if let Some(previous_id) = existing_secret_id {
                        self.delete_secret_best_effort(
                            previous_id,
                            "remove_obsolete_connection_credentials",
                        )
                        .await;
                    }
                }
                Ok(profile)
            }
            Err(error) => {
                if let Some(credential_id) = replacement_secret_id {
                    self.delete_secret_best_effort(credential_id, "upsert_connection")
                        .await;
                }
                Err(error)
            }
        }
    }

    pub(crate) async fn set_schema_group(
        &self,
        ids: Vec<ConnectionId>,
        schema_group: Option<String>,
    ) -> AppResult<Vec<ConnectionProfile>> {
        let mut unique_ids = Vec::with_capacity(ids.len());
        for id in ids {
            if !unique_ids.contains(&id) {
                unique_ids.push(id);
            }
        }
        if unique_ids.is_empty() {
            return Ok(Vec::new());
        }

        let mutation = self.authority.begin_scope_mutation().await;
        let normalized = normalize_schema_group(schema_group);
        let mut connections = self.repository.list().await?;
        for id in &unique_ids {
            let raw_id = Uuid::from(*id);
            let profile = connections
                .iter_mut()
                .find(|profile| profile.id == raw_id)
                .ok_or_else(|| AppError::NotFound(format!("connection {id}")))?;
            if profile.workspace_access != WorkspaceConnectionAccess::Local {
                return Err(AppError::Blocked {
                    reason:
                        "shared template metadata must be changed through the workspace service"
                            .into(),
                });
            }
            profile.schema_group = normalized.clone();
        }

        let updated = unique_ids
            .iter()
            .map(|id| {
                connections
                    .iter()
                    .find(|profile| profile.id == Uuid::from(*id))
                    .cloned()
                    .ok_or_else(|| AppError::NotFound(format!("connection {id}")))
            })
            .collect::<AppResult<Vec<_>>>()?;
        for profile in &updated {
            validate_schema_group_engine(profile, &connections)?;
        }

        self.repository
            .set_schema_group(&unique_ids, normalized)
            .await?;
        mutation.retire_connections(&unique_ids).await;
        Ok(updated)
    }

    pub(crate) async fn delete(&self, id: ConnectionId) -> AppResult<ConnectionProfile> {
        self.retry_deferred_credential_deletes().await;
        let mutation = self
            .authority
            .begin_connection_mutation(id, ConnectionPermission::Read)
            .await?;
        let profile = mutation.profile().clone();
        if profile.workspace_access != WorkspaceConnectionAccess::Local {
            return Err(AppError::Blocked {
                reason: "shared connections can only be removed by a workspace administrator"
                    .into(),
            });
        }
        self.repository.delete(id).await?;
        if let Some(secret_ref) = profile.secret_ref.as_deref() {
            match Uuid::parse_str(secret_ref) {
                Ok(credential_id) => {
                    self.delete_secret_best_effort(credential_id, "delete_connection")
                        .await;
                }
                Err(error) => {
                    tracing::warn!(
                        connection_id = %id,
                        %error,
                        "ignored invalid credential reference while deleting connection"
                    );
                }
            }
        }
        mutation.retire_connection(id).await;
        Ok(profile)
    }

    pub(crate) async fn test(&self, id: ConnectionId) -> AppResult<()> {
        let profile = self.repository.get(id).await?;
        if !profile.workspace_access.can_read() {
            return Err(AppError::Blocked {
                reason: "your workspace role cannot test this shared connection".into(),
            });
        }
        self.authority
            .authorize(id, ConnectionPermission::Read)
            .await?
            .test_fresh()
            .await
    }

    /// Check an unsaved local draft. A draft that moved away from its saved
    /// endpoint is refused before any connection, so the saved secret never
    /// reaches a server it was not entered for.
    pub(crate) async fn test_profile(
        &self,
        request: ConnectionProfileTestRequest,
    ) -> ConnectionTestReceipt {
        let ConnectionProfileTestRequest {
            mut profile,
            password,
        } = request;
        if profile.workspace_access != WorkspaceConnectionAccess::Local
            || profile.credential_mode != WorkspaceCredentialMode::Local
        {
            return ConnectionTestReceipt::from_result(Err(AppError::Blocked {
                reason: "shared connections must be tested through workspace authorization".into(),
            }));
        }
        let uses_cli_authentication = profile.engine == Engine::Bigquery
            || (profile.engine == Engine::Sqlite
                && profile.provider == crate::model::Provider::CloudflareD1);
        let supplied = password.filter(|password| !password.is_empty());
        if supplied
            .as_ref()
            .is_some_and(|value| value.len() > MAX_CONNECTION_CREDENTIAL_BYTES)
        {
            return ConnectionTestReceipt::from_result(Err(AppError::Config(
                "connection credential exceeds the size limit".into(),
            )));
        }
        // The editor sends an empty password field for a saved profile, so an empty
        // input means "use the stored credential" rather than "authenticate without
        // one"; otherwise `upsert` and `test_profile` disagree about one connection.
        let password = match supplied {
            Some(value) => {
                profile.secret_ref = None;
                value
            }
            None if uses_cli_authentication => {
                profile.secret_ref = None;
                Zeroizing::new(String::new())
            }
            None => match self.saved_local_credential(&mut profile).await {
                Ok(SavedCredential::Reuse(secret)) => secret,
                Ok(SavedCredential::Empty) => Zeroizing::new(String::new()),
                Ok(SavedCredential::EndpointChanged) => {
                    return ConnectionTestReceipt::saved_credential_endpoint_changed();
                }
                Err(error) => return ConnectionTestReceipt::from_result(Err(error)),
            },
        };
        ConnectionTestReceipt::from_result(self.tester.test(&profile, password).await)
    }

    /// Discover selectable databases from an unsaved, local profile. This is a
    /// bounded read only: the result is never persisted and grants no authority
    /// beyond the one connection made for this request. Like Test, it refuses a
    /// draft that moved away from its saved endpoint before connecting.
    pub(crate) async fn discover_profile_databases(
        &self,
        mut profile: ConnectionProfile,
        password: Option<Zeroizing<String>>,
    ) -> AppResult<DatabaseDiscoveryReceipt> {
        if profile.workspace_access != WorkspaceConnectionAccess::Local
            || profile.credential_mode != WorkspaceCredentialMode::Local
        {
            return Err(AppError::Blocked {
                reason:
                    "shared connections must discover databases through workspace authorization"
                        .into(),
            });
        }
        if profile.engine == crate::model::Engine::Sqlite {
            return Err(AppError::Config(
                "SQLite files have one configured database scope".into(),
            ));
        }
        self.drivers
            .validate(&profile)
            .map_err(AppError::public_connection_failure)?;
        // Discovery and Test must agree about the same draft: an empty password
        // field means "use this saved profile's credential", exactly as in Test.
        let password = match password.filter(|password| !password.is_empty()) {
            Some(value) => {
                profile.secret_ref = None;
                value
            }
            None => match self
                .saved_local_credential(&mut profile)
                .await
                .map_err(AppError::public_connection_failure)?
            {
                SavedCredential::Reuse(secret) => secret,
                SavedCredential::Empty => Zeroizing::new(String::new()),
                SavedCredential::EndpointChanged => {
                    return Ok(DatabaseDiscoveryReceipt::refused(
                        ConnectionProbeRefusal::SavedCredentialEndpointChanged,
                    ));
                }
            },
        };
        if password.len() > MAX_CONNECTION_CREDENTIAL_BYTES {
            return Err(AppError::Config(
                "connection credential exceeds the size limit".into(),
            ));
        }
        self.tester
            .discover_databases(&profile, password)
            .await
            .map(DatabaseDiscoveryReceipt::found)
            .map_err(AppError::public_connection_failure)
    }

    pub(crate) async fn list_agent_summaries(&self) -> AppResult<Vec<AgentConnectionSummary>> {
        Ok(self
            .list_profiles()
            .await?
            .iter()
            .map(AgentConnectionSummary::from)
            .collect())
    }

    pub(crate) async fn terminal_summary(
        &self,
        authority: &TerminalAuthority,
    ) -> AppResult<AgentConnectionSummary> {
        let connection = self
            .authority
            .authorize_terminal(authority, ConnectionPermission::Read)
            .await?;
        Ok(AgentConnectionSummary::from(connection.profile()))
    }

    pub(crate) async fn list_terminal_summaries(
        &self,
        authority: &TerminalAuthority,
    ) -> AppResult<Vec<AgentConnectionSummary>> {
        Ok(vec![self.terminal_summary(authority).await?])
    }

    pub(crate) async fn test_terminal(&self, authority: &TerminalAuthority) -> AppResult<()> {
        self.authority
            .authorize_terminal(authority, ConnectionPermission::Read)
            .await?
            .test_fresh()
            .await
    }

    pub(crate) async fn resolve_terminal_cli(
        &self,
        authority: &TerminalAuthority,
        name: &str,
    ) -> AppResult<Result<AgentConnectionSummary, CliConnectionResolutionError>> {
        let authority_guard = self
            .authority
            .authorize_terminal(authority, ConnectionPermission::Read)
            .await?;
        let summaries = self.list_agent_summaries().await?;
        let resolved = resolve_cli_name(&summaries, name);
        drop(authority_guard);
        Ok(resolved)
    }

    /// The saved credential an unsaved draft may reuse.
    ///
    /// The WebView only opts in by carrying a credential reference; the reference
    /// value itself is discarded. The secret is resolved strictly from the stored
    /// local profile with the same id in the active scope, so a crafted draft can
    /// never send another connection's or a shared binding's credential to the
    /// host it names. It is reused only while the draft names the same engine,
    /// host, port, user, and SSH alias; a moved draft is refused before the OS
    /// credential store is read. Socket/trust profiles without a saved credential
    /// resolve to an empty password.
    async fn saved_local_credential(
        &self,
        draft: &mut ConnectionProfile,
    ) -> AppResult<SavedCredential> {
        if draft.secret_ref.take().is_none() {
            return Ok(SavedCredential::Empty);
        }
        let stored = self
            .repository
            .list()
            .await?
            .into_iter()
            .find(|connection| connection.id == draft.id);
        match stored {
            Some(stored)
                if stored.workspace_access == WorkspaceConnectionAccess::Local
                    && stored.credential_mode == WorkspaceCredentialMode::Local
                    && stored.secret_ref.is_some() =>
            {
                if !same_credential_endpoint(&stored, draft) {
                    return Ok(SavedCredential::EndpointChanged);
                }
                self.credentials
                    .fetch_profile(&stored)
                    .map(SavedCredential::Reuse)
            }
            _ => Ok(SavedCredential::Empty),
        }
    }

    /// Retry every unreferenced credential item whose deletion failed earlier,
    /// including ones recorded before the app restarted. A failure keeps the
    /// record for the next mutation; the mutation itself never waits on cleanup.
    async fn retry_deferred_credential_deletes(&self) {
        let pending = match self.repository.deferred_credential_deletes().await {
            Ok(pending) => pending,
            Err(error) => {
                tracing::warn!(
                    error_kind = error.kind(),
                    "deferred credential cleanup unreadable"
                );
                return;
            }
        };
        for id in pending {
            if self.credentials.delete(&id).is_ok() {
                if let Err(error) = self.repository.clear_deferred_credential_delete(id).await {
                    tracing::warn!(
                        error_kind = error.kind(),
                        "deferred credential cleanup could not be cleared"
                    );
                }
            }
        }
    }

    /// Delete an unreferenced credential item, or record it so a later mutation
    /// retries the deletion even after a restart.
    async fn delete_secret_best_effort(&self, id: Uuid, action: &'static str) {
        if let Err(error) = self.credentials.delete(&id) {
            tracing::warn!(
                error_kind = error.kind(),
                action,
                "credential cleanup deferred"
            );
            if let Err(error) = self.repository.defer_credential_delete(id).await {
                tracing::warn!(
                    error_kind = error.kind(),
                    action,
                    "credential cleanup could not be deferred"
                );
            }
        }
    }
}
