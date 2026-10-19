//! Platform ports for direct shared database use cases.
//!
//! The application layer depends only on these traits: the administrator credential
//! vault, the target database (short-lived single connections), the hosted control
//! plane (account Bearer session stays inside the adapter), and the local store.
//! Database failures cross as categorical [`FailureCode`] values only; raw driver
//! errors, SQL text, and principal names never leave an adapter.

use std::future::Future;

use serde_json::Value;

use dopedb_protocol::{
    DirectLevel, DirectProvisioningStatus, DirectReceiptRequest, DirectRevocationEntry,
    DirectRevocationKind, DirectVerifierRequest, DirectWorkList, DirectWorkListItem,
};

use super::domain::{DirectEngine, FailureCode, PrincipalName};
use super::ownership::ObservedPrincipal;
use super::plan::{PlannedStatement, Planner};
use super::types::{AdminCredential, DirectScope, PreflightFacts, TargetEndpoint};
use crate::error::AppResult;
use crate::kernel::identity::{AccountId, ConnectionId, WorkspaceId};

/// Keyring-only storage of administrator credentials, one item per exact scope.
pub(crate) trait AdminCredentialVault: Clone + Send + Sync + 'static {
    fn store(&self, scope: &DirectScope, credential: &AdminCredential) -> AppResult<()>;
    fn fetch(&self, scope: &DirectScope) -> AppResult<Option<AdminCredential>>;
    fn contains(&self, scope: &DirectScope) -> AppResult<bool>;
    fn delete(&self, scope: &DirectScope) -> AppResult<()>;
}

/// One short-lived administrator connection to the target database.
pub(crate) trait TargetSession: Send {
    /// Raw server version text, gated by `ServerVersion::check`.
    fn version(&mut self) -> impl Future<Output = Result<String, FailureCode>> + Send;

    /// PostgreSQL database oid or MySQL `server_uuid`: identifies the exact server
    /// and database the principals were created on.
    fn fingerprint(&mut self) -> impl Future<Output = Result<String, FailureCode>> + Send;

    fn preflight(
        &mut self,
        write: bool,
    ) -> impl Future<Output = Result<PreflightFacts, FailureCode>> + Send;

    fn observe(
        &mut self,
        name: &PrincipalName,
    ) -> impl Future<Output = Result<ObservedPrincipal, FailureCode>> + Send;

    /// Run the planned statements in order (one transaction on PostgreSQL),
    /// substituting server-quoted identifiers for the placeholders.
    fn execute(
        &mut self,
        plan: &[PlannedStatement],
    ) -> impl Future<Output = Result<(), FailureCode>> + Send;

    /// End every open session of the principal, but only when the administrator account
    /// is allowed to (read-only privilege check, never a membership or grant change).
    /// `Ok(false)` means it is not allowed and nothing was attempted: the caller has
    /// already revoked and locked the principal, and open sessions may persist until
    /// they disconnect.
    fn terminate_sessions(
        &mut self,
        planner: &Planner,
        name: &PrincipalName,
    ) -> impl Future<Output = Result<bool, FailureCode>> + Send;

    fn close(self) -> impl Future<Output = ()> + Send;
}

pub(crate) trait TargetDatabasePort: Clone + Send + Sync + 'static {
    type Session: TargetSession;

    fn open(
        &self,
        endpoint: &TargetEndpoint,
        credential: &AdminCredential,
    ) -> impl Future<Output = Result<Self::Session, FailureCode>> + Send;
}

/// Result of one account-scoped control-plane mutation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MutationOutcome {
    Done,
    /// HTTP 409 `direct_revocation_required`: the server saw no matching receipt.
    RevocationRequired,
    Rejected(u16),
}

/// State a revocation item is settled to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RevocationSettle {
    Applied,
    Cancelled,
}

/// Typed access to the direct-access routes plus the existing administration
/// operations. The account's Bearer session is resolved inside the adapter.
pub(crate) trait DirectControlPlanePort: Clone + Send + Sync + 'static {
    /// Register a direct shared database and return the new connection's id and
    /// content revision.
    fn register(
        &self,
        account_id: &AccountId,
        workspace_id: WorkspaceId,
        body: Value,
    ) -> impl Future<Output = AppResult<(ConnectionId, i64)>> + Send;

    fn principal_status(
        &self,
        scope: &DirectScope,
    ) -> impl Future<Output = AppResult<DirectProvisioningStatus>> + Send;

    fn put_verifier(
        &self,
        scope: &DirectScope,
        request: &DirectVerifierRequest,
    ) -> impl Future<Output = AppResult<DirectProvisioningStatus>> + Send;

    fn work(&self, scope: &DirectScope) -> impl Future<Output = AppResult<DirectWorkList>> + Send;

    fn claim(
        &self,
        scope: &DirectScope,
        device_id: &str,
        principal_ids: &[String],
    ) -> impl Future<Output = AppResult<Vec<DirectWorkListItem>>> + Send;

    fn receipt(
        &self,
        scope: &DirectScope,
        request: &DirectReceiptRequest,
    ) -> impl Future<Output = AppResult<()>> + Send;

    fn list_revocations(
        &self,
        account_id: &AccountId,
        workspace_id: WorkspaceId,
    ) -> impl Future<Output = AppResult<Vec<DirectRevocationEntry>>> + Send;

    fn create_revocations(
        &self,
        scope: &DirectScope,
        kind: DirectRevocationKind,
        member_ids: &[String],
        target_level: DirectLevel,
    ) -> impl Future<Output = AppResult<Vec<DirectRevocationEntry>>> + Send;

    fn settle_revocation(
        &self,
        account_id: &AccountId,
        workspace_id: WorkspaceId,
        revocation_id: &str,
        state: RevocationSettle,
    ) -> impl Future<Output = AppResult<()>> + Send;

    /// Run one closed workspace-administration operation (a `WorkspaceAdminOperation`
    /// in its wire form) and classify the result for the revocation guard.
    fn mutate(
        &self,
        account_id: &AccountId,
        operation: Value,
    ) -> impl Future<Output = AppResult<MutationOutcome>> + Send;
}

/// Endpoint fields of a cached shared template.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LocalTemplate {
    pub(crate) engine: DirectEngine,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) database: String,
    pub(crate) sslmode: String,
}

/// A member password staged in the credential store but not yet bound.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct StagedPassword(pub(crate) uuid::Uuid);

pub(crate) trait DirectLocalPort: Clone + Send + Sync + 'static {
    fn template(
        &self,
        scope: &DirectScope,
    ) -> impl Future<Output = AppResult<LocalTemplate>> + Send;

    /// Endpoint of one of the caller's own saved connections, for prefill.
    fn prefill(
        &self,
        connection_id: ConnectionId,
    ) -> impl Future<Output = AppResult<(LocalTemplate, Option<String>)>> + Send;

    /// Every cached provisioned shared database with the account that holds it.
    fn provisioned(&self) -> impl Future<Output = AppResult<Vec<DirectScope>>> + Send;

    /// Stable id of this installation for work leases.
    fn device_id(&self, scope: &DirectScope) -> impl Future<Output = AppResult<String>> + Send;

    fn stage_password(&self, password: &str) -> AppResult<StagedPassword>;

    fn discard_password(&self, staged: StagedPassword);

    /// Bind the staged password and optional SSH alias to this member's shared
    /// connection; replaces and removes any previous password item.
    fn bind_password(
        &self,
        scope: &DirectScope,
        staged: StagedPassword,
        ssh_alias: Option<&str>,
    ) -> impl Future<Output = AppResult<()>> + Send;

    /// Record (or clear) the ready principal name on the member binding.
    fn apply_principal(
        &self,
        scope: &DirectScope,
        principal_name: Option<&str>,
    ) -> impl Future<Output = AppResult<()>> + Send;
}
